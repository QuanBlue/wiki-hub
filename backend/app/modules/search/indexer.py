"""Keeps the semantic index (``page_chunks``) in step with the pages.

The indexer *polls* for pages whose ``updated_at`` no longer matches what was
indexed, instead of hooking every code path that writes a page (editor save,
restore, Confluence import, restrictions...). One mechanism covers them all, a
backfill of an existing wiki is just "everything is stale", and a crash or a
gateway outage simply leaves pages stale until the next pass - nothing is lost.
"""

from __future__ import annotations

import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.redis import get_redis
from app.models.page import WikiPage
from app.models.space import Space, SpaceStatus
from app.modules.ai.config import AIConfig
from app.modules.ai.embeddings import EmbeddingError, embed
from app.modules.search.chunking import chunk_page

logger = get_logger(__name__)

#: pgvector's HNSW index handles vectors up to this many dimensions.
MAX_INDEXED_DIMENSIONS = 2000

_state = sa.table(
    "page_search_state",
    sa.column("page_id"),
    sa.column("source_updated_at"),
    sa.column("model"),
    sa.column("chunk_count"),
)

_dimensions_with_index: set[int] = set()

#: ``page_search_state.chunk_count`` of a page the gateway refused to embed,
#: after others succeeded. It counts as handled (so it does not block the
#: queue) until the page is edited. ``0`` is never a legitimate count - even an
#: empty page has its title - so such rows are treated as not indexed.
SKIPPED = -1

#: Why the last indexing pass stopped, for the administrator to read.
_ERROR_KEY = "search:index:error"

#: Pages in a row the gateway may refuse, with none accepted, before concluding
#: the model itself cannot embed.
_REFUSALS_BEFORE_PAUSE = 3


async def _remember_error(model: str, message: str | None) -> None:
    try:
        if message:
            await get_redis().set(
                _ERROR_KEY, json.dumps({"model": model, "message": message}), ex=86400
            )
        else:
            await get_redis().delete(_ERROR_KEY)
    except Exception:  # noqa: BLE001 - this is only a hint for the UI
        logger.debug("search_index_error_note_failed")


async def last_error(model: str) -> str | None:
    """Why indexing with ``model`` last stopped, if it did and nothing has worked since."""
    try:
        raw = await get_redis().get(_ERROR_KEY)
        note = json.loads(raw) if raw else None
    except Exception:  # noqa: BLE001
        return None
    return note["message"] if note and note.get("model") == model else None


def vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(repr(x) for x in vector) + "]"


async def semantic_tables_exist(session: AsyncSession) -> bool:
    """Whether the migration could create the tables (needs the ``vector`` extension)."""
    return bool(
        await session.scalar(
            text(
                "SELECT to_regclass('page_chunks') IS NOT NULL "
                "AND to_regclass('page_search_state') IS NOT NULL"
            )
        )
    )


async def ensure_vector_index(session: AsyncSession, dimensions: int) -> None:
    """Nearest-neighbour index for vectors of this size (a no-op once it exists)."""
    if dimensions in _dimensions_with_index or not 0 < dimensions <= MAX_INDEXED_DIMENSIONS:
        return
    # ``dimensions`` is an int from our own code, never user text.
    await session.execute(
        text(
            f"CREATE INDEX IF NOT EXISTS ix_page_chunks_embedding_{dimensions} "
            f"ON page_chunks USING hnsw ((embedding::vector({dimensions})) vector_cosine_ops)"
        )
    )
    await session.commit()
    _dimensions_with_index.add(dimensions)


async def reset_if_model_changed(session: AsyncSession, model: str) -> bool:
    """Drop every vector when the embedding model changed: vectors from two
    models (or sizes) cannot be compared, so the wiki is simply re-indexed."""
    changed = await session.scalar(
        text("SELECT EXISTS (SELECT 1 FROM page_search_state WHERE model <> :model)"),
        {"model": model},
    )
    if not changed:
        return False
    dropped_pages = await session.scalar(text("SELECT count(*) FROM page_search_state"))
    logger.info(
        "search_index_reset",
        reason="embedding_model_changed",
        new_model=model,
        pages_to_reindex=dropped_pages,
    )
    await session.execute(text("DELETE FROM page_chunks"))
    await session.execute(text("DELETE FROM page_search_state"))
    names = (
        await session.scalars(
            text(
                "SELECT indexname FROM pg_indexes "
                "WHERE tablename = 'page_chunks' "
                "AND indexname LIKE 'ix\\_page\\_chunks\\_embedding\\_%'"
            )
        )
    ).all()
    for name in names:
        await session.execute(text(f'DROP INDEX IF EXISTS "{name}"'))
    await session.commit()
    _dimensions_with_index.clear()
    return True


