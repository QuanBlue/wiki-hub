"""Background tasks.

Import and export jobs are registered here from Phase 7 onwards. Everything in
this module must be idempotent: arq re-runs a task if a worker dies mid-job.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any

from app.core.logging import get_logger
from app.core.redis import get_redis
from app.db.session import session_scope
from app.modules.admin_mail.service import AdminMailService
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
from app.modules.search.indexer import index_pending
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
_SEARCH_INDEX_LOCK = "lock:search_index"
_SEARCH_INDEX_BUDGET_SECONDS = 50


async def index_search_pages(ctx: dict[str, Any]) -> int:
    """Embed pages that are new or changed since they were last indexed.

    Logs (see ``index_pending`` for the per-pass summary): ``search_index_busy``
    when the previous pass is still running, ``search_index_crashed`` with the
    traceback if a pass blew up.
    """
    redis = get_redis()
    if not await redis.set(_SEARCH_INDEX_LOCK, "1", nx=True, ex=_SEARCH_INDEX_BUDGET_SECONDS + 40):
        logger.info("search_index_busy", detail="previous pass still running; skipped this one")
        return 0
    try:
        async with session_scope() as session:
            config = await load_config(session)

            async def renew_lock() -> None:
                # One page can take minutes on a slow CPU; without this the lock
                # would expire mid-pass and the next minute's pass would start too.
                await redis.expire(_SEARCH_INDEX_LOCK, _SEARCH_INDEX_BUDGET_SECONDS + 240)

            return await index_pending(
                session,
                config,
                deadline=time.monotonic() + _SEARCH_INDEX_BUDGET_SECONDS,
                heartbeat=renew_lock,
            )
    except Exception:
        logger.error("search_index_crashed", exc_info=True)
        raise
    finally:
        await redis.delete(_SEARCH_INDEX_LOCK)


async def install_ollama(ctx: dict[str, Any], model: str) -> bool:
    """Install what is missing of the self-hosted Ollama and download ``model``.

    Long-running (the image alone is gigabytes); progress is written to Redis for
    the admin page. Safe to run again: finished steps are skipped and interrupted
    downloads resume.
    """
    async with session_scope() as session:
        tuning = (await load_config(session)).tuning
    return await ollama.install(model, tuning)
