"""WikiHub's own Ollama: install it on demand, run it only while it is wanted.

Three parties are involved:

* the **controller** sidecar - the only thing with the Docker socket - starts and
  stops the container and downloads its image;
* **Ollama** itself - listed models and the model download (``/api/pull``);
* this module's **install job**, run by the worker, which walks through the steps
  and writes its progress to Redis so the admin page can draw a progress card.

Nothing is installed or running until an administrator enables it, and disabling
removes the container, so an unused Ollama costs no memory.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from collections.abc import AsyncIterator
from dataclasses import asdict, dataclass, field

import httpx

from app.core.config import settings
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.ai.tuning import Tuning, defaults
from app.ollama_controller.auth import HEADER, token

logger = get_logger(__name__)

#: Embedding models an administrator may download. A curated list, not free text:
#: Ollama would otherwise happily pull a 40 GB chat model into the disk.
MODELS: tuple[tuple[str, str], ...] = (
    ("bge-m3", "multilingual, 1024 dims, ~1.2 GB - best for Vietnamese + English"),
    ("snowflake-arctic-embed2", "multilingual, 1024 dims, ~1.2 GB"),
    ("granite-embedding:278m", "multilingual, 768 dims, ~0.6 GB - lighter"),
    ("nomic-embed-text", "English-focused, 768 dims, ~0.3 GB - smallest"),
)
ALLOWED_MODELS = frozenset(name for name, _ in MODELS)

_PROGRESS_KEY = "ollama:install"
_LOCK_KEY = "ollama:install:lock"
_CANCEL_KEY = "ollama:install:cancel"
#: A job that has not reported for this long is taken to be dead (worker restart).
STALE_AFTER_SECONDS = 180
#: Steps, in order, with the share of the overall bar each fills.
STEPS: tuple[tuple[str, int], ...] = (("image", 60), ("start", 3), ("ready", 2), ("model", 35))


class OllamaError(Exception):
    """Something went wrong talking to the controller or to Ollama."""


class Cancelled(OllamaError):
    """The administrator cancelled the install."""


@dataclass
class Progress:
    #: ``installing`` while the job runs, ``error`` once it failed, ``idle`` otherwise.
    state: str = "idle"
    step: str = ""
    #: 0-100 within the current step.
    percent: int = 0
    #: 0-100 over the whole install.
    overall: int = 0
    message: str = ""
    error: str = ""
    model: str = ""
    #: Bytes done / expected in the current download, when known.
    current: int = 0
    total: int = 0
    updated_at: float = field(default_factory=time.time)


async def read_progress() -> Progress:
    raw = await get_redis().get(_PROGRESS_KEY)
    if not raw:
        return Progress()
    try:
        return Progress(**json.loads(raw))
    except (TypeError, ValueError):
        return Progress()


async def write_progress(progress: Progress) -> None:
    progress.updated_at = time.time()
    await get_redis().set(_PROGRESS_KEY, json.dumps(asdict(progress)), ex=7 * 86400)


def overall_percent(step: str, percent: int) -> int:
    """Where a step's own percent lands on the whole install bar."""
    done = 0
    for name, weight in STEPS:
        if name == step:
            return min(100, done + int(weight * percent / 100))
        done += weight
    return 0


# ------------------------------------------------------------------ controller


def controller_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=settings.ollama_controller_url,
        headers={HEADER: token(settings.secret_key)},
        timeout=httpx.Timeout(30.0, read=None),
    )


async def controller_status() -> dict:
    """The controller's view: Docker reachable, image/container present, memory."""
    try:
        async with controller_client() as http:
            response = await http.get("/status", timeout=10.0)
            if response.status_code == 401:
                raise OllamaError("The controller rejected the token (WIKIHUB_SECRET_KEY differs).")
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as exc:
        raise OllamaError(
            "The Ollama controller is not running. Start it with the rest of WikiHub "
            "(`./scripts/run.sh --dev`), then try again."
        ) from exc


