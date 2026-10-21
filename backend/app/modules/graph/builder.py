"""Keeps ``page_links`` in step with the pages, in the background.

Like the search indexer, the builder *polls*: a page whose ``updated_at`` (or, for
``similar`` edges, whose embeddings) no longer match what its edges were worked out
from is stale. That covers every way a page changes - the editor, an import, a
restore from the Trash, a move - and a backfill of an existing wiki is simply
"every page is stale". A crash leaves pages stale until the next pass.

``link`` and ``mention`` edges need no AI at all. ``similar`` edges come from the
embeddings semantic search already keeps in ``page_chunks``; no model is called.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field

import sqlalchemy as sa
from sqlalchemy import delete, select, text, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.page import WikiPage
from app.models.page_graph import PageGraphState, PageLink
from app.models.space import Space, SpaceStatus
from app.modules.ai.config import AIConfig
from app.modules.graph.extract import (
    TitledPage,
    TitleIndex,
    copy_key,
    internal_links,
    title_words,
)
from app.modules.search.indexer import semantic_tables_exist

logger = get_logger(__name__)

#: Pages whose links and mentions are worked out per pass. Cheap: no AI involved.
TEXT_BATCH = 200
#: Pages whose similar pages are worked out per pass.
SIMILAR_BATCH = 50
#: How many similar pages each page keeps.
SIMILAR_PER_PAGE = 5
#: Two pages this alike are copies of each other: one adds nothing to the other.
NEAR_DUPLICATE = 0.97
#: Pages re-read for mentions when a page gets a new title. More than this many
#: naming it means the title is a common phrase, not that page.
MAX_INCOMING_RESCANS = 200


@dataclass
class PassResult:
    text_pages: int = 0
    rescanned: int = 0
    similar_pages: int = 0
    forgotten: int = 0
    similar_dropped: int = 0
    stopped: str = "batch_done"
    seconds: float = 0.0
    errors: list[str] = field(default_factory=list)


async def replace_edges(
    session: AsyncSession,
    source_id: uuid.UUID,
    kind: str,
    targets: Sequence[uuid.UUID] | Sequence[tuple[uuid.UUID, float]],
) -> None:
    """Make ``targets`` the only ``kind`` edges leaving ``source_id``.

    A target is a page id, or ``(page id, weight)``.
    """
    await session.execute(
        delete(PageLink).where(PageLink.source_page_id == source_id, PageLink.kind == kind)
    )
    rows = []
    for target in targets:
        target_id, weight = target if isinstance(target, tuple) else (target, 1.0)
        if target_id != source_id:
            rows.append(
                {
                    "source_page_id": source_id,
                    "target_page_id": target_id,
                    "kind": kind,
                    "weight": weight,
                }
            )
    if rows:
        await session.execute(insert(PageLink).on_conflict_do_nothing(), rows)


async def _title_index(session: AsyncSession) -> TitleIndex:
    rows = await session.execute(
        select(WikiPage.id, WikiPage.space_id, WikiPage.title)
        .join(Space, Space.id == WikiPage.space_id)
        # An empty page (a space's blank home page, say) has nothing to read: naming
        # its title - often the space's own name - ties nothing together.
        .where(
            Space.status == SpaceStatus.active, sa.func.length(sa.func.trim(WikiPage.content)) > 0
        )
    )
    return TitleIndex(TitledPage(*row) for row in rows)


def _stale_text_pages(limit: int) -> sa.Select:
    """Live pages with no state yet, or edited since their edges were worked out."""
    return (
        select(
            WikiPage.id,
            WikiPage.space_id,
            WikiPage.title,
            WikiPage.content,
            WikiPage.updated_at,
            PageGraphState.title,
        )
        .join(Space, Space.id == WikiPage.space_id)
        .outerjoin(PageGraphState, PageGraphState.page_id == WikiPage.id)
        .where(
            Space.status == SpaceStatus.active,
            sa.or_(
                PageGraphState.page_id.is_(None),
                PageGraphState.source_updated_at != WikiPage.updated_at,
            ),
        )
        .order_by(WikiPage.updated_at.desc())
        .limit(limit)
    )


async def _linked_ids(
    session: AsyncSession, links: list[tuple[str, str]], page_id: uuid.UUID
) -> list[uuid.UUID]:
    """The pages behind ``(space key, slug)`` links, in the order they were linked."""
    if not links:
        return []
    rows = await session.execute(
        select(Space.key, WikiPage.slug, WikiPage.id)
        .join(Space, Space.id == WikiPage.space_id)
        .where(tuple_(Space.key, WikiPage.slug).in_(links))
    )
    by_link = {(key, slug): target for key, slug, target in rows}
    found: dict[uuid.UUID, None] = {}
    for link in links:
        target = by_link.get(link)
        if target is not None and target != page_id:
            found.setdefault(target)
    return list(found)


async def _search_vector_ready(session: AsyncSession) -> bool:
    return bool(
        await session.scalar(
            text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                "WHERE table_schema = current_schema() AND table_name = 'pages' "
                "AND column_name = 'search_vector')"
            )
        )
    )


async def _pages_naming(
    session: AsyncSession, title: str, exclude: uuid.UUID, *, use_search_vector: bool
) -> list[uuid.UUID]:
    """Pages whose text may name ``title``: candidates, confirmed by the matcher after."""
    condition: sa.ColumnElement[bool] | sa.TextClause = (
        text("search_vector @@ phraseto_tsquery('simple', wh_unaccent(:title))")
        if use_search_vector
        else WikiPage.content.icontains(title, autoescape=True)
    )
    rows = await session.scalars(
        select(WikiPage.id)
        .join(Space, Space.id == WikiPage.space_id)
        .where(Space.status == SpaceStatus.active, WikiPage.id != exclude, condition)
        .limit(MAX_INCOMING_RESCANS + 1),
        {"title": title},
    )
    return list(rows)


async def _rescan_mentions(
    session: AsyncSession, index: TitleIndex, page_ids: Sequence[uuid.UUID]
) -> int:
    rows = await session.execute(
        select(WikiPage.id, WikiPage.space_id, WikiPage.title, WikiPage.content).where(
            WikiPage.id.in_(list(page_ids))
        )
    )
    count = 0
    for page_id, space_id, title, content in rows:
        mentions = index.mentions(title, content, page_id=page_id, space_id=space_id)
        await replace_edges(session, page_id, "mention", mentions)
        count += 1
    return count


async def _forget_trashed(session: AsyncSession) -> int:
    """Drop the state of pages now in the Trash, keeping their edges.

    Readers already skip a page in the Trash. Forgetting its state means that if it
    comes back, it is treated as new: the pages naming it are found again.
    """
    trashed = select(WikiPage.id).where(WikiPage.deleted_at.is_not(None))
    result = await session.execute(
        delete(PageGraphState)
        .where(PageGraphState.page_id.in_(trashed.scalar_subquery()))
        .returning(PageGraphState.page_id)
    )
    return len(result.all())


async def build_text_edges(
    session: AsyncSession,
    *,
    batch: int = TEXT_BATCH,
    deadline: float | None = None,
    heartbeat: Callable[[], Awaitable[None]] | None = None,
    result: PassResult | None = None,
) -> PassResult:
    """Work out ``link`` and ``mention`` edges of stale pages, newest first."""
    result = result or PassResult()
    result.forgotten += await _forget_trashed(session)
    await session.commit()
    pages = (await session.execute(_stale_text_pages(batch))).all()
    if not pages:
        return result
    index = await _title_index(session)
    #: Every page of this batch is matched against today's titles, new ones included.
    batch_ids = {row[0] for row in pages}
    #: Those not handled yet: each gets its own full pass shortly.
    pending = set(batch_ids)
    use_search_vector = await _search_vector_ready(session)
    for page_id, space_id, title, content, updated_at, known_title in pages:
        if deadline is not None and time.monotonic() >= deadline:
            result.stopped = "time_budget"
            break
        pending.discard(page_id)
        try:
            links = await _linked_ids(session, internal_links(content), page_id)
            mentions = index.mentions(title, content, page_id=page_id, space_id=space_id)
            await replace_edges(session, page_id, "link", links)
            await replace_edges(session, page_id, "mention", mentions)
            if known_title != title:
                # New or renamed: pages already naming the title should now point
                # here. Pages of this batch already do, or will.
                skip = batch_ids
                if known_title is not None:
                    # Renamed: pages naming the old title no longer name this one.
                    # The delete also takes away mentions found earlier in this
                    # pass, so those pages are read again too.
                    await session.execute(
                        delete(PageLink).where(
                            PageLink.target_page_id == page_id, PageLink.kind == "mention"
                        )
                    )
                    skip = pending
                if index.resolve(title_words(title), space_id) is not None:
                    naming = await _pages_naming(
                        session, title, page_id, use_search_vector=use_search_vector
                    )
                    if len(naming) <= MAX_INCOMING_RESCANS:
                        fresh = [other for other in naming if other not in skip]
                        result.rescanned += await _rescan_mentions(session, index, fresh)
            await session.execute(
                insert(PageGraphState)
                .values(page_id=page_id, source_updated_at=updated_at, title=title)
                .on_conflict_do_update(
                    index_elements=[PageGraphState.page_id],
                    set_={"source_updated_at": updated_at, "title": title},
                )
            )
            await session.commit()
        except SQLAlchemyError:
            # E.g. the page was purged while this pass was reading it.
            await session.rollback()
            result.errors.append(str(page_id))
            logger.warning("graph_page_failed", page_id=str(page_id), exc_info=True)
            continue
        result.text_pages += 1
        if heartbeat is not None:
            await heartbeat()
    return result


async def _forget_other_model(session: AsyncSession, model: str) -> int:
    """Drop ``similar`` edges of pages not indexed with ``model``.

    Changing the embedding model empties the search index, so every page's likeness
    was measured with vectors that are gone: its edges go, and come back as the page
    is embedded again with the new model.
    """
    removed = await session.execute(
        text(
            "DELETE FROM page_links l WHERE l.kind = 'similar' AND NOT EXISTS ("
            "SELECT 1 FROM page_search_state s "
            "WHERE s.page_id = l.source_page_id AND s.model = :model) "
            "RETURNING l.source_page_id"
        ),
        {"model": model},
    )
    count = len(removed.all())
    await session.execute(
        text(
            "UPDATE page_graph_state g SET similar_indexed_at = NULL "
            "WHERE g.similar_indexed_at IS NOT NULL AND NOT EXISTS ("
            "SELECT 1 FROM page_search_state s WHERE s.page_id = g.page_id AND s.model = :model)"
        ),
        {"model": model},
    )
    await session.commit()
    return count


async def build_similar_edges(
    session: AsyncSession,
    config: AIConfig,
    *,
    batch: int = SIMILAR_BATCH,
    result: PassResult | None = None,
) -> PassResult:
    """Work out ``similar`` edges of pages embedded since they were last worked out.

    A page is compared by the mean of its passages' vectors with every other
    page's. Only pages whose ``link``/``mention`` state exists are handled, so a
    page's state row is always created by :func:`build_text_edges` first.
    """
    result = result or PassResult()
    if not config.embeddings_ready or not await semantic_tables_exist(session):
        return result
    result.similar_dropped += await _forget_other_model(session, config.embedding_model)
    stale = (
        await session.execute(
            text(
                "SELECT g.page_id, s.indexed_at FROM page_graph_state g "
                "JOIN page_search_state s ON s.page_id = g.page_id "
                "WHERE s.model = :model AND s.chunk_count > 0 "
                "AND g.similar_indexed_at IS DISTINCT FROM s.indexed_at "
                "ORDER BY s.indexed_at DESC LIMIT :limit"
            ),
            {"model": config.embedding_model, "limit": batch},
        )
    ).all()
    if not stale:
        return result
    ids = [page_id for page_id, _ in stale]
    threshold = config.tuning.graph_min_similarity
    try:
        rows = (
            await session.execute(
                text(
                    # Every live page's mean vector, then each stale page's nearest.
                    "WITH live AS MATERIALIZED ("
                    "  SELECT c.page_id, avg(c.embedding) AS v FROM page_chunks c "
                    "  JOIN pages p ON p.id = c.page_id AND p.deleted_at IS NULL "
                    "  JOIN spaces sp ON sp.id = p.space_id AND sp.status = 'active' "
                    # What the page itself says: attached files would blur it.
                    "  WHERE c.attachment_id IS NULL "
                    "  GROUP BY c.page_id"
                    ") "
                    "SELECT s.page_id, sp.title, n.page_id, n.title, n.similarity FROM live s "
                    "JOIN pages sp ON sp.id = s.page_id "
                    "CROSS JOIN LATERAL ("
                    "  SELECT o.page_id, op.title, 1 - (s.v <=> o.v) AS similarity FROM live o "
                    "  JOIN pages op ON op.id = o.page_id "
                    "  WHERE o.page_id <> s.page_id ORDER BY s.v <=> o.v LIMIT :wanted"
                    ") n WHERE s.page_id = ANY(:ids)"
                ),
                # Copies are skipped after, so look a good deal further.
                {"ids": ids, "wanted": SIMILAR_PER_PAGE * 6},
            )
        ).all()
    except SQLAlchemyError:
        await session.rollback()
        logger.warning("graph_similar_unavailable", exc_info=True)
        result.errors.append("similar")
        return result
    nearest: dict[uuid.UUID, list[tuple[uuid.UUID, float]]] = {page_id: [] for page_id in ids}
    #: Per page, the copies already taken (and the page's own): one copy is enough.
    taken: dict[uuid.UUID, set[tuple[str, ...]]] = {}
    for page_id, title, other, other_title, similarity in rows:
        similarity = float(similarity)
        bucket = nearest[page_id]
        seen = taken.setdefault(page_id, {copy_key(title)})
        key = copy_key(other_title)
        if (
            threshold <= similarity < NEAR_DUPLICATE
            and len(bucket) < SIMILAR_PER_PAGE
            and key not in seen
        ):
            seen.add(key)
            bucket.append((other, round(similarity, 4)))
    for page_id, indexed_at in stale:
        try:
            await replace_edges(session, page_id, "similar", nearest.get(page_id, []))
            await session.execute(
                sa.update(PageGraphState)
                .where(PageGraphState.page_id == page_id)
                .values(similar_indexed_at=indexed_at)
            )
            await session.commit()
        except SQLAlchemyError:
            await session.rollback()
            result.errors.append(str(page_id))
            logger.warning("graph_similar_page_failed", page_id=str(page_id), exc_info=True)
            continue
        result.similar_pages += 1
    return result


async def build_pending(
    session: AsyncSession,
    config: AIConfig,
    *,
    deadline: float | None = None,
    heartbeat: Callable[[], Awaitable[None]] | None = None,
) -> PassResult:
    """One pass: links and mentions first, then similar pages.

    Logs one ``graph_build_pass`` line whenever it did anything.
    """
    started = time.monotonic()
    result = await build_text_edges(session, deadline=deadline, heartbeat=heartbeat)
    if deadline is None or time.monotonic() < deadline:
        await build_similar_edges(session, config, result=result)
    result.seconds = round(time.monotonic() - started, 2)
    if (
        result.text_pages
        or result.similar_pages
        or result.forgotten
        or result.similar_dropped
        or result.errors
    ):
        logger.info(
            "graph_build_pass",
            text_pages=result.text_pages,
            rescanned=result.rescanned,
            similar_pages=result.similar_pages,
            forgotten=result.forgotten,
            similar_dropped=result.similar_dropped,
            errors=len(result.errors),
            stopped=result.stopped,
            seconds=result.seconds,
        )
    return result
