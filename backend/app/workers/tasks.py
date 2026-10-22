"""Background tasks.

Import and export jobs are registered here from Phase 7 onwards. Everything in
this module must be idempotent: arq re-runs a task if a worker dies mid-job.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from app.core.logging import get_logger
from app.core.redis import get_redis
from app.db.session import session_scope
from app.modules.admin_mail.service import AdminMailService
from app.modules.attachments.text import extract_pending as extract_attachment_pending
from app.modules.ai.admin import check_all_connections
from app.modules.ai import ollama
from app.modules.ai.config import load_config
from app.modules.backup.jobs import reap_abandoned_export_jobs
from app.modules.backup.jobs import run_backup_job as execute_backup_job
from app.modules.backup.automated import (
    apply_retention,
    get_settings as get_automated_settings,
    schedule_due_backup,
)
from app.models.backup_job import BackupJob
from app.modules.document_import.jobs import reap_abandoned_document_imports
from app.modules.document_import.jobs import run_document_import as execute_document_import
from app.modules.graph.builder import build_pending as build_graph_pending
from app.modules.pages.service import PageService
from app.modules.search.indexer import SEARCH_INDEX_LOCK, index_pending, indexing_paused
from app.modules.import_export.service import reap_abandoned_confluence_imports, run_import
from app.services.storage import get_storage

logger = get_logger(__name__)


async def ping(ctx: dict[str, Any]) -> dict[str, str]:
    """End-to-end queue health check.

    Enqueue it to verify that Redis, the queue and a live worker are all
    functioning — a green ``/ready`` only proves the API can *reach* Redis, not
    that anything is consuming jobs.
    """
    job_id = str(ctx.get("job_id", ""))
    logger.info("worker_ping", job_id=job_id)
    return {"status": "ok", "job_id": job_id, "at": datetime.now(UTC).isoformat()}


async def run_confluence_import(ctx: dict[str, Any], job_id: str) -> None:
    """ARQ entrypoint; the database rows are the durable source of progress."""
    import uuid

    async with session_scope() as session:
        await run_import(session, get_storage(), uuid.UUID(job_id))


async def run_backup_job(ctx: dict[str, Any], job_id: str) -> None:
    """Build exports off-request; job rows make retries/status durable."""
    import uuid

    async with session_scope() as session:
        await execute_backup_job(session, get_storage(), uuid.UUID(job_id))
        job = await session.get(BackupJob, uuid.UUID(job_id))
        if job and job.automated:
            config = await get_automated_settings(session)
            config.last_status, config.last_error = job.status, job.error
            if job.status == "complete":
                await apply_retention(session, keep=config.retention_count)
            await session.commit()


async def schedule_automated_backup(ctx: dict[str, Any]) -> None:
    """Minute tick: queue at most one due instance backup."""
    async with session_scope() as session:
        job = await schedule_due_backup(session)
    if job is not None:
        await ctx["redis"].enqueue_job("run_backup_job", str(job.id))


async def run_document_import(ctx: dict[str, Any], job_id: str) -> None:
    """Convert uploaded documents into pages; the job rows carry progress."""
    import uuid

    async with session_scope() as session:
        await execute_document_import(session, get_storage(), uuid.UUID(job_id))


async def purge_expired_trash(ctx: dict[str, Any]) -> None:
    """Daily: delete for good every page that has been in a Trash past the retention period."""
    async with session_scope() as session:
        purged = await PageService(session).purge_expired()
    logger.info("trash_purge_done", purged=purged)


async def purge_unanswered_questions(ctx: dict[str, Any]) -> None:
    """Daily: forget the unanswered questions (and who asked them) past their retention."""
    from app.modules.ai.question_gaps import purge_expired

    async with session_scope() as session:
        purged = await purge_expired(session)
    logger.info("unanswered_questions_purge_done", purged=purged)


async def check_admin_mailboxes(ctx: dict[str, Any]) -> None:
    """Hourly: sign in to every active administrator mailbox.

    Mail providers make people change their password every few months, and the
    first sign that one has expired would otherwise be a user's request failing
    to reach anyone. The result is recorded on the mailbox, and the owner's
    banner reads it from there. Idempotent: it only ever overwrites the latest
    status.
    """
    async with session_scope() as session:
        summary = await AdminMailService(session).run_healthcheck()
    if summary.needs_attention:
        logger.warning(
            "admin_mailboxes_need_attention",
            checked=summary.checked,
            needs_attention=summary.needs_attention,
        )
    else:
        logger.info("admin_mailboxes_checked", checked=summary.checked)


async def check_ai_connections(ctx: dict[str, Any]) -> int:
    """Every five minutes: re-check each saved AI connection.

    Keeps the "Working / Failing" status in Administration honest after a key
    is revoked or a gateway goes down. Idempotent: it only overwrites the latest
    status.
    """
    async with session_scope() as session:
        checked = await check_all_connections(session)
    logger.info("ai_connections_checked", count=checked)
    return checked


async def reap_backup_jobs(ctx: dict[str, Any], *, every_running_job: bool = False) -> None:
    """Close out jobs whose worker died; see `reap_abandoned_export_jobs`.

    Scheduled rather than opportunistic: someone staring at a stuck progress
    bar should not have to trigger anything for it to clear.

    Document imports and Confluence imports are swept here too rather than from
    further cron entries: the failure is identical (a `running` row nothing is
    advancing) and one minute-ly sweep covering every job family is easier to
    reason about than three that could fall out of step.

    Each family keeps its own staleness window - see `STALE_IMPORT_AFTER` for
    why a Confluence import is given far longer than the others before it is
    presumed dead.
    """
    async with session_scope() as session:
        reaped = await reap_abandoned_export_jobs(
            session, every_running_job=every_running_job
        )
        reaped_imports = await reap_abandoned_document_imports(
            session, every_running_job=every_running_job
        )
        reaped_confluence = await reap_abandoned_confluence_imports(
            session, every_running_job=every_running_job
        )
    if reaped:
        logger.info("backup_jobs_reaped", count=reaped, on_startup=every_running_job)
    if reaped_imports:
        logger.info(
            "document_imports_reaped", count=reaped_imports, on_startup=every_running_job
        )
    if reaped_confluence:
        logger.info(
            "confluence_imports_reaped",
            count=reaped_confluence,
            on_startup=every_running_job,
        )


#: One indexing pass at a time: cron fires every minute, a slow pass must not
#: be doubled up by the next one (that would embed the same pages twice).
_SEARCH_INDEX_LOCK = SEARCH_INDEX_LOCK
#: How long one pass keeps embedding before it hands back its worker slot. Batch after
#: batch while pages are waiting: ending at 50 seconds and waiting for the next minute's
#: cron left the embedding model idle almost a quarter of the time.
_SEARCH_INDEX_BUDGET_SECONDS = 280
#: The lock outlives a crashed worker by at most this long...
_SEARCH_INDEX_LOCK_TTL_SECONDS = 120
#: ...and a live pass renews it this often, whatever it is doing. Renewing only
#: between pages was not enough: on a slow CPU one page's embedding call ran
#: for twelve minutes, the lock lapsed, and every following minute started
#: another pass until all of the worker's slots were indexing and document
#: imports sat queued behind them.
_SEARCH_INDEX_LOCK_RENEW_SECONDS = 30

#: Delete the lock only if it still holds this pass's token, so a pass whose
#: lock did lapse can never release the one a newer pass now holds.
_RELEASE_IF_OWNER = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
"""


