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
import contextlib
import hashlib
import json
import math
import re
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

from app.core.exceptions import BadRequestError, NotFoundError
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.models.attachment_text import AttachmentText
from app.models.page import WikiPage
from app.models.permission import Permission
from app.models.space import Space, SpaceStatus
from app.models.user import User
from app.modules.ai.config import AIConfig, load_config
from app.modules.ai.embeddings import EmbeddingError, embed
from app.modules.graph.extract import copy_key
from app.modules.graph.neighbors import related_pages
from app.modules.permissions.service import PermissionService
from app.modules.search.chunking import _blocks
from app.modules.search.indexer import (
    SEARCH_INDEX_LOCK,
    semantic_tables_exist,
    vector_literal,
)
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
#: After the model failed to embed a query in time, searches skip it for this long and
#: use keywords at once: every search waiting out the same timeout made each one slow.
_EMBED_BACKOFF_SECONDS = 60
_EMBED_BACKOFF_KEY = "search:qvec:backoff"
#: How much a semantic ranking counts beside the keyword one when they are fused. Pages the
#: words matched should not be pushed down by pages that are merely "about the same area".
_SEMANTIC_WEIGHT = 0.7
#: A page must match ideas worth at least this share of the query to be listed.
_MIN_COVERAGE = 0.5
#: A page holding at least this share of everything the question asks about is "the wiki holds
#: it": the answer comes from it without anyone being asked where else to look.
_CONFIDENT_COVERAGE = 0.4
#: How strongly a page must be tied to what search found to be read as well (see
#: ``graph.neighbors.WEIGHTS``; the best match counts 1, the second 1/2...). A link
#: or mention from either of the top two matches is enough, as is a similar page or
#: the parent of the best one; a page tied only to a weak match is left out.
_RELATED_MIN_SCORE = 0.75
#: Substring matching only fills in when ranked search found fewer than this.
_SUBSTRING_FILL_BELOW = 5
#: Trigram similarity a title needs to be listed on its likeness to the query alone.
_MIN_TITLE_SIMILARITY = 0.55
#: A search slower than this (seconds) is logged as a warning, with where the time went.
_SLOW_SEARCH_SECONDS = 1.0

_SIMPLE = sa.literal_column("'simple'")
#: ``pages.search_vector`` is maintained by the database (see ``ddl``).
_VECTOR = sa.literal_column("pages.search_vector")
#: The same for the words read from attached files (``attachment_texts``).
_FILE_VECTOR = sa.literal_column("attachment_texts.search_vector")
#: A link to an attached file in a page's content (its id).
_ATTACHMENT_LINK = re.compile(r"/api/v1/attachments/([0-9a-fA-F-]{36})")
#: How much a match inside an attached file counts beside one in a page's own text: the
#: page is about its file, but less surely than about what it says itself.
_FILE_WEIGHT = 0.8
#: Matching files read per page for an answer: a page often holds a handful of documents,
#: and the one with the answer is not always the best match by the words alone.
_FILES_PER_PAGE = 3
#: How much "the pages of the space the question names" counts beside the other rankings:
#: "how many servers does dms4 have" is about the DMS 4.0 space, whatever else mentions dms4.
_SPACE_WEIGHT = 1.2
#: Name parts too common to say which space is meant ("2.team_frontend" is not every team).
_GENERIC_NAME_PARTS = frozenset({"team", "teams", "trungtam", "thong", "chung", "remove", "test"})


@dataclass(slots=True)
class SearchResultPage:
    id: uuid.UUID
    title: str
    slug: str
    space_key: str
    space_name: str
    snippet: str
    updated_at: datetime | None
    #: The attached file the snippet was read from, when the match is in a file.
    file_id: uuid.UUID | None = None
    file_name: str | None = None


@dataclass(slots=True)
class FileRef:
    """A file attached to a page, which part of an answer was read from."""

    id: uuid.UUID
    filename: str


@dataclass(slots=True)
class FileHit:
    """An attached file whose words match the query (see ``attachments.text``)."""

    id: uuid.UUID
    filename: str
    content: str
    #: Share of what the question asks about the file holds, 0 to 1.
    coverage: float