def _stale_pages(model: str, limit: int) -> sa.Select:
    up_to_date = (
        sa.exists()
        .where(
            _state.c.page_id == WikiPage.id,
            _state.c.source_updated_at == WikiPage.updated_at,
            _state.c.model == model,
            _state.c.chunk_count != 0,
        )
        .correlate(WikiPage)
    )
    return (
        select(WikiPage.id, WikiPage.title, WikiPage.content, WikiPage.updated_at)
        .join(Space, Space.id == WikiPage.space_id)
        .where(Space.status == SpaceStatus.active, ~up_to_date)
        .order_by(WikiPage.updated_at.desc())
        .limit(limit)
    )


async def _store(
    session: AsyncSession,
    page_id: object,
    updated_at: object,
    model: str,
    chunks: list[str],
    vectors: list[list[float]],
) -> None:
    await session.execute(text("DELETE FROM page_chunks WHERE page_id = :page"), {"page": page_id})
    if chunks:
        await session.execute(
            text(
                "INSERT INTO page_chunks (page_id, chunk_idx, body, embedding) "
                "VALUES (:page, :idx, :body, CAST(CAST(:vec AS text) AS vector))"
            ),
            [
                {"page": page_id, "idx": i, "body": body, "vec": vector_literal(vector)}
                for i, (body, vector) in enumerate(zip(chunks, vectors, strict=True))
            ],
        )
    await session.execute(
        text(
            "INSERT INTO page_search_state "
            "(page_id, source_updated_at, model, chunk_count, indexed_at) "
            "VALUES (:page, :updated, :model, :count, now()) "
            "ON CONFLICT (page_id) DO UPDATE SET source_updated_at = EXCLUDED.source_updated_at, "
            "model = EXCLUDED.model, chunk_count = EXCLUDED.chunk_count, indexed_at = now()"
        ),
        {
            "page": page_id,
            "updated": updated_at,
            "model": model,
            "count": len(chunks) if vectors else SKIPPED,
        },
    )
    await session.commit()


async def _backlog(session: AsyncSession, model: str) -> int:
    """Pages still waiting to be indexed for ``model``."""
    stale = _stale_pages(model, 1_000_000).with_only_columns(WikiPage.id).order_by(None)
    return int(await session.scalar(select(sa.func.count()).select_from(stale.subquery())) or 0)


