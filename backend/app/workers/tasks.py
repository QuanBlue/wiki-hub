"""Background tasks.

Import and export jobs are registered here from Phase 7 onwards. Everything in
this module must be idempotent: arq re-runs a task if a worker dies mid-job.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.core.logging import get_logger

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