@dataclass(slots=True)
class AnswerPassage:
    """What a question is answered from: a page the asker may read and its matching text."""

    page: SearchResultPage
    text: str
    #: The attached files part of ``text`` was read from.
    files: list[FileRef] = field(default_factory=list)


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
        #: ``page id -> best matching attached file`` of the last page search.
        self.last_file_hits: dict[uuid.UUID, FileHit] = {}
        #: ``page id -> its matching attached files``, best first (a page may hold several).
        self.last_page_files: dict[uuid.UUID, list[FileHit]] = {}

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
            files = await self._file_hits(query, concepts, wanted)
            in_spaces = await self._named_space_pages(query, concepts, wanted)
            keyword_seconds = time.perf_counter() - mark
            mark = time.perf_counter()
            semantic = await self._semantic_hits(embedding, wanted, config)
            semantic_seconds = time.perf_counter() - mark
        finally:
            if embedding is not None and not embedding.done():
                embedding.cancel()

        self.last_file_hits = files
        order = _fuse(
            ranked.ids,
            list(semantic),
            list(files),
            in_spaces,
            weights=(1.0, _SEMANTIC_WEIGHT, _FILE_WEIGHT, _SPACE_WEIGHT),
        )
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
            hit = files.get(page_id)
            file_ref: FileHit | None = None
            if hit is not None and not found:
                # The words are in a file attached to the page, not on the page itself.
                snippet, _ = best_snippet(hit.content, snippet_terms)
                file_ref = hit
            elif passage and not found:
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
                    file_id=file_ref.id if file_ref else None,
                    file_name=file_ref.filename if file_ref else None,
                )
            )
            if len(results) >= limit:
                break
        if results:
            top = ranked.ids[0] if ranked.ids else None
            shown = {result.id for result in results}
            # A file that holds the question counts like a page that does.
            file_top = next(iter(files), None)
            self.last_confidence = (
                "high"
                if (ranked.best_coverage >= _CONFIDENT_COVERAGE and top in shown)
                or (
                    file_top is not None
                    and file_top in shown
                    and files[file_top].coverage >= _CONFIDENT_COVERAGE
                )
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
        # Copies of one page ("Report", "Report (1)"...) say the same thing: reading one
        # leaves room for another page. Ask for more, so the room is filled.
        found, terms = await self._search_pages(query, user, max_pages * 2, permissions)
        results: list[SearchResultPage] = []
        copies: set[tuple[str, ...]] = set()
        for result in found:
            key = copy_key(result.title)
            if key in copies:
                continue
            copies.add(key)
            results.append(result)
            if len(results) >= max_pages:
                break
        if not results:
            return []
        ids = [result.id for result in results]
        config = await load_config(self.session)
        semantic = await self._best_chunks(query, ids, config)
        names = await self._file_names(
            {file_id for chunks in semantic.values() for _, file_id in chunks if file_id}
        )
        contents = dict(
            (
                await self.session.execute(
                    select(WikiPage.id, WikiPage.content).where(WikiPage.id.in_(ids))
                )
            ).all()
        )
        weighted = [(term, 1.0) for term in terms]
        linked = await self._linked_files(contents, user, permissions)
        passages: list[AnswerPassage] = []
        used = 0
        for result in results:
            chunks = semantic.get(result.id, [])
            parts = [body.strip() for body, _ in chunks]
            files = [
                FileRef(f, names[f]) for f in dict.fromkeys(f for _, f in chunks) if f in names
            ]
            window, found = best_snippet(
                contents.get(result.id, ""),
                weighted,
                max_len=passage_chars,
                lead=passage_chars // 4,
            )
            # The stretches with the typed words - of the page and of its matching files - the
            # one holding most of the question first, unless a matched passage already holds it.
            stretches: list[tuple[float, str, FileHit | None]] = []
            if window and (found or not parts):
                stretches.append((_holds(window, weighted), window, None))
            own = self.last_page_files.get(result.id, [])
            seen_files = {hit.id for hit in own}
            candidates = own + [
                hit for hit in linked.get(result.id, []) if hit.id not in seen_files
            ]
            for hit in candidates:
                in_file, hit_found = best_snippet(
                    hit.content, weighted, max_len=passage_chars, lead=passage_chars // 4
                )
                if hit_found:
                    stretches.append(
                        (
                            _holds(in_file, weighted),
                            f"{result.title} - {hit.filename}\n{in_file}",
                            hit,
                        )
                    )
            stretches.sort(key=lambda stretch: stretch[0], reverse=True)
            for _score, stretch, hit in stretches[:2]:
                core = stretch.strip(". ")[:60]
                if core and any(core in part for part in parts):
                    continue
                parts.append(stretch)
                if hit is not None and all(ref.id != hit.id for ref in files):
                    files.append(FileRef(hit.id, hit.filename))
            body = "\n\n".join(part for part in parts if part)[: passage_chars * 2]
            if not body:
                continue
            if passages and used + len(body) > total_chars:
                # A shorter page further down may still fit - and be the one that answers.
                continue
            used += len(body)
            passages.append(AnswerPassage(page=result, text=body, files=files))
        wanted = config.tuning.graph_related_pages
        if wanted and passages and used < total_chars:
            passages.extend(
                await self._related_passages(
                    query,
                    user,
                    permissions,
                    passages,
                    config,
                    weighted,
                    wanted=wanted,
                    passage_chars=passage_chars,
                    room=total_chars - used,
                )
            )
        return passages

    async def _related_passages(
        self,
        query: str,
        user: User,
        permissions: PermissionService,
        found: list[AnswerPassage],
        config: AIConfig,
        terms: list[tuple[str, float]],
        *,
        wanted: int,
        passage_chars: int,
        room: int,
    ) -> list[AnswerPassage]:
        """Text from pages next to the ``found`` ones in the knowledge graph.

        They come after every page search found, in what is left of the budget, so
        they can only add to an answer - never push out what search found. Only
        pages ``user`` may read are taken.
        """
        started = time.perf_counter()
        seeds = {passage.page.id: 1.0 / (rank + 1) for rank, passage in enumerate(found)}
        try:
            async with self.session.begin_nested():
                neighbors = await related_pages(self.session, seeds, limit=wanted * 3)
        except SQLAlchemyError:
            logger.warning("search_related_unavailable", exc_info=True)
            return []
        chosen = []
        for neighbor in neighbors:
            if neighbor.score < _RELATED_MIN_SCORE:
                break
            # An empty page (a blank space home page, say) has nothing to add.
            if not plain_text(neighbor.page.content):
                continue
            if await permissions.can_view_page(neighbor.page, user):
                chosen.append(neighbor)
                if len(chosen) >= wanted:
                    break
        if not chosen:
            return []
        semantic = await self._best_passages(
            query, [neighbor.page.id for neighbor in chosen], config, per_page=1
        )
        out: list[AnswerPassage] = []
        for neighbor in chosen:
            page = neighbor.page
            body = next(iter(semantic.get(page.id, [])), "").strip()
            if not body:
                window, hit = best_snippet(
                    page.content, terms, max_len=passage_chars, lead=passage_chars // 4
                )
                # No passage close to the question: the start of the page says what it is.
                body = window if hit else plain_text(page.content)[:passage_chars]
            body = body[:passage_chars].strip()
            if not body or len(body) > room:
                continue
            room -= len(body)
            out.append(
                AnswerPassage(
                    page=SearchResultPage(
                        id=page.id,
                        title=page.title,
                        slug=page.slug,
                        space_key=page.space.key,
                        space_name=page.space.name,
                        snippet="",
                        updated_at=page.updated_at,
                    ),
                    text=body,
                )
            )
        logger.info(
            "search_related_pages",
            seeds=len(seeds),
            neighbors=len(neighbors),
            added=len(out),
            via=[neighbor.via[0] for neighbor in chosen if neighbor.via],
            seconds=round(time.perf_counter() - started, 3),
        )
        return out

    async def file_context(
        self, attachment_id: uuid.UUID, query: str, user: User, *, total_chars: int = 12000
    ) -> AnswerContext:
        """What a question about one attached file is answered from: that file alone.

        A short file is read whole; a long one gives its passages closest to the question (by
        meaning and by the words asked for) and its opening, which says what it is. Raises
        ``NotFoundError`` unless ``user`` may read the page the file is attached to, and
        ``BadRequestError`` when the file's words could not be read.
        """
        row = (
            await self.session.execute(
                select(AttachmentText, WikiPage)
                .join(WikiPage, WikiPage.id == AttachmentText.page_id)
                .options(selectinload(WikiPage.space))
                .where(AttachmentText.attachment_id == attachment_id)
            )
        ).first()
        if row is None:
            raise NotFoundError("Attachment not found.")
        reading, page = row
        if page.space.status != SpaceStatus.active or not await PermissionService(
            self.session
        ).can_view_page(page, user):
            raise NotFoundError("Attachment not found.")
        if reading.status != "ok":
            raise BadRequestError("The words in this file could not be read.")
        source = SearchResultPage(
            id=page.id,
            title=page.title,
            slug=page.slug,
            space_key=page.space.key,
            space_name=page.space.name,
            snippet="",
            updated_at=page.updated_at,
        )
        lead = f"{page.title} - {reading.filename}"
        whole = _readable_text(reading.content)
        if len(whole) <= total_chars:
            parts = [whole]
        else:
            parts = []
            config = await load_config(self.session)
            for body in await self._file_chunks(query, attachment_id, config):
                parts.append(body.partition("\n")[2] or body)
            terms = [(term, 1.0) for c in build_concepts(query) for term in c.terms()]
            window, found = best_snippet(reading.content, terms, max_len=1500, lead=300)
            if found:
                parts.append(window)
            parts.insert(0, whole[:2000])
            kept, used = [], 0
            for part in parts:
                if used + len(part) > total_chars:
                    break
                kept.append(part)
                used += len(part)
            parts = kept
        text_ = f"{lead}\n" + "\n\n...\n\n".join(parts)
        passage = AnswerPassage(
            page=source, text=text_, files=[FileRef(attachment_id, reading.filename)]
        )
        return AnswerContext([passage], "high")

    async def _file_chunks(
        self, query: str, attachment_id: uuid.UUID, config: AIConfig, limit: int = 6
    ) -> list[str]:
        """The indexed passages of one file closest in meaning to ``query``."""
        if not config.embeddings_ready or len(query) < 3:
            return []
        vector = await _embed_query(config, query)
        if not vector or not await semantic_tables_exist(self.session):
            return []
        size = len(vector)  # an int from the gateway's reply, never user text
        distance = f"embedding::vector({size}) <=> CAST(CAST(:query AS text) AS vector({size}))"
        try:
            async with self.session.begin_nested():
                return list(
                    (
                        await self.session.scalars(
                            text(
                                f"SELECT body FROM page_chunks WHERE attachment_id = :file "  # noqa: S608
                                f"ORDER BY {distance} LIMIT :k"
                            ),
                            {"query": vector_literal(vector), "file": attachment_id, "k": limit},
                        )
                    ).all()
                )
        except SQLAlchemyError:
            logger.warning("search_semantic_unavailable", exc_info=True)
            return []

    async def answer_context(self, query: str, user: User, **limits: int) -> AnswerContext:
        """:meth:`answer_passages` with how well the wiki matched the question."""
        passages = await self.answer_passages(query, user, **limits)
        return AnswerContext(passages, self.last_confidence if passages else "none")

    async def _best_passages(
        self, query: str, ids: list[uuid.UUID], config: AIConfig, per_page: int = 2
    ) -> dict[uuid.UUID, list[str]]:
        """The indexed passages of these pages closest in meaning to ``query``, best first."""
        chunks = await self._best_chunks(query, ids, config, per_page)
        return {page_id: [body for body, _ in found] for page_id, found in chunks.items()}

    async def _linked_files(
        self, contents: dict[uuid.UUID, str], user: User, permissions: PermissionService
    ) -> dict[uuid.UUID, list[FileHit]]:
        """``page id -> the read files its content links to``, wherever they are attached.

        A page often links a file attached to another page ("see Policy.pdf"); what the file
        says answers questions about the linking page too. A file counts only when ``user``
        may read the page it is attached to.
        """
        wanted: dict[uuid.UUID, set[uuid.UUID]] = {}
        for page_id, content in contents.items():
            for found in _ATTACHMENT_LINK.findall(content or ""):
                with contextlib.suppress(ValueError):
                    wanted.setdefault(page_id, set()).add(uuid.UUID(found))
        ids = set().union(*wanted.values()) if wanted else set()
        if not ids:
            return {}
        rows = (
            await self.session.execute(
                select(AttachmentText, WikiPage)
                .join(WikiPage, WikiPage.id == AttachmentText.page_id)
                .options(selectinload(WikiPage.space))
                .where(AttachmentText.attachment_id.in_(ids), AttachmentText.status == "ok")
            )
        ).all()
        readable: dict[uuid.UUID, FileHit] = {}
        for reading, owner in rows:
            if owner.space.status == SpaceStatus.active and await permissions.can_view_page(
                owner, user
            ):
                readable[reading.attachment_id] = FileHit(
                    reading.attachment_id, reading.filename, reading.content, 0.0
                )
        return {
            page_id: [readable[i] for i in sorted(files) if i in readable]
            for page_id, files in wanted.items()
        }

    async def _file_names(self, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
        if not ids:
            return {}
        rows = await self.session.execute(
            select(AttachmentText.attachment_id, AttachmentText.filename).where(
                AttachmentText.attachment_id.in_(ids)
            )
        )
        return dict(rows.tuples().all())

    async def _best_chunks(
        self, query: str, ids: list[uuid.UUID], config: AIConfig, per_page: int = 2
    ) -> dict[uuid.UUID, list[tuple[str, uuid.UUID | None]]]:
        """:meth:`_best_passages` with the attached file each passage was read from
        (``None`` for the page's own text)."""
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
                            f"SELECT page_id, body, 1 - ({distance}) AS similarity, "  # noqa: S608
                            f"attachment_id FROM page_chunks WHERE page_id IN ({listed}) "
                            f"ORDER BY {distance} LIMIT 20"
                        ),
                        {"query": vector_literal(vector)},
                    )
                ).all()
        except SQLAlchemyError:
            logger.warning("search_semantic_unavailable", exc_info=True)
            return {}
        found: dict[uuid.UUID, list[tuple[str, uuid.UUID | None]]] = {}
        for page_id, body, similarity, file_id in rows:
            if similarity < config.tuning.min_similarity:
                continue
            bucket = found.setdefault(page_id, [])
            if len(bucket) < per_page:
                bucket.append((body, file_id))
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

    async def _file_hits(
        self, query: str, concepts: list[Concept], wanted: int
    ) -> dict[uuid.UUID, FileHit]:
        """``page id -> its best matching attached file``, best page first.

        Ranked like the pages' own text: a file must hold at least half of what the question
        asks about, and one whose name holds the question comes first, as a page's title
        does. Pages in the Trash or archived spaces are left out; whether the person may read
        the page is checked with the page, by the caller.
        """
        if not concepts:
            return {}
        try:
            async with self.session.begin_nested():
                weights, _absent = await self._idea_weights(concepts)
                # An idea no page mentions may still be in a file: it then weighs the most.
                rarest = max([*weights, 1.0])
                live = [(c, w or rarest) for c, w in zip(concepts, weights, strict=True)]
                total_weight = sum(w for _, w in live)
                queries = [sa.func.to_tsquery(_SIMPLE, c.tsquery()) for c, _ in live]
                any_idea = sa.func.to_tsquery(
                    _SIMPLE, " | ".join(f"({c.tsquery()})" for c, _ in live)
                )
                key_text = fold(query).strip()
                name_key = sa.func.wh_title_key(AttachmentText.filename)
                name_like = f"%{like_escape(key_text)}%"
                held = reduce(
                    lambda a, b: a + b,
                    (
                        sa.case((_FILE_VECTOR.op("@@")(q), w), else_=0.0)
                        for q, (_, w) in zip(queries, live, strict=True)
                    ),
                )
                rows = (
                    await self.session.execute(
                        select(
                            AttachmentText.page_id,
                            AttachmentText.attachment_id,
                            AttachmentText.filename,
                            AttachmentText.content,
                            held.label("held"),
                        )
                        .join(WikiPage, WikiPage.id == AttachmentText.page_id)
                        .join(Space, WikiPage.space_id == Space.id)
                        .where(
                            Space.status == SpaceStatus.active,
                            AttachmentText.status == "ok",
                            _FILE_VECTOR.op("@@")(any_idea),
                            held >= _MIN_COVERAGE * total_weight,
                        )
                        .order_by(
                            (
                                held
                                + sa.case((name_key.like(name_like, escape="\\"), 3.0), else_=0.0)
                                + sa.func.similarity(name_key, key_text)
                                + 0.5 * sa.func.ts_rank_cd(_FILE_VECTOR, any_idea, 32)
                            ).desc()
                        )
                        .limit(wanted * _FILES_PER_PAGE)
                    )
                ).all()
        except SQLAlchemyError:
            # No search functions here (or no ``attachment_texts.search_vector`` yet).
            logger.debug("search_file_hits_unavailable", exc_info=True)
            return {}
        per_page: dict[uuid.UUID, list[FileHit]] = {}
        for page_id, file_id, filename, content, weight in rows:
            files = per_page.setdefault(page_id, [])
            if len(files) < _FILES_PER_PAGE:
                coverage = min(float(weight) / max(total_weight, 1e-9), 1.0)
                files.append(FileHit(file_id, filename, content, coverage))
        self.last_page_files = per_page
        return {page_id: files[0] for page_id, files in per_page.items()}

    async def _named_space_pages(
        self, query: str, concepts: list[Concept], wanted: int
    ) -> list[uuid.UUID]:
        """Pages of the space(s) the question names, ranked by the rest of the question.

        People call a project by its space: "dms4" for the space ``3DMS40``, "voffice" for
        ``3.voffice``. A word of the question that is a space's key or name (or, holding a
        digit, the start of one: "dms4" for "dms40") picks that space; its pages are then
        ranked by the other ideas of the question. Nothing when no space is named or nothing
        else is asked.
        """
        tokens = {t for t in re.findall(r"[a-z0-9]+", fold(query)) if len(t) >= 3}
        if not tokens:
            return []
        spaces = (
            await self.session.execute(
                select(Space.id, Space.key, Space.name).where(Space.status == SpaceStatus.active)
            )
        ).all()
        named: list[uuid.UUID] = []
        used: set[str] = set()
        for space_id, key, name in spaces:
            for token in tokens:
                if _names_space(token, key, name):
                    named.append(space_id)
                    used.add(token)
        rest = [c for c in concepts if not any(w in used for w in c.words)]
        if not named or not rest:
            return []
        try:
            async with self.session.begin_nested():
                queries = [sa.func.to_tsquery(_SIMPLE, c.tsquery()) for c in rest]
                any_idea = sa.func.to_tsquery(_SIMPLE, " | ".join(f"({c.tsquery()})" for c in rest))
                title_vector = sa.func.to_tsvector(_SIMPLE, sa.func.wh_title_key(WikiPage.title))
                score = reduce(
                    lambda a, b: a + b,
                    (
                        sa.case((_VECTOR.op("@@")(q), 1.0), else_=0.0)
                        + sa.case((title_vector.op("@@")(q), 1.5), else_=0.0)
                        for q in queries
                    ),
                ) + 0.5 * sa.func.ts_rank_cd(_VECTOR, any_idea, 32)
                return list(
                    (
                        await self.session.scalars(
                            select(WikiPage.id)
                            .where(WikiPage.space_id.in_(named), _VECTOR.op("@@")(any_idea))
                            .order_by(score.desc(), WikiPage.updated_at.desc())
                            .limit(wanted)
                        )
                    ).all()
                )
        except SQLAlchemyError:
            logger.debug("search_named_space_unavailable", exc_info=True)
            return []

    async def unknown_terms(self, query: str) -> list[str]:
        """Words of ``query`` that no page of the wiki mentions at all (``"9router"``).

        A name the wiki has never heard of is no internal name: asking the person which one
        they mean helps nobody, and the internet may well know it.
        """
        concepts = build_concepts(query)
        if not concepts:
            return []
        try:
            async with self.session.begin_nested():
                weights, _ = await self._idea_weights(concepts)
        except SQLAlchemyError:
            return []
        unknown = {
            " ".join(c.words)
            for c, weight in zip(concepts, weights, strict=True)
            if not weight and any(len(word) >= 3 for word in c.words)
        }
        # Only what looks like a name: a word with a digit ("9router", "k3s") or capitals past
        # its first letter or mid-sentence ("OpenClaw"). An ordinary word the wiki happens not
        # to use ("travel" in an English question to a Vietnamese wiki) is no name.
        words = re.findall(r"\w+", query)
        return [
            word
            for index, word in enumerate(words)
            if fold(word) in unknown
            and (
                any(ch.isdigit() for ch in word)
                or any(ch.isupper() for ch in word[1:])
                or (index > 0 and word[:1].isupper())
            )
        ]

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