async def _controller_post(
    path: str, *, method: str = "POST", json_body: dict | None = None
) -> None:
    try:
        async with controller_client() as http:
            response = await http.request(method, path, timeout=60.0, json=json_body)
    except httpx.HTTPError as exc:
        raise OllamaError("The Ollama controller is not reachable.") from exc
    if response.status_code >= 400:
        try:
            detail = response.json().get("detail", "")
        except ValueError:
            detail = ""
        raise OllamaError(str(detail) or f"The controller answered HTTP {response.status_code}.")


async def pull_image() -> AsyncIterator[dict]:
    """Stream the image download's progress events from the controller."""
    try:
        async with (
            controller_client() as http,
            http.stream("POST", "/pull-image") as response,
        ):
            if response.status_code != 200:
                raise OllamaError(f"The controller answered HTTP {response.status_code}.")
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                event = json.loads(line)
                if event.get("error"):
                    raise OllamaError(str(event["error"]))
                yield event
    except httpx.HTTPError as exc:
        raise OllamaError("Lost contact with the Ollama controller during the download.") from exc


# ----------------------------------------------------------------------- ollama


def _api(path: str) -> str:
    return settings.ollama_url.rstrip("/") + path


async def installed_models() -> list[str]:
    """Model names Ollama has downloaded; raises :class:`OllamaError` if it is not up."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            response = await http.get(_api("/api/tags"))
            response.raise_for_status()
            return [m["name"] for m in response.json().get("models", [])]
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise OllamaError("Ollama is not answering.") from exc


async def pull_model(model: str) -> AsyncIterator[dict]:
    """Stream Ollama's model download as ``{"status", "current", "total", "percent"}``."""
    totals: dict[str, int] = {}
    done: dict[str, int] = {}
    best = 0  # layers are discovered as the download goes; the bar must not run backwards
    try:
        async with (
            httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=None)) as http,
            http.stream(
                "POST", _api("/api/pull"), json={"model": model, "stream": True}
            ) as response,
        ):
            if response.status_code != 200:
                body = (await response.aread()).decode(errors="replace")[:200]
                raise OllamaError(f"Ollama refused to download {model}: {body}")
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                event = json.loads(line)
                if event.get("error"):
                    raise OllamaError(str(event["error"])[:300])
                digest = event.get("digest")
                if digest and event.get("total"):
                    totals[digest] = int(event["total"])
                    done[digest] = int(event.get("completed") or 0)
                expected = sum(totals.values())
                if expected:
                    best = max(best, min(100, int(100 * sum(done.values()) / expected)))
                yield {
                    "status": event.get("status", ""),
                    "current": sum(done.values()),
                    "total": expected,
                    "percent": best,
                }
    except httpx.HTTPError as exc:
        raise OllamaError("Lost contact with Ollama during the model download.") from exc


def is_embedding_name(name: str) -> bool:
    """Whether an Ollama model name is an embedding model (all the curated ones are)."""
    base = name.split(":", 1)[0]
    return (
        base in ALLOWED_MODELS
        or name in ALLOWED_MODELS
        or bool(re.search(r"embed|bge|e5|gte|minilm|nomic", name, re.IGNORECASE))
    )


# ---------------------------------------------------------------------- the job


async def _step(
    progress: Progress, step: str, percent: int, message: str = "", **extra: int
) -> None:
    progress.state = "installing"
    progress.step = step
    progress.percent = percent
    progress.overall = overall_percent(step, percent)
    progress.message = message
    progress.current = extra.get("current", 0)
    progress.total = extra.get("total", 0)
    await write_progress(progress)
    if await get_redis().get(_CANCEL_KEY):
        raise Cancelled("Cancelled.")


