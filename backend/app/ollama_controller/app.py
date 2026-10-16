"""The controller's HTTP surface: five fixed actions, nothing configurable.

Reachable only on the compose network (no published port) and, on top of that,
every call but ``/health`` needs the shared token.
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.ollama_controller import docker_api, monitor
from app.ollama_controller.auth import HEADER, is_valid

logger = get_logger(__name__)


class StartOptions(BaseModel):
    memory_mb: int
    cpus: int = 0
    keep_alive: str = "5m"


def require_token(token: str | None = Header(default=None, alias=HEADER)) -> None:
    if not is_valid(settings.secret_key, token):
        raise HTTPException(status_code=401, detail="Invalid controller token.")


def create_app() -> FastAPI:
    configure_logging()
    app = FastAPI(
        title="WikiHub Ollama controller", docs_url=None, redoc_url=None, openapi_url=None
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/status", dependencies=[Depends(require_token)])
    async def status() -> dict:
        async with docker_api.client() as http:
            try:
                state = await docker_api.status(http)
            except Exception as exc:  # noqa: BLE001 - the socket may be missing or refused
                logger.warning("ollama_controller_docker_unreachable", error=type(exc).__name__)
                return {"docker_ok": False, "error": "Docker is not reachable from the controller."}
        return {
            "docker_ok": True,
            "image": docker_api.IMAGE,
            "image_present": state.image_present,
            "image_bytes": state.image_bytes,
            "container": state.container,
            "memory_bytes": state.memory_bytes,
            "cpu_percent": state.cpu_percent,
            "memory_limit": docker_api.MEMORY_LIMIT,
            "volume_present": state.volume_present,
            "host_cpus": os.cpu_count() or 1,
            "applied": (
                {
                    "memory_mb": state.applied.memory_mb,
                    "cpus": state.applied.cpus,
                    "keep_alive": state.applied.keep_alive,
                }
                if state.applied
                else None
            ),
        }

    @app.get("/host", dependencies=[Depends(require_token)])
    async def host() -> dict:
        """Server load, memory, disk and Docker facts. Read-only."""
        facts: dict = {}
        async with docker_api.client() as http:
            try:
                facts = await monitor.docker_facts(http)
            except Exception:
                logger.warning("monitor_docker_info_failed", exc_info=True)
        return {"docker_ok": bool(facts), **monitor.host_metrics(), **facts}

    @app.get("/containers", dependencies=[Depends(require_token)])
    async def containers() -> dict:
        """Every container with uptime, CPU and memory. Read-only."""
        async with docker_api.client() as http:
            try:
                return {"docker_ok": True, "containers": await monitor.containers(http)}
            except Exception:
                logger.warning("monitor_containers_failed", exc_info=True)
                return {"docker_ok": False, "containers": []}

    @app.get("/containers/{ref}/logs", dependencies=[Depends(require_token)])
    async def container_logs(ref: str, tail: int = 200) -> dict:
        """The last lines of one container's output, secrets hidden. Read-only."""
        if not monitor.valid_ref(ref):
            raise HTTPException(status_code=422, detail="That is not a container name or id.")
        async with docker_api.client() as http:
            try:
                return {"lines": await monitor.logs(http, ref, tail)}
            except LookupError as exc:
                raise HTTPException(status_code=404, detail="No such container.") from exc
            except Exception as exc:
                logger.warning("monitor_logs_failed", error=type(exc).__name__)
                raise HTTPException(status_code=502, detail="Docker is not reachable.") from exc

    @app.post("/pull-image", dependencies=[Depends(require_token)])
    async def pull_image() -> StreamingResponse:
        """Stream the pull as one JSON object per line, ending in ``done`` or ``error``."""

        async def lines() -> AsyncIterator[str]:
            async with docker_api.client() as http:
                try:
                    async for event in docker_api.pull_image(http):
                        yield json.dumps(event) + "\n"
                    yield json.dumps({"done": True, "percent": 100}) + "\n"
                except Exception as exc:  # noqa: BLE001 - reported to the caller, which shows it
                    logger.warning("ollama_controller_pull_failed", error=str(exc)[:300])
                    yield json.dumps({"error": str(exc)[:300]}) + "\n"

        return StreamingResponse(lines(), media_type="application/x-ndjson")

    @app.post("/start", dependencies=[Depends(require_token)])
    async def start(options: StartOptions | None = None) -> dict[str, bool]:
        """Start Ollama. The three options are bounded numbers/choices, never free text."""
        try:
            params = (
                docker_api.Params.validated(options.memory_mb, options.cpus, options.keep_alive)
                if options
                else None
            )
        except docker_api.DockerError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        async def action(http):
            await docker_api.start(http, params)

        return await _run(action, "start")

    @app.post("/stop", dependencies=[Depends(require_token)])
    async def stop() -> dict[str, bool]:
        return await _run(docker_api.stop, "stop")

    @app.delete("/models", dependencies=[Depends(require_token)])
    async def remove_models() -> dict[str, bool]:
        return await _run(docker_api.remove_models, "remove_models")

    return app


async def _run(action, name: str) -> dict[str, bool]:
    async with docker_api.client() as http:
        try:
            await action(http)
        except docker_api.DockerError as exc:
            logger.warning("ollama_controller_action_failed", action=name, error=str(exc))
            raise HTTPException(status_code=exc.status or 502, detail=str(exc)) from exc
        except Exception as exc:
            logger.warning("ollama_controller_action_failed", action=name, error=type(exc).__name__)
            raise HTTPException(status_code=502, detail="Docker is not reachable.") from exc
    logger.info("ollama_controller_action", action=name)
    return {"ok": True}


app = create_app()