async def index_search_pages(ctx: dict[str, Any]) -> int:
    """Embed pages that are new or changed since they were last indexed.

    Logs (see ``index_pending`` for the per-pass summary): ``search_index_busy``
    when the previous pass is still running, ``search_index_crashed`` with the
    traceback if a pass blew up.
    """
    redis = get_redis()
    token = uuid.uuid4().hex
    if not await redis.set(
        _SEARCH_INDEX_LOCK, token, nx=True, ex=_SEARCH_INDEX_LOCK_TTL_SECONDS
    ):
        logger.info("search_index_busy", detail="previous pass still running; skipped this one")
        return 0

    async def renew_lock() -> None:
        await redis.expire(_SEARCH_INDEX_LOCK, _SEARCH_INDEX_LOCK_TTL_SECONDS)

    async def keep_lock() -> None:
        while True:
            await asyncio.sleep(_SEARCH_INDEX_LOCK_RENEW_SECONDS)
            await renew_lock()

    keeper = asyncio.create_task(keep_lock())
    try:
        deadline = time.monotonic() + _SEARCH_INDEX_BUDGET_SECONDS
        total = 0

        async def paused() -> bool:
            # Its own session, so a pause saved a moment ago is seen.
            async with session_scope() as check:
                return await indexing_paused(check)

        async with session_scope() as session:
            if await indexing_paused(session):
                logger.info("search_index_skipped", reason="paused_by_administrator")
                return 0
            config = await load_config(session)
            # One batch is at most "pages per minute" pages; take the next as soon as it is
            # done. A batch that indexes nothing (no backlog, or the gateway refusing) ends it.
            while time.monotonic() < deadline:
                done = await index_pending(
                    session, config, deadline=deadline, heartbeat=renew_lock, stop=paused
                )
                total += done
                if done == 0:
                    break
            return total
    except Exception:
        logger.error("search_index_crashed", exc_info=True)
        raise
    finally:
        keeper.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await keeper
        await redis.eval(_RELEASE_IF_OWNER, 1, _SEARCH_INDEX_LOCK, token)


