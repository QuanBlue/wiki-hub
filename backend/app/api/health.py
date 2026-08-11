"""Liveness and readiness probes.

``/health``  - process is up. No dependencies touched, so a database blip never
               causes Kubernetes to kill an otherwise healthy pod.
``/ready``   - process can serve traffic: PostgreSQL, Redis and object storage
               all answered. Returns 503 when any dependency is down.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Literal

from fastapi import APIRouter, Response, status
from pydantic import BaseModel
from sqlalchemy import text

from app.core.config import settings
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.db.session import get_session_factory
from app.services.storage import get_storage

logger = get_logger(__name__)
router = APIRouter(tags=["system"])

CheckStatus = Literal["ok", "error", "timeout"]
Probe = Callable[[], Awaitable[CheckStatus]]
_PROBE_TIMEOUT = 3.0


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str
    environment: str


class ReadinessResponse(BaseModel):
    status: Literal["ok", "degraded"]
    checks: dict[str, CheckStatus]


async def _check_database() -> CheckStatus:
    async with get_session_factory()() as session:
        await session.execute(text("SELECT 1"))
    return "ok"


async def _check_redis() -> CheckStatus:
    await get_redis().ping()
    return "ok"


async def _check_storage() -> CheckStatus:
    return "ok" if await get_storage().health() else "error"


async def _run(name: str, check: Probe) -> tuple[str, CheckStatus]:
    """Run one dependency probe. Never raises - a probe failure is a result, not an error."""
    try:
        return name, await asyncio.wait_for(check(), timeout=_PROBE_TIMEOUT)
    except TimeoutError:
        logger.warning("readiness_check_timeout", check=name)
        return name, "timeout"
    except Exception as exc:  # noqa: BLE001 - probes must never raise
        logger.warning("readiness_check_failed", check=name, error=str(exc))
        return name, "error"


@router.get("/health", response_model=HealthResponse, summary="Liveness probe")
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="wikihub-api",
        version=settings.project_version,
        environment=str(settings.env),
    )


@router.get("/ready", response_model=ReadinessResponse, summary="Readiness probe")
async def ready(response: Response) -> ReadinessResponse:
    results = await asyncio.gather(
        _run("database", _check_database),
        _run("redis", _check_redis),
        _run("object_storage", _check_storage),
    )
    checks: dict[str, CheckStatus] = dict(results)
    healthy = all(state == "ok" for state in checks.values())
    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return ReadinessResponse(status="ok" if healthy else "degraded", checks=checks)
