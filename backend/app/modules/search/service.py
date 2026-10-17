"""Search across spaces and pages.

Pages are found three ways and the rankings are merged (reciprocal rank
fusion): ranked keyword search, plain substring matching as a fill-in, and -
when an embedding model is configured - semantic search over passage vectors.
Each layer degrades to the one below it, so search keeps working if an
extension or the AI gateway is missing.

Keyword ranking treats the query as a handful of *ideas* (see
``query.build_concepts``), each of which may be written a few ways (Vietnamese
or English). Rarer ideas count for more - in "tài khoản cloud của nuti" the
word "nuti" decides - a page must cover at least half the weight to be listed,
and a match in the title counts extra.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from functools import reduce
from typing import Literal

import sqlalchemy as sa
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.logging import get_logger
from app.core.redis import get_redis
from app.models.page import WikiPage
from app.models.permission import Permission
from app.models.space import Space, SpaceStatus
from app.models.user import User
from app.modules.ai.config import AIConfig, load_config
from app.modules.ai.embeddings import EmbeddingError, embed
from app.modules.permissions.service import PermissionService
from app.modules.search.indexer import semantic_tables_exist, vector_literal
from app.modules.search.query import (
    Concept,
    best_snippet,
    build_concepts,
    fold,
    plain_text,
    query_tokens,
)
from app.repositories.filters import ilike_contains, like_escape

__all__ = ["SearchService", "extract_snippet", "query_tokens"]

logger = get_logger(__name__)

#: Candidates taken from each ranking before permissions trim them: some will
#: be hidden from this user, and the limit must still be met when possible.
_OVERFETCH = 3
_RRF_K = 60
_VECTOR_CANDIDATES = 40
#: A semantic-only page must stand out from the pack: this many standard deviations above
#: the mean similarity of the candidates. Some models score every page 0.6-0.7, so a fixed
#: margin below the best lets the whole wiki in.
_OUTLIER_Z = 1.5
#: Fewer candidate pages than this and the spread says nothing; the fixed floors decide.
_OUTLIER_MIN_PAGES = 8
#: Longest a search waits for a self-hosted model to load after sitting idle.
_OLLAMA_COLD_START_SECONDS = 15.0
#: How much a semantic ranking counts beside the keyword one when they are fused. Pages the
#: words matched should not be pushed down by pages that are merely "about the same area".
_SEMANTIC_WEIGHT = 0.7
#: A page must match ideas worth at least this share of the query to be listed.
_MIN_COVERAGE = 0.5
#: A page holding at least this share of everything the question asks about is "the wiki holds
#: it": the answer comes from it without anyone being asked where else to look.
_CONFIDENT_COVERAGE = 0.4
#: Substring matching only fills in when ranked search found fewer than this.
_SUBSTRING_FILL_BELOW = 5
#: Trigram similarity a title needs to be listed on its likeness to the query alone.
_MIN_TITLE_SIMILARITY = 0.55
#: A search slower than this (seconds) is logged as a warning, with where the time went.
_SLOW_SEARCH_SECONDS = 1.0

_SIMPLE = sa.literal_column("'simple'")
#: ``pages.search_vector`` is maintained by the database (see ``ddl``).
_VECTOR = sa.literal_column("pages.search_vector")


@dataclass(slots=True)
class SearchResultPage:
    id: uuid.UUID
    title: str
    slug: str
    space_key: str
    space_name: str
    snippet: str
    updated_at: datetime | None


@dataclass(slots=True)
class AnswerPassage:
    """What a question is answered from: a page the asker may read and its matching text."""

    page: SearchResultPage
    text: str


@dataclass(slots=True)
class AnswerContext:
    """What a question can be answered from, and how far the wiki can be trusted to hold it."""

    passages: list[AnswerPassage]
    #: ``high``: a page holds the ideas of the question (ranked keyword match); ``low``: pages
    #: were found only by meaning or by a likeness of wording, which may be about the same area
    #: and not the same thing; ``none``: nothing.
    confidence: Literal["high", "low", "none"]


@dataclass(slots=True)
class SearchResultSpace:
    id: uuid.UUID
    key: str
    name: str
    description: str


@dataclass(slots=True)
class SearchResults:
    query: str
    pages: list[SearchResultPage]
    spaces: list[SearchResultSpace]
    #: Folded words and synonyms worth highlighting in the titles and snippets.
    terms: list[str] = field(default_factory=list)


@dataclass(slots=True)
class _Ranked:
    """What keyword search found, and how much each idea in the query weighed."""

    ids: list[uuid.UUID] = field(default_factory=list)
    #: ``folded term -> weight`` for locating the passage worth showing.
    weights: dict[str, float] = field(default_factory=dict)
    #: Ranked search could not run (missing extension or column): substring only.
    degraded: bool = False
    #: How much of what the question asks about its best page holds, from 0 to 1: the weight of
    #: the ideas found in it over the weight of *all* the ideas, those that no page mentions
    #: included (they are the rarest, so they weigh the most). A page that holds "information"
    #: and "details" of a question about an event nobody wrote about scores low.
    best_coverage: float = 0.0


def extract_snippet(content: str, query: str, max_len: int = 140) -> str:
    """A clean plain-text snippet centred on where ``query`` appears."""
    if not query:
        plain = plain_text(content)
        return plain[:max_len] + ("..." if len(plain) > max_len else "")
    terms = [(term, 1.0) for c in build_concepts(query) for term in c.terms()]
    return best_snippet(content, terms or [(fold(query), 1.0)], max_len=max_len)[0]


class SearchService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        #: How well the last page search matched (see :class:`AnswerContext`). Set by
        #: ``_search_pages``; this object lives for one request.
        self.last_confidence: Literal["high", "low", "none"] = "none"

    async def search(self, query: str, user: User, limit: int = 20) -> SearchResults:
        query_trimmed = query.strip()
        if not query_trimmed:
            return SearchResults(query="", pages=[], spaces=[])

        # 1. Search spaces
        spaces_stmt = (
            select(Space)
            .where(
                Space.status == SpaceStatus.active,
                (
                    ilike_contains(Space.name, query_trimmed)
                    | ilike_contains(Space.key, query_trimmed)
                    | ilike_contains(Space.description, query_trimmed)
                ),
            )
            .limit(limit)
        )
        spaces_result = await self.session.execute(spaces_stmt)
        matched_spaces = list(spaces_result.scalars().all())
        permissions = PermissionService(self.session)
        matched_spaces = [
            space
            for space in matched_spaces
            if Permission.view in await permissions.effective_permissions(space, user)
        ]

        space_results = [
            SearchResultSpace(
                id=s.id,
                key=s.key,
                name=s.name,
                description=s.description or "",
            )
            for s in matched_spaces
        ]

        page_results, terms = await self._search_pages(query_trimmed, user, limit, permissions)

        return SearchResults(
            query=query_trimmed,
            pages=page_results,
            spaces=space_results,
            terms=terms,
        )

    # ------------------------------------------------------------------ pages

    async def _search_pages(
        self, query: str, user: User, limit: int, permissions: PermissionService
    ) -> tuple[list[SearchResultPage], list[str]]:
        started = time.perf_counter()
        wanted = limit * _OVERFETCH
        concepts = build_concepts(query)
        config = await load_config(self.session)
        # The query is embedded over HTTP while the database answers the
        # keyword search, so semantic search adds little latency.
        embedding = (
            asyncio.create_task(_embed_query(config, query))
            if config.embeddings_ready and len(query) >= 3
            else None
        )
        keyword_seconds = semantic_seconds = 0.0
        try:
            mark = time.perf_counter()
            ranked = await self._keyword_pages(query, concepts, wanted)
            keyword_seconds = time.perf_counter() - mark
            mark = time.perf_counter()
            semantic = await self._semantic_hits(embedding, wanted, config)
            semantic_seconds = time.perf_counter() - mark
        finally:
            if embedding is not None and not embedding.done():
                embedding.cancel()

        order = _fuse(ranked.ids, list(semantic), weights=(1.0, _SEMANTIC_WEIGHT))
        terms = _highlight_terms(concepts, ranked.weights)
        self.last_confidence = "none"
        if not order:
            self._log_search(
                query, started, keyword_seconds, semantic_seconds, concepts, ranked, semantic, 0
            )
            return [], terms
        snippet_terms = [(term, ranked.weights.get(term, 1.0)) for term in terms]
        pages = {
            page.id: page
            for page in (
                await self.session.execute(
                    select(WikiPage)
                    .options(selectinload(WikiPage.space))
                    .join(Space, WikiPage.space_id == Space.id)
                    .where(WikiPage.id.in_(order), Space.status == SpaceStatus.active)
                )
            )
            .scalars()
            .all()
        }
        results: list[SearchResultPage] = []
        for page_id in order:
            page = pages.get(page_id)
            if page is None or not await permissions.can_view_page(page, user):
                continue
            snippet, found = best_snippet(page.content, snippet_terms)
            passage = semantic.get(page_id)
            if passage and not found:
                # Found by meaning, not by the words typed: show the passage
                # that matched, which is what explains the result.
                snippet = _passage_snippet(passage)
            results.append(
                SearchResultPage(
                    id=page.id,
                    title=page.title,
                    slug=page.slug,
                    space_key=page.space.key,
                    space_name=page.space.name,
                    snippet=snippet,
                    updated_at=page.updated_at,
                )
            )
            if len(results) >= limit:
                break
        if results:
            top = ranked.ids[0] if ranked.ids else None
            self.last_confidence = (
                "high"
                if ranked.best_coverage >= _CONFIDENT_COVERAGE
                and any(result.id == top for result in results)
                else "low"
            )
        self._log_search(
            query,
            started,
            keyword_seconds,
            semantic_seconds,
            concepts,
            ranked,
            semantic,
            len(results),
        )
        return results, terms

    async def answer_passages(
        self,
        query: str,
        user: User,
        *,
        max_pages: int = 5,
        passage_chars: int = 900,
        total_chars: int = 6000,
    ) -> list[AnswerPassage]:
        """The text a question should be answered from, best page first.

        The pages are the ones search lists for ``user`` - so a page they may not read is
        never among them - and the text of each is what matched: the best passages by
        meaning when semantic search is on, and the stretch of the page holding the words
        asked for. Together they stay under ``total_chars``, which is what the model reads.
        """
        permissions = PermissionService(self.session)
        results, terms = await self._search_pages(query, user, max_pages, permissions)
        if not results:
            return []
        ids = [result.id for result in results]
        config = await load_config(self.session)
        semantic = await self._best_passages(query, ids, config)
        contents = dict(
            (
                await self.session.execute(
                    select(WikiPage.id, WikiPage.content).where(WikiPage.id.in_(ids))
                )
            ).all()
        )
        weighted = [(term, 1.0) for term in terms]
        passages: list[AnswerPassage] = []
        used = 0
        for result in results:
            parts = [part.strip() for part in semantic.get(result.id, [])]
            window, found = best_snippet(
                contents.get(result.id, ""),
                weighted,
                max_len=passage_chars,
                lead=passage_chars // 4,
            )
            # The stretch with the typed words, unless a matched passage already holds it.
            if window and (found or not parts):
                core = window.strip(". ")[:60]
                if not core or not any(core in part for part in parts):
                    parts.append(window)
            body = "\n\n".join(part for part in parts if part)[: passage_chars * 2]
            if not body:
                continue
            if passages and used + len(body) > total_chars:
                break
            used += len(body)
            passages.append(AnswerPassage(page=result, text=body))
        return passages

    async def answer_context(self, query: str, user: User, **limits: int) -> AnswerContext:
        """:meth:`answer_passages` with how well the wiki matched the question."""
        passages = await self.answer_passages(query, user, **limits)
        return AnswerContext(passages, self.last_confidence if passages else "none")

    async def _best_passages(
        self, query: str, ids: list[uuid.UUID], config: AIConfig, per_page: int = 2
    ) -> dict[uuid.UUID, list[str]]:
        """The indexed passages of these pages closest in meaning to ``query``, best first."""
        if not config.embeddings_ready or len(query) < 3 or not ids:
            return {}
        vector = await _embed_query(config, query)
        if not vector or not await semantic_tables_exist(self.session):
            return {}
        size = len(vector)  # an int from the gateway's reply, never user text
        distance = f"embedding::vector({size}) <=> CAST(CAST(:query AS text) AS vector({size}))"
        # UUIDs that this process just read from the database: no user text in the statement.
        listed = ",".join(f"'{page_id}'" for page_id in ids)
        try:
            async with self.session.begin_nested():
                rows = (
                    await self.session.execute(
                        text(
                            f"SELECT page_id, body, 1 - ({distance}) AS similarity "  # noqa: S608
                            f"FROM page_chunks WHERE page_id IN ({listed}) "
                            f"ORDER BY {distance} LIMIT 20"
                        ),
                        {"query": vector_literal(vector)},
                    )
                ).all()
        except SQLAlchemyError:
            logger.warning("search_semantic_unavailable", exc_info=True)
            return {}
        found: dict[uuid.UUID, list[str]] = {}
        for page_id, body, similarity in rows:
            if similarity < config.tuning.min_similarity:
                continue
            bucket = found.setdefault(page_id, [])
            if len(bucket) < per_page:
                bucket.append(body)
        return found

    @staticmethod
    def _log_search(
        query: str,
        started: float,
        keyword_seconds: float,
        semantic_seconds: float,
        concepts: list[Concept],
        ranked: _Ranked,
        semantic: dict[uuid.UUID, str],
        results: int,
    ) -> None:
        """One line per search, for tuning: debug normally, a warning when slow.

        Never carries the query text itself (people search for passwords and
        names), only its size and where the time went.
        """
        total = time.perf_counter() - started
        slow = total >= _SLOW_SEARCH_SECONDS
        (logger.warning if slow else logger.debug)(
            "search_slow" if slow else "search_done",
            query_chars=len(query),
            ideas=len(concepts),
            keyword_hits=len(ranked.ids),
            semantic_hits=len(semantic),
            results=results,
            keyword_seconds=round(keyword_seconds, 3),
            semantic_seconds=round(semantic_seconds, 3),
            total_seconds=round(total, 3),
            ranked_search_degraded=ranked.degraded,
            best_coverage=round(ranked.best_coverage, 2),
        )

    async def _keyword_pages(self, query: str, concepts: list[Concept], wanted: int) -> _Ranked:
        """Ranked keyword matches, then plain substring matches to fill the rest."""
        ranked = _Ranked(weights={t: 1.0 for c in concepts for t in c.terms()})
        try:
            # A savepoint: a database without the search objects raises here,
            # and that must not poison the surrounding transaction.
            async with self.session.begin_nested():
                ranked = await self._ranked(query, concepts, wanted)
        except SQLAlchemyError:
            ranked.degraded = True
            logger.warning(
                "search_ranked_unavailable",
                hint="run the latest migrations (pages.search_vector / pg_trgm / unaccent)",
                exc_info=True,
            )
        if len(ranked.ids) < min(wanted, _SUBSTRING_FILL_BELOW):
            substring = (
                await self.session.execute(
                    select(WikiPage.id)
                    .join(Space, WikiPage.space_id == Space.id)
                    .where(
                        Space.status == SpaceStatus.active,
                        ilike_contains(WikiPage.title, query)
                        | ilike_contains(WikiPage.content, query),
                    )
                    .limit(wanted)
                )
            ).scalars()
            seen = set(ranked.ids)
            ranked.ids.extend(page_id for page_id in substring if page_id not in seen)
        ranked.ids = ranked.ids[:wanted]
        return ranked

    async def _ranked(self, query: str, concepts: list[Concept], wanted: int) -> _Ranked:
        active = Space.status == SpaceStatus.active
        title_key = sa.func.wh_title_key(WikiPage.title)
        key_text = fold(query).strip()
        contains_title = title_key.like(f"%{like_escape(key_text)}%", escape="\\")
        # A title that merely shares a word or two with the question ("Tài khoản hệ thống" for
        # "ip hệ thống dms") is not an answer: a loose title match must be a close one.
        similar_title = sa.and_(
            title_key.op("%")(key_text),
            sa.func.similarity(title_key, key_text) >= _MIN_TITLE_SIMILARITY,
        )

        # How common each idea is decides how much finding it says: a page
        # mentioning "nuti" (in 2 pages) tells far more than one mentioning
        # "cloud" (in 60).
        weights, absent_weight = await self._idea_weights(concepts)
        live = [(c, w) for c, w in zip(concepts, weights, strict=True) if w > 0]
        total_weight = sum(w for _, w in live)
        in_body: sa.ColumnElement = sa.literal(0.0)

        matches = [contains_title, similar_title]
        score = sa.case((contains_title, 3.0), else_=0.0) + sa.func.similarity(title_key, key_text)
        if live:
            title_vector = sa.func.to_tsvector(_SIMPLE, title_key)
            queries = [sa.func.to_tsquery(_SIMPLE, c.tsquery()) for c, _ in live]
            any_idea = sa.func.to_tsquery(_SIMPLE, " | ".join(f"({c.tsquery()})" for c, _ in live))
            in_body = reduce(
                lambda a, b: a + b,
                (
                    sa.case((_VECTOR.op("@@")(q), w), else_=0.0)
                    for q, (_, w) in zip(queries, live, strict=True)
                ),
            )
            in_title = reduce(
                lambda a, b: a + b,
                (
                    sa.case((title_vector.op("@@")(q), 1.5 * w), else_=0.0)
                    for q, (_, w) in zip(queries, live, strict=True)
                ),
            )
            matches.append(
                sa.and_(_VECTOR.op("@@")(any_idea), in_body >= _MIN_COVERAGE * total_weight)
            )
            score = (
                score
                + in_body
                + in_title
                + 2.0 * in_body / total_weight
                + 0.5 * sa.func.ts_rank_cd(_VECTOR, any_idea, 32)
            )
        rows = (
            await self.session.execute(
                select(WikiPage.id, in_body.label("body_weight"), contains_title.label("whole"))
                .join(Space, WikiPage.space_id == Space.id)
                .where(active, sa.or_(*matches))
                .order_by(score.desc(), WikiPage.updated_at.desc())
                .limit(wanted)
            )
        ).all()
        term_weights: dict[str, float] = {}
        for concept, weight in live:
            for term in concept.terms():
                term_weights[term] = max(weight, term_weights.get(term, 0.0))
        if not term_weights:  # found by title alone: still highlight what was typed
            term_weights = {term: 1.0 for c in concepts for term in c.terms()}
        best = 0.0
        if rows:
            # A title that holds the whole question is as sure as it gets; otherwise how much of
            # everything asked (the ideas no page has included) the best page holds.
            _, body_weight, whole = rows[0]
            best = 1.0 if whole else float(body_weight) / max(total_weight + absent_weight, 1e-9)
        return _Ranked(
            ids=[row[0] for row in rows], weights=term_weights, best_coverage=min(best, 1.0)
        )

    async def _idea_weights(self, concepts: list[Concept]) -> tuple[list[float], float]:
        """A weight per idea (0 when no page mentions it), larger for rarer ones; and what the
        ideas no page mentions would weigh together, were they counted as the rarest."""
        if not concepts:
            return [], 0.0
        queries = [sa.func.to_tsquery(_SIMPLE, c.tsquery()) for c in concepts]
        any_idea = sa.func.to_tsquery(_SIMPLE, " | ".join(f"({c.tsquery()})" for c in concepts))
        active = Space.status == SpaceStatus.active
        total = await self.session.scalar(
            select(sa.func.count())
            .select_from(WikiPage)
            .join(Space, WikiPage.space_id == Space.id)
            .where(active)
        )
        # Counting only pages that match something keeps this on the index.
        counts = (
            await self.session.execute(
                select(*[sa.func.count().filter(_VECTOR.op("@@")(q)) for q in queries])
                .select_from(WikiPage)
                .join(Space, WikiPage.space_id == Space.id)
                .where(active, _VECTOR.op("@@")(any_idea))
            )
        ).one()
        total = max(int(total or 0), 1)
        weights = [math.log(1 + total / n) if n else 0.0 for n in counts]
        return weights, math.log(1 + total) * sum(1 for n in counts if not n)

    async def _semantic_hits(
        self,
        embedding: asyncio.Task[list[float] | None] | None,
        wanted: int,
        config: AIConfig,
    ) -> dict[uuid.UUID, str]:
        """``page id -> best matching passage``, most similar page first."""
        if embedding is None:
            return {}
        vector = await embedding
        if not vector or not await semantic_tables_exist(self.session):
            return {}
        size = len(vector)  # an int from the gateway's reply, never user text
        distance = f"embedding::vector({size}) <=> CAST(CAST(:query AS text) AS vector({size}))"
        try:
            async with self.session.begin_nested():
                rows = (
                    await self.session.execute(
                        text(
                            f"SELECT page_id, body, 1 - ({distance}) AS similarity "  # noqa: S608
                            f"FROM page_chunks ORDER BY {distance} LIMIT :k"
                        ),
                        {"query": vector_literal(vector), "k": min(wanted, _VECTOR_CANDIDATES)},
                    )
                ).all()
        except SQLAlchemyError:
            # E.g. vectors from a previous embedding model are still being
            # replaced, so their size differs. Keyword results still stand.
            logger.warning("search_semantic_unavailable", exc_info=True)
            return {}
        hits: dict[uuid.UUID, str] = {}
        if not rows:
            return hits
        # Rows come best first. Keep what is close to the best, not just above a fixed
        # score: that is what tells "the right page" from "the least wrong ones".
        best = rows[0][2]
        floor = max(config.tuning.min_similarity, best - config.tuning.margin)
        # Each page counts once, by its best passage, for the spread of the candidates.
        per_page: dict[uuid.UUID, float] = {}
        for page_id, _body, similarity in rows:
            per_page.setdefault(page_id, similarity)
        if len(per_page) >= _OUTLIER_MIN_PAGES:
            scores = list(per_page.values())
            mean = sum(scores) / len(scores)
            spread = (sum((s - mean) ** 2 for s in scores) / len(scores)) ** 0.5
            floor = max(floor, mean + _OUTLIER_Z * spread)
        for page_id, body, similarity in rows:
            if similarity >= floor and page_id not in hits:
                hits[page_id] = body
        return hits


def _highlight_terms(concepts: list[Concept], weights: dict[str, float]) -> list[str]:
    """Folded terms to highlight: those of ideas some page actually mentions."""
    terms: list[str] = []
    for concept in concepts:
        for term in concept.terms():
            if term in weights and term not in terms:
                terms.append(term)
    return terms


def _fuse(*rankings: list[uuid.UUID], weights: tuple[float, ...] | None = None) -> list[uuid.UUID]:
    """Reciprocal rank fusion: a page ranked well by any method rises, one
    ranked well by several rises most. ``weights`` say how much each ranking counts."""
    scores: dict[uuid.UUID, float] = {}
    for index, ranking in enumerate(rankings):
        weight = weights[index] if weights else 1.0
        for position, page_id in enumerate(ranking):
            scores[page_id] = scores.get(page_id, 0.0) + weight / (_RRF_K + position)
    return sorted(scores, key=lambda page_id: scores[page_id], reverse=True)


def _passage_snippet(passage: str, max_len: int = 160) -> str:
    """A matched passage without its title lead, as a short single line."""
    _, _, body = passage.partition("\n")
    plain = " ".join((body or passage).split())
    return plain[:max_len] + ("..." if len(plain) > max_len else "")


async def _embed_query(config: AIConfig, query: str) -> list[float] | None:
    """The query's vector, from a short-lived cache when the same text was just
    searched. ``None`` (never an error) when the gateway cannot answer in time."""
    digest = hashlib.sha256(f"{config.embedding_model}\n{query.lower()}".encode()).hexdigest()
    key = f"search:qvec:{digest}"
    try:
        cached = await get_redis().get(key)
        if cached:
            return json.loads(cached)
    except Exception:  # noqa: BLE001 - the cache is optional
        logger.debug("search_query_cache_read_failed")
    # A self-hosted model that has been idle is unloaded and takes a few seconds to load again.
    # That first search waits for it (and warms it for the next ones) rather than silently
    # falling back to keywords; other sources keep the short limit.
    timeout = config.tuning.query_timeout_seconds
    if config.embedding_source == "ollama":
        timeout = max(timeout, _OLLAMA_COLD_START_SECONDS)
    try:
        vector = (await asyncio.wait_for(embed(config, [query]), timeout=timeout))[0]
    except (EmbeddingError, TimeoutError):
        logger.info("search_query_embedding_unavailable")
        return None
    try:
        await get_redis().set(key, json.dumps(vector), ex=3600)
    except Exception:  # noqa: BLE001
        logger.debug("search_query_cache_write_failed")
    return vector