async def keep_ollama_running(ctx: dict[str, Any]) -> bool:
    """Every minute, and when the worker starts: if the self-hosted Ollama is enabled but its
    container is stopped (Docker or the machine restarted), start it again.

    Independent of indexing, and of pausing it: semantic search needs the model to embed each
    question, whether or not pages are being indexed. An administrator who disabled Ollama
    (which removes the container) is not overridden. Returns whether it was started.
    """
    try:
        async with session_scope() as session:
            config = await load_config(session)
        if getattr(config, "embedding_source", "") != "ollama" or not config.embeddings_ready:
            return False
        return await ollama.ensure_running(config.tuning)
    except ollama.OllamaError as exc:
        logger.warning("ollama_restart_failed", error=str(exc)[:300])
        return False


#: One graph pass at a time, for the same reason as indexing.
_GRAPH_LOCK = "lock:page_graph"
_GRAPH_BUDGET_SECONDS = 50
_GRAPH_LOCK_TTL_SECONDS = 120


async def build_page_graph(ctx: dict[str, Any]) -> int:
    """Work out how new and changed pages relate to the others (the knowledge graph).

    Needs no AI for links and mentions; similar pages come from the search index.
    Returns how many pages were brought up to date.
    """
    redis = get_redis()
    token = uuid.uuid4().hex
    if not await redis.set(_GRAPH_LOCK, token, nx=True, ex=_GRAPH_LOCK_TTL_SECONDS):
        logger.info("graph_build_busy", detail="previous pass still running; skipped this one")
        return 0

    async def renew_lock() -> None:
        await redis.expire(_GRAPH_LOCK, _GRAPH_LOCK_TTL_SECONDS)

    try:
        async with session_scope() as session:
            config = await load_config(session)
            result = await build_graph_pending(
                session,
                config,
                deadline=time.monotonic() + _GRAPH_BUDGET_SECONDS,
                heartbeat=renew_lock,
            )
            return result.text_pages + result.similar_pages
    except Exception:
        logger.error("graph_build_crashed", exc_info=True)
        raise
    finally:
        await redis.eval(_RELEASE_IF_OWNER, 1, _GRAPH_LOCK, token)


#: One pass at a time; reading a big PDF or workbook can outlast a minute.
_ATTACHMENT_TEXT_LOCK = "lock:attachment_text"
_ATTACHMENT_TEXT_BUDGET_SECONDS = 50
_ATTACHMENT_TEXT_LOCK_TTL_SECONDS = 600


async def extract_attachment_texts(ctx: dict[str, Any]) -> int:
    """Read the words inside files attached to pages (Word, Excel, HTML, PDF...).

    Needs no AI; the indexer then embeds what was read with the page. Pausing indexing
    pauses this too, since it is what frees the server. Returns how many files were read.
    """
    redis = get_redis()
    token = uuid.uuid4().hex
    if not await redis.set(
        _ATTACHMENT_TEXT_LOCK, token, nx=True, ex=_ATTACHMENT_TEXT_LOCK_TTL_SECONDS
    ):
        logger.info("attachment_text_busy", detail="previous pass still running; skipped this one")
        return 0

    async def renew_lock() -> None:
        await redis.expire(_ATTACHMENT_TEXT_LOCK, _ATTACHMENT_TEXT_LOCK_TTL_SECONDS)

    async def paused() -> bool:
        async with session_scope() as check:
            return await indexing_paused(check)

    try:
        if await paused():
            return 0
        deadline = time.monotonic() + _ATTACHMENT_TEXT_BUDGET_SECONDS
        total = 0
        async with session_scope() as session:
            # Batch after batch while files are waiting, like indexing.
            while time.monotonic() < deadline:
                done = await extract_attachment_pending(
                    session, get_storage(), deadline=deadline, stop=paused, heartbeat=renew_lock
                )
                total += done
                if done == 0:
                    break
        return total
    except Exception:
        logger.error("attachment_text_crashed", exc_info=True)
        raise
    finally:
        await redis.eval(_RELEASE_IF_OWNER, 1, _ATTACHMENT_TEXT_LOCK, token)


async def install_ollama(ctx: dict[str, Any], model: str) -> bool:
    """Install what is missing of the self-hosted Ollama and download ``model``.

    Long-running (the image alone is gigabytes); progress is written to Redis for
    the admin page. Safe to run again: finished steps are skipped and interrupted
    downloads resume.
    """
    async with session_scope() as session:
        tuning = (await load_config(session)).tuning
    return await ollama.install(model, tuning)
