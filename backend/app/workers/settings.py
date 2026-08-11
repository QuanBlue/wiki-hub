"""Background worker definition.

Run with::

    arq app.workers.settings.WorkerSettings

The worker shares the backend image and codebase — it is the same modular
monolith invoked with a different entrypoint, not a separate service.
"""

from __future__ import annotations

from typing import Any, ClassVar

from arq.connections import RedisSettings

from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.db.session import dispose_engine
from app.workers.tasks import ping

logger = get_logger(__name__)


def redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.redis_url)


async def startup(ctx: dict[str, Any]) -> None:
    configure_logging()
    logger.info("worker_startup", environment=str(settings.env))


async def shutdown(ctx: dict[str, Any]) -> None:
    await dispose_engine()
    logger.info("worker_shutdown")


class WorkerSettings:
    """arq entrypoint. Task functions are registered here as phases land."""

    functions: ClassVar[list[Any]] = [ping]
    cron_jobs: ClassVar[list[Any]] = []
    redis_settings = redis_settings()
    on_startup = startup
    on_shutdown = shutdown
    max_jobs = 5
    job_timeout = 3600  # a large Confluence import may legitimately run for an hour
    keep_result = 3600
    # Heartbeat written to Redis; the container healthcheck reads it via
    # `arq ... --check`, so keep it well below the 30s probe interval.
    health_check_interval = 10
