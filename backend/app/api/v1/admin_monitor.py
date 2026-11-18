"""Administrator view of the server and its Docker containers (read-only)."""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Query

from app.api.deps import CurrentSuperuser
from app.core.exceptions import NotFoundError, ServiceUnavailableError
from app.modules.ai.ollama import controller_client
from app.schemas.monitor import ContainerLogs, MonitorOverview

router = APIRouter(prefix="/admin/monitor", tags=["admin-monitor"])

_UNAVAILABLE = (
    "The server monitor is not running. It is part of the Ollama controller service: "
    "start it with the rest of WikiHub (`./scripts/run.sh --dev` or "
    "`docker compose -f docker-compose.release.yml up -d ollama-controller`)."
)
_TOKEN_MISMATCH = (
    "The server monitor rejected the controller token "
    "(ensure WIKIHUB_SECRET_KEY is set in .env and restart backend and ollama-controller)."
)


@router.get("", response_model=MonitorOverview, summary="Server load, memory, disk and containers")
async def overview(_admin: CurrentSuperuser) -> MonitorOverview:
    try:
        async with controller_client() as http:
            host_resp = await http.get("/host", timeout=15.0)
            listed_resp = await http.get("/containers", timeout=45.0)
            if host_resp.status_code == 401 or listed_resp.status_code == 401:
                raise ServiceUnavailableError(_TOKEN_MISMATCH)
            host_resp.raise_for_status()
            listed_resp.raise_for_status()
            host = host_resp.json()
            listed = listed_resp.json()
    except ServiceUnavailableError:
        raise
    except (httpx.HTTPError, ValueError) as exc:
        raise ServiceUnavailableError(_UNAVAILABLE) from exc
    return MonitorOverview(
        docker_ok=bool(host.get("docker_ok")) and bool(listed.get("docker_ok")),
        host={k: v for k, v in host.items() if k != "docker_ok"},
        containers=listed.get("containers", []),
    )


@router.get(
    "/containers/{ref}/logs",
    response_model=ContainerLogs,
    summary="The last lines of a container's output (secrets hidden)",
)
async def container_logs(
    ref: str, _admin: CurrentSuperuser, tail: int = Query(default=200, ge=1, le=1000)
) -> ContainerLogs:
    try:
        async with controller_client() as http:
            response = await http.get(
                f"/containers/{ref}/logs", params={"tail": tail}, timeout=30.0
            )
    except httpx.HTTPError as exc:
        raise ServiceUnavailableError(_UNAVAILABLE) from exc
    if response.status_code == 404 or response.status_code == 422:
        raise NotFoundError("No such container.")
    if response.status_code >= 400:
        raise ServiceUnavailableError("Docker could not return that container's logs.")
    return ContainerLogs(lines=response.json().get("lines", []))