async def index_pending(
    session: AsyncSession,
    config: AIConfig,
    *,
    deadline: float | None = None,
    heartbeat: Callable[[], Awaitable[None]] | None = None,
) -> int:
    """Embed stale pages, newest first. Returns how many pages were indexed.

    Stops at the first gateway failure that retrying later could fix (busy,
    unreachable, bad key) rather than hammering it; stops at ``deadline``
    (a ``time.monotonic`` value) so a pass always ends before the next one.
    ``heartbeat`` is awaited after every page, so a caller holding a lock can renew
    it: one page on a slow gateway can take minutes.

    Logging, for tuning: every pass that did or attempted anything ends with one
    ``search_index_pass`` line (pages, chunks, time spent waiting on the gateway,
    what is left, why it stopped); trouble is a ``warning`` carrying the
    gateway's status and reply. Per-page detail is ``debug``.
    """
    if not config.embeddings_ready or not await semantic_tables_exist(session):
        return 0
    model = config.embedding_model
    started = time.monotonic()
    await reset_if_model_changed(session, model)

    pages = (await session.execute(_stale_pages(model, config.tuning.index_batch))).all()
    if not pages:
        logger.debug("search_index_idle", model=model)
        return 0
    done = chunks_total = embed_calls = store_failures = 0
    embed_seconds = 0.0
    stopped = "batch_done"
    refused: list[tuple[object, object, EmbeddingError]] = []  # (page id, updated_at, why)
    for page_id, title, content, updated_at in pages:
        if deadline is not None and time.monotonic() >= deadline:
            stopped = "time_budget"
            break
        chunks = chunk_page(title, content, max_chunks=config.tuning.max_chunks_per_page)
        page_started = time.monotonic()
        try:
            vectors = await embed(config, chunks) if chunks else []
        except EmbeddingError as exc:
            embed_seconds += time.monotonic() - page_started
            embed_calls += 1
            if not exc.permanent:
                # Busy, unreachable, a bad key: stop rather than hammer it.
                logger.warning(
                    "search_index_paused",
                    reason="gateway_unavailable",
                    error=str(exc),
                    status=exc.status,
                    detail=exc.detail,
                    page_id=str(page_id),
                    model=model,
                )
                await _remember_error(model, str(exc))
                stopped = "gateway_unavailable"
                break
            refused.append((page_id, updated_at, exc))
            logger.warning(
                "search_index_page_refused",
                page_id=str(page_id),
                chunks=len(chunks),
                status=exc.status,
                detail=exc.detail,
                model=model,
            )
            if done == 0 and len(refused) >= _REFUSALS_BEFORE_PAUSE:
                stopped = "model_cannot_embed"
                break
            continue
        embed_seconds += time.monotonic() - page_started
        embed_calls += 1 if chunks else 0
        try:
            if vectors:
                await ensure_vector_index(session, len(vectors[0]))
            await _store(session, page_id, updated_at, model, chunks, vectors)
        except SQLAlchemyError:
            # E.g. the page was deleted while it was being embedded.
            await session.rollback()
            store_failures += 1
            logger.warning("search_index_store_failed", page_id=str(page_id), exc_info=True)
            continue
        done += 1
        chunks_total += len(chunks)
        if heartbeat is not None:
            await heartbeat()
        logger.debug(
            "search_index_page",
            page_id=str(page_id),
            chunks=len(chunks),
            dimensions=len(vectors[0]) if vectors else 0,
            seconds=round(time.monotonic() - page_started, 2),
        )
    skipped = 0
    if refused and done == 0:
        # Nothing at all went through: it is the setup that is wrong (this model
        # cannot embed), not those pages. Say so, and mark nothing "done".
        first = refused[0][2]
        stopped = "model_cannot_embed"
        logger.warning(
            "search_index_paused",
            reason="model_cannot_embed",
            refused=len(refused),
            error=str(first),
            status=first.status,
            detail=first.detail,
            model=model,
            hint="the embedding model is probably a chat model, or the endpoint has no /embeddings",
        )
        await _remember_error(model, str(first))
    elif refused:
        # Others went through, so the gateway rejects these very pages. Mark
        # them handled so they do not block the queue; an edit retries them.
        for page_id, updated_at, _why in refused:
            try:
                await _store(session, page_id, updated_at, model, [], [])
                skipped += 1
            except SQLAlchemyError:
                await session.rollback()
                store_failures += 1
    if done:
        await _remember_error(model, None)
    logger.info(
        "search_index_pass",
        model=model,
        pages_indexed=done,
        pages_skipped=skipped,
        pages_refused=len(refused),
        store_failures=store_failures,
        chunks=chunks_total,
        embed_requests=embed_calls,
        embed_seconds=round(embed_seconds, 2),
        seconds_per_page=round(embed_seconds / done, 2) if done else None,
        total_seconds=round(time.monotonic() - started, 2),
        backlog_remaining=await _backlog(session, model),
        stopped=stopped,
    )
    return done


@dataclass(frozen=True)
class IndexStatus:
    #: ``False`` when the database has no pgvector (or semantic tables).
    available: bool
    #: Pages in active spaces, i.e. what should end up indexed.
    total: int
    #: Of those, how many are up to date for the current embedding model.
    indexed: int
    #: Why indexing last stopped (the gateway refused or was unreachable), if so.
    error: str | None = None


async def index_status(session: AsyncSession, config: AIConfig) -> IndexStatus:
    total = await session.scalar(
        select(sa.func.count())
        .select_from(WikiPage)
        .join(Space, Space.id == WikiPage.space_id)
        .where(Space.status == SpaceStatus.active)
    )
    if not await semantic_tables_exist(session):
        return IndexStatus(available=False, total=int(total or 0), indexed=0)
    indexed = 0
    if config.embeddings_ready:
        indexed = int(
            await session.scalar(
                select(sa.func.count())
                .select_from(WikiPage)
                .join(Space, Space.id == WikiPage.space_id)
                .where(
                    Space.status == SpaceStatus.active,
                    sa.exists().where(
                        _state.c.page_id == WikiPage.id,
                        _state.c.source_updated_at == WikiPage.updated_at,
                        _state.c.model == config.embedding_model,
                        _state.c.chunk_count != 0,
                    ),
                )
            )
            or 0
        )
    error = await last_error(config.embedding_model) if config.embeddings_ready else None
    return IndexStatus(available=True, total=int(total or 0), indexed=indexed, error=error)
