"""Background tasks.

Import and export jobs are registered here from Phase 7 onwards. Everything in
this module must be idempotent: arq re-runs a task if a worker dies mid-job.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.core.logging import get_logger
from app.db.session import session_scope
from app.modules.backup.jobs import reap_abandoned_export_jobs
from app.modules.backup.jobs import run_backup_job as execute_backup_job
from app.modules.document_import.jobs import reap_abandoned_document_imports
from app.modules.document_import.jobs import run_document_import as execute_document_import
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


async def run_document_import(ctx: dict[str, Any], job_id: str) -> None:
    """Convert uploaded documents into pages; the job rows carry progress."""
    import uuid

    async with session_scope() as session:
        await execute_document_import(session, get_storage(), uuid.UUID(job_id))


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
