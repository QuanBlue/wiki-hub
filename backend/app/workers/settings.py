"""Background worker definition.

Run with::

    arq app.workers.settings.WorkerSettings

The worker shares the backend image and codebase — it is the same modular
monolith invoked with a different entrypoint, not a separate service.
"""

from __future__ import annotations

from typing import Any, ClassVar

from arq import cron, func
from arq.connections import RedisSettings

from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.db.session import dispose_engine
from app.workers.tasks import (
    ping,
    reap_backup_jobs,
    schedule_automated_backup,
    run_backup_job,
    run_confluence_import,
    run_document_import,
)

logger = get_logger(__name__)

#: Ceiling for the two jobs that legitimately run for hours: a full Confluence
#: site import (download tens of GB, then upload every attachment) and a full
#: backup restore. The worker-wide default below is far too short for them -
#: at one hour, importing every space of a 26GB export was cancelled part way
#: through the attachments phase, so the pages existed but never got linked
#: to their files, while importing a single space always finished in time.
LONG_RUNNING_JOB_TIMEOUT_SECONDS = 24 * 3600


def redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.redis_url)


async def startup(ctx: dict[str, Any]) -> None:
    configure_logging()
    logger.info("worker_startup", environment=str(settings.env))
    # A restart is the most common way an export job is orphaned - whatever
    # this worker was running a moment ago is gone. Sweep immediately instead
    # of leaving the operator waiting for the first scheduled pass. Never let
    # this stop the worker from coming up: housekeeping failing (the database
    # may not be reachable yet at boot) must not cost us a job consumer.
    try:
        await reap_backup_jobs(ctx, every_running_job=True)
    except Exception:  # noqa: BLE001 - startup housekeeping is strictly best-effort
        logger.warning("backup_job_reap_on_startup_failed", exc_info=True)


async def shutdown(ctx: dict[str, Any]) -> None:
    await dispose_engine()
    logger.info("worker_shutdown")


class WorkerSettings:
    """arq entrypoint. Task functions are registered here as phases land."""

    functions: ClassVar[list[Any]] = [
        ping,
        func(run_confluence_import, timeout=LONG_RUNNING_JOB_TIMEOUT_SECONDS),
        func(run_backup_job, timeout=LONG_RUNNING_JOB_TIMEOUT_SECONDS),
        run_document_import,
        schedule_automated_backup,
    ]
    cron_jobs: ClassVar[list[Any]] = [
        # Every minute: bounds how long a stuck export can hold the UI hostage
        # when a worker dies without restarting (so `on_startup` never runs).
        cron(reap_backup_jobs, second=0, run_at_startup=False),
        cron(schedule_automated_backup, second=10, run_at_startup=False),
    ]
    redis_settings = redis_settings()
    on_startup = startup
    on_shutdown = shutdown
    max_jobs = 5
    job_timeout = 3600  # default for short jobs; long ones set their own via `func(...)` above
    keep_result = 3600
    # Heartbeat written to Redis; the container healthcheck reads it via
    # `arq ... --check`, so keep it well below the 30s probe interval.
    health_check_interval = 10