def _space_aliases(key: str, name: str) -> tuple[set[str], set[str]]:
    """What a space may be called: its key and name run together, without the leading
    ordering number ("3DMS40" -> "dms40", "3.dms.saas" -> "dmssaas"); and the telling parts
    of its name ("2.team_devops" -> "devops")."""

    def bare(value: str) -> str:
        return re.sub(r"^[0-9]+[ ._-]*", "", fold(value).strip()).replace("~", "")

    whole = {re.sub(r"[^a-z0-9]", "", bare(value)) for value in (key, name)}
    parts = {
        part
        for part in re.split(r"[^a-z0-9]+", bare(name))
        if len(part) >= 5 and part not in _GENERIC_NAME_PARTS
    }
    return {a for a in whole if len(a) >= 3 and a not in _GENERIC_NAME_PARTS}, parts


def _names_space(token: str, key: str, name: str) -> bool:
    """Whether one word of a question names this space (see ``_space_aliases``)."""
    whole, parts = _space_aliases(key, name)
    if token in whole or token in parts:
        return True
    # "dms4" for "dms40": a word with a digit that is most of a key or name.
    return any(char.isdigit() for char in token) and any(
        alias.startswith(token) and len(alias) - len(token) <= 2 for alias in whole
    )


def _holds(passage: str, terms: list[tuple[str, float]]) -> float:
    """How much of the question a stretch of text holds: the weight of the terms in it."""
    folded = fold(passage)
    return sum(weight for term, weight in terms if term and term in folded)


