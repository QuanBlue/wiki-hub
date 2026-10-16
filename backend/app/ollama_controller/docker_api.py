"""The few Docker Engine calls the controller makes, with every parameter fixed.

Nothing here takes a container name, image, mount or command from a caller: the
only variable inputs are *which of five fixed actions* to run. That is what makes
handing this process the Docker socket tolerable - it cannot be asked to start
anything but WikiHub's own Ollama container.
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import httpx

SOCKET_PATH = os.environ.get("WIKIHUB_DOCKER_SOCKET", "/var/run/docker.sock")

#: Pinned so "Enable" always installs a version that was tested. An operator can
#: change it in the environment; a request to the controller cannot.
IMAGE = os.environ.get("WIKIHUB_OLLAMA_IMAGE", "ollama/ollama:0.40.4")
CONTAINER = "wikihub-ollama"
VOLUME = "wikihub-ollama-models"
#: The name the backend and worker use to reach it (``http://ollama:11434``).
NETWORK_ALIAS = "ollama"
#: Ollama frees the model this long after its last request, so an idle Ollama
#: holds almost nothing.
KEEP_ALIVE = "5m"
MEMORY_LIMIT = os.environ.get("WIKIHUB_OLLAMA_MEMORY_LIMIT", "3g")
#: Values an administrator may pick for how long Ollama keeps the model loaded.
KEEP_ALIVE_CHOICES = ("0", "1m", "5m", "10m", "30m", "1h", "-1")
MIN_MEMORY_MB = 512
MAX_MEMORY_MB = 262144
LABEL = {"com.wikihub.managed": "ollama"}


class DockerError(Exception):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


def parse_memory(value: str) -> int:
    """``"3g"`` -> bytes. Plain bytes and ``k``/``m``/``g`` suffixes are accepted."""
    value = value.strip().lower()
    units = {"k": 1024, "m": 1024**2, "g": 1024**3}
    if value and value[-1] in units:
        return int(float(value[:-1]) * units[value[-1]])
    return int(value)


@dataclass(frozen=True)
class Params:
    """The only things about the container a caller may choose - each bounded.

    Free text never reaches Docker: memory and cores are numbers clamped to a sane
    range, the keep-alive one of a fixed list.
    """

    memory_mb: int
    #: Cores Ollama may use; 0 means all of them. Applied as a cpuset, so the
    #: runner sees only that many cores and sizes its threads to match.
    cpus: int
    keep_alive: str

    @classmethod
    def default(cls) -> Params:
        return cls(parse_memory(MEMORY_LIMIT) // 1024**2, 0, KEEP_ALIVE)

    @classmethod
    def validated(cls, memory_mb: object, cpus: object, keep_alive: object) -> Params:
        try:
            memory = int(float(memory_mb))  # type: ignore[arg-type]
            cores = int(cpus)  # type: ignore[call-overload]
        except (TypeError, ValueError) as exc:
            raise DockerError("Memory and cores must be numbers.", 422) from exc
        if not MIN_MEMORY_MB <= memory <= MAX_MEMORY_MB:
            raise DockerError(f"Memory must be {MIN_MEMORY_MB}-{MAX_MEMORY_MB} MB.", 422)
        available = os.cpu_count() or 1
        if not 0 <= cores <= available:
            raise DockerError(f"Cores must be 0 (all) to {available}.", 422)
        if keep_alive not in KEEP_ALIVE_CHOICES:
            raise DockerError("That keep-alive time is not one of the offered choices.", 422)
        return cls(memory, cores, str(keep_alive))

    @property
    def cpuset(self) -> str:
        return f"0-{self.cpus - 1}" if self.cpus else ""


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.AsyncHTTPTransport(uds=SOCKET_PATH),
        base_url="http://docker",
        timeout=httpx.Timeout(30.0, read=None),
    )


@dataclass
class Status:
    image_present: bool = False
    image_bytes: int = 0
    #: ``none`` (no container), ``created``, ``running``, ``exited`` ...
    container: str = "none"
    memory_bytes: int | None = None
    #: Share of one core over the sample (100 = one full core); ``None`` when not running.
    cpu_percent: float | None = None
    volume_present: bool = False
    #: What the running container was created with (``None`` when there is none).
    applied: Params | None = None


async def own_network(http: httpx.AsyncClient) -> str:
    """The compose network the controller itself is on - Ollama joins the same one."""
    me = os.environ.get("HOSTNAME", "")
    response = await http.get(f"/containers/{me}/json")
    if response.status_code != 200:
        raise DockerError("The controller could not find its own container.", response.status_code)
    networks = list((response.json().get("NetworkSettings") or {}).get("Networks") or {})
    if not networks:
        raise DockerError("The controller is not attached to a network.")
    return networks[0]


def _applied(inspected: dict) -> Params | None:
    host = inspected.get("HostConfig") or {}
    env = {
        item.split("=", 1)[0]: item.split("=", 1)[1]
        for item in (inspected.get("Config") or {}).get("Env") or []
        if "=" in item
    }
    cpuset = host.get("CpusetCpus") or ""
    cores = 0
    if cpuset:
        low, _, high = cpuset.partition("-")
        cores = (int(high) - int(low) + 1) if high.isdigit() and low.isdigit() else 0
    return Params(
        memory_mb=int((host.get("Memory") or 0) // 1024**2),
        cpus=cores,
        keep_alive=env.get("OLLAMA_KEEP_ALIVE", KEEP_ALIVE),
    )


async def status(http: httpx.AsyncClient) -> Status:
    result = Status()
    image = await http.get(f"/images/{IMAGE}/json")
    if image.status_code == 200:
        result.image_present, result.image_bytes = True, int(image.json().get("Size") or 0)
    container = await http.get(f"/containers/{CONTAINER}/json")
    if container.status_code == 200:
        result.container = (container.json().get("State") or {}).get("Status", "unknown")
        result.applied = _applied(container.json())
        if result.container == "running":
            stats = await http.get(f"/containers/{CONTAINER}/stats", params={"stream": "false"})
            if stats.status_code == 200:
                from app.ollama_controller.monitor import _cpu_percent, _memory

                sample = stats.json()
                # Like `docker stats`: the page cache the kernel can take back is not "in use".
                result.memory_bytes = _memory(sample)[0] or None
                result.cpu_percent = _cpu_percent(sample)
    volume = await http.get(f"/volumes/{VOLUME}")
    result.volume_present = volume.status_code == 200
    return result


@dataclass
class PullProgress:
    """Bytes done and expected over every layer of an image pull so far."""

    current: dict[str, int] = field(default_factory=dict)
    total: dict[str, int] = field(default_factory=dict)
    #: Layers are discovered as the pull goes, which would make the share done jump
    #: backwards; the reported percent only ever goes up.
    _best: int = 0
    #: Every layer seen, and those finished - the fallback when no layer reports sizes.
    seen: set[str] = field(default_factory=set)
    complete: set[str] = field(default_factory=set)

    def update(self, event: dict) -> None:
        layer = event.get("id")
        if not layer:
            return
        self.seen.add(layer)
        detail = event.get("progressDetail") or {}
        if detail.get("total"):
            self.total[layer] = int(detail["total"])
            self.current[layer] = int(detail.get("current") or 0)
        finished = event.get("status") in ("Download complete", "Pull complete", "Already exists")
        if finished:
            self.complete.add(layer)
            if layer in self.total:
                self.current[layer] = self.total[layer]

    @property
    def percent(self) -> int:
        expected = sum(self.total.values())
        if expected:
            self._best = max(self._best, min(100, int(100 * sum(self.current.values()) / expected)))
        elif self.seen:  # nothing reported sizes (tiny or cached layers): count layers instead
            self._best = max(self._best, int(100 * len(self.complete) / len(self.seen)))
        return self._best


async def pull_image(http: httpx.AsyncClient) -> AsyncIterator[dict]:
    """Pull ``IMAGE``, yielding ``{"percent", "current", "total", "status"}`` as it goes."""
    repository, _, tag = IMAGE.partition(":")
    progress = PullProgress()
    async with http.stream(
        "POST", "/images/create", params={"fromImage": repository, "tag": tag or "latest"}
    ) as response:
        if response.status_code != 200:
            body = (await response.aread()).decode(errors="replace")[:300]
            raise DockerError(f"Docker refused the image pull: {body}", response.status_code)
        async for line in response.aiter_lines():
            if not line.strip():
                continue
            event = json.loads(line)
            if event.get("error"):
                raise DockerError(str(event["error"])[:300])
            progress.update(event)
            yield {
                "status": event.get("status", ""),
                "percent": progress.percent,
                "current": sum(progress.current.values()),
                "total": sum(progress.total.values()),
            }


async def start(http: httpx.AsyncClient, params: Params | None = None) -> None:
    """Create the container if there is none (or it differs from ``params``), then start it."""
    wanted = params or Params.default()
    existing = await http.get(f"/containers/{CONTAINER}/json")
    if existing.status_code == 200 and _applied(existing.json()) != wanted:
        # Memory, cores and keep-alive are fixed at creation: change them by recreating.
        await stop(http)
        existing = await http.get(f"/containers/{CONTAINER}/json")
    if existing.status_code == 404:
        network = await own_network(http)
        host_config: dict = {
            "Binds": [f"{VOLUME}:/root/.ollama"],
            "Memory": wanted.memory_mb * 1024**2,
            "RestartPolicy": {"Name": "no"},
            "NetworkMode": network,
        }
        if wanted.cpuset:
            host_config["CpusetCpus"] = wanted.cpuset
        body = {
            "Image": IMAGE,
            "Env": [f"OLLAMA_KEEP_ALIVE={wanted.keep_alive}", "OLLAMA_HOST=0.0.0.0:11434"],
            "Labels": LABEL,
            "HostConfig": host_config,
            "NetworkingConfig": {
                "EndpointsConfig": {network: {"Aliases": [NETWORK_ALIAS]}},
            },
        }
        created = await http.post("/containers/create", params={"name": CONTAINER}, json=body)
        if created.status_code not in (200, 201):
            raise DockerError(
                f"Docker could not create the container: {created.text[:300]}", created.status_code
            )
    elif existing.status_code != 200:
        raise DockerError("Docker could not inspect the container.", existing.status_code)
    response = await http.post(f"/containers/{CONTAINER}/start")
    if response.status_code not in (204, 304):
        raise DockerError(f"Docker could not start the container: {response.text[:300]}")


async def stop(http: httpx.AsyncClient) -> None:
    """Stop and remove the container (the downloaded models stay in the volume)."""
    await http.post(f"/containers/{CONTAINER}/stop", params={"t": "10"})
    response = await http.delete(f"/containers/{CONTAINER}", params={"force": "true"})
    if response.status_code not in (204, 404):
        raise DockerError(f"Docker could not remove the container: {response.text[:300]}")


async def remove_models(http: httpx.AsyncClient) -> None:
    """Delete the downloaded models. Only while the container does not exist."""
    container = await http.get(f"/containers/{CONTAINER}/json")
    if container.status_code == 200:
        raise DockerError("Disable Ollama before deleting its models.", 409)
    response = await http.delete(f"/volumes/{VOLUME}")
    if response.status_code not in (204, 404):
        raise DockerError(f"Docker could not remove the volume: {response.text[:300]}")