async def ensure_running(tuning: Tuning | None = None) -> bool:
    """Start the self-hosted Ollama again when it exists but is stopped; True if it was.

    Its container does not restart by itself, so after Docker or the machine restarts it sat
    stopped and every indexing pass failed ("Name or service not known") until someone
    opened the admin page. A container that does not exist is left alone: that is Ollama
    disabled by an administrator (disabling removes it).
    """
    status = await controller_status()
    if not status.get("docker_ok") or status.get("container") in (None, "none", "running"):
        return False
    logger.info("ollama_restarting", container=status.get("container"))
    await _controller_post("/start", json_body=_start_options(tuning))
    await wait_until_up(60.0)
    return True


async def wait_until_up(wait_seconds: float = 90.0) -> None:
    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline:
        try:
            await installed_models()
            return
        except OllamaError:
            await asyncio.sleep(1.5)
            if await get_redis().get(_CANCEL_KEY):
                raise Cancelled("Cancelled.") from None
    raise OllamaError("Ollama started but did not answer in time.")


async def install(model: str, tuning: Tuning | None = None) -> bool:
    """Install what is missing: image, container, model.

    Returns False when another run already holds the lock.

    Idempotent and resumable: each step is skipped when already done, and an
    interrupted download continues from the layers Docker or Ollama already hold.
    """
    if model not in ALLOWED_MODELS:
        raise OllamaError(f"“{model}” is not one of the embedding models WikiHub offers.")
    redis = get_redis()
    if not await redis.set(_LOCK_KEY, "1", nx=True, ex=STALE_AFTER_SECONDS * 10):
        logger.info("ollama_install_busy")
        return False
    started = time.monotonic()
    progress = Progress(state="installing", model=model)
    try:
        await redis.delete(_CANCEL_KEY)
        status = await controller_status()
        if not status.get("docker_ok"):
            raise OllamaError(status.get("error") or "Docker is not reachable.")
        logger.info("ollama_install_start", model=model, image=status.get("image"))

        if not status.get("image_present"):
            await _step(progress, "image", 0, "Downloading the Ollama image")
            async for event in pull_image():
                await _step(
                    progress,
                    "image",
                    int(event.get("percent", 0)),
                    event.get("status", ""),
                    current=int(event.get("current", 0)),
                    total=int(event.get("total", 0)),
                )
        await _step(progress, "start", 0, "Starting Ollama")
        await _controller_post("/start", json_body=_start_options(tuning))
        await _step(progress, "ready", 0, "Waiting for Ollama to answer")
        await wait_until_up()

        if not any(m.split(":", 1)[0] == model.split(":", 1)[0] for m in await installed_models()):
            await _step(progress, "model", 0, f"Downloading {model}")
            async for event in pull_model(model):
                await _step(
                    progress,
                    "model",
                    int(event["percent"]),
                    event["status"],
                    current=event["current"],
                    total=event["total"],
                )
        progress = Progress(state="idle", model=model, overall=100, message="Ready")
        await write_progress(progress)
        logger.info(
            "ollama_install_done", model=model, seconds=round(time.monotonic() - started, 1)
        )
        return True
    except Cancelled:
        # Say what was cancelled: the card goes back to its normal view, and this is what is
        # left to tell the administrator that the download did not finish.
        what = f"Downloading {model}" if progress.step == "model" else "The setup"
        progress.state, progress.error = "error", f"{what} was cancelled."
        await write_progress(progress)
        logger.info("ollama_install_cancelled", step=progress.step)
        return True
    except OllamaError as exc:
        progress.state, progress.error = "error", str(exc)
        await write_progress(progress)
        logger.warning("ollama_install_failed", step=progress.step, error=str(exc))
        return True
    except Exception as exc:
        progress.state, progress.error = "error", f"Unexpected error: {type(exc).__name__}"
        await write_progress(progress)
        logger.error("ollama_install_crashed", step=progress.step, exc_info=True)
        raise
    finally:
        await redis.delete(_LOCK_KEY)