def _readable_text(markup: str) -> str:
    """Markup read from a file as text a model reads well: a line per paragraph, headings
    marked."""
    return "\n".join(
        f"## {words}" if is_heading else words for is_heading, words in _blocks(markup)
    )


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
    indexing = False
    try:
        redis = get_redis()
        if await redis.get(_EMBED_BACKOFF_KEY):
            # It just failed to answer in time: do not make this search wait for it too.
            logger.debug("search_query_embedding_backoff")
            return None
        indexing = bool(await redis.exists(SEARCH_INDEX_LOCK))
    except Exception:  # noqa: BLE001 - the cache is optional
        logger.debug("search_query_cache_read_failed")
    # A self-hosted model that has been idle is unloaded and takes a few seconds to load again.
    # That first search waits for it (and warms it for the next ones) rather than silently
    # falling back to keywords; other sources keep the short limit. While pages are being
    # indexed the model is loaded already, only busy: waiting longer would not help.
    timeout = config.tuning.query_timeout_seconds
    if config.embedding_source == "ollama" and not indexing:
        timeout = max(timeout, _OLLAMA_COLD_START_SECONDS)
    try:
        vector = (await asyncio.wait_for(embed(config, [query]), timeout=timeout))[0]
    except (EmbeddingError, TimeoutError):
        logger.info("search_query_embedding_unavailable", indexing=indexing, waited=timeout)
        try:
            await get_redis().set(_EMBED_BACKOFF_KEY, "1", ex=_EMBED_BACKOFF_SECONDS)
        except Exception:  # noqa: BLE001
            logger.debug("search_query_cache_write_failed")
        return None
    try:
        await get_redis().set(key, json.dumps(vector), ex=3600)
    except Exception:  # noqa: BLE001
        logger.debug("search_query_cache_write_failed")
    return vector