def _start_options(tuning: Tuning | None) -> dict:
    """What the administrator chose for the container (or the defaults)."""
    tuning = tuning or defaults()
    return {
        "memory_mb": int(tuning.ollama_memory_gb * 1024),
        "cpus": tuning.ollama_cpus,
        "keep_alive": tuning.ollama_keep_alive,
    }


async def request_cancel() -> None:
    await get_redis().set(_CANCEL_KEY, "1", ex=600)


async def disable() -> None:
    """Stop and remove the container; downloaded models stay on disk."""
    await _controller_post("/stop")
    await get_redis().delete(_PROGRESS_KEY)
    logger.info("ollama_disabled")


async def delete_models() -> None:
    await _controller_post("/models", method="DELETE")
    logger.info("ollama_models_deleted")


async def describe(tuning: Tuning | None = None) -> dict:
    """Everything the admin card needs, in one call."""
    progress = await read_progress()
    base: dict = {
        "state": "not_installed",
        "controller_ok": False,
        "docker_ok": False,
        "image": "",
        "image_bytes": 0,
        "memory_bytes": None,
        "cpu_percent": None,
        "memory_limit": "",
        "models": [],
        "available_models": [{"name": n, "note": note} for n, note in MODELS],
        "step": progress.step,
        "model": progress.model,
        "percent": progress.percent,
        "overall": progress.overall,
        "message": progress.message,
        "current": progress.current,
        "total": progress.total,
        "error": "",
        #: Something that happened to the last install (cancelled, failed) worth telling the
        #: administrator about even though Ollama itself is fine.
        "notice": "",
        "volume_present": False,
        "host_cpus": 0,
        "applied_memory_mb": None,
        "applied_cpus": None,
        "applied_keep_alive": None,
        "restart_needed": False,
    }
    try:
        status = await controller_status()
    except OllamaError as exc:
        base["error"] = str(exc)
        base["state"] = "controller_down"
        return base
    base["controller_ok"] = True
    if not status.get("docker_ok"):
        base["state"] = "docker_unavailable"
        base["error"] = status.get("error", "")
        return base
    base.update(
        docker_ok=True,
        image=status.get("image", ""),
        image_bytes=status.get("image_bytes", 0),
        memory_bytes=status.get("memory_bytes"),
        cpu_percent=status.get("cpu_percent"),
        memory_limit=status.get("memory_limit", ""),
        volume_present=bool(status.get("volume_present")),
    )
    applied = status.get("applied")
    base["host_cpus"] = int(status.get("host_cpus") or 0)
    if applied:
        base.update(
            applied_memory_mb=applied["memory_mb"],
            applied_cpus=applied["cpus"],
            applied_keep_alive=applied["keep_alive"],
        )
        wanted = _start_options(tuning)
        base["restart_needed"] = (
            wanted["memory_mb"] != applied["memory_mb"]
            or wanted["cpus"] != applied["cpus"]
            or wanted["keep_alive"] != applied["keep_alive"]
        )
    running = status.get("container") == "running"
    fresh = time.time() - progress.updated_at < STALE_AFTER_SECONDS
    if progress.state == "installing" and fresh:
        base["state"] = "installing"
    elif progress.state == "installing":
        base.update(state="error", error="The install was interrupted. Enable again to continue.")
    elif progress.state == "error":
        base.update(state="error", error=progress.error)
    elif running:
        base["state"] = "running"
    elif status.get("image_present") or status.get("volume_present"):
        base["state"] = "stopped"
    if running:
        try:
            base["models"] = await installed_models()
            if (
                base["models"]
                and base["state"] in ("error", "stopped")
                and not (progress.state == "installing" and fresh)
            ):
                # It is up and has models: an old failure no longer blocks the card, but what
                # happened to the last download (cancelled, refused) is still told.
                base.update(
                    state="running",
                    error="",
                    notice=progress.error if progress.state == "error" else "",
                )
        except OllamaError:
            if base["state"] == "running":
                base["state"] = "starting"
    return base
