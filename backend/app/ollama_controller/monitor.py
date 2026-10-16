"""Read-only view of the server and its Docker containers, for Administration > Server.

Only ``GET`` calls to Docker (list, inspect, stats, logs) and reads of ``/proc``.
Nothing here starts, stops or changes anything. It sits in the controller because
that is the one service that has the Docker socket; the backend never gets it.

Container *logs* can hold secrets, so they are passed through ``redact`` and the
route is administrator-only upstream.
"""

from __future__ import annotations

import asyncio
import os
import re
import shutil
import struct
import time
from datetime import UTC, datetime

import httpx

from app.ollama_controller.docker_api import CONTAINER as OLLAMA_CONTAINER

#: A container name or id, as Docker allows - never a path or a query.
_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
MAX_LOG_LINES = 1000

_SECRETS = (
    # Authorization: Bearer xxx / Basic xxx
    (re.compile(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}"), r"\1 ***"),
    # password=..., "api_key": "...", token: ..., secret=...
    (
        re.compile(
            r"(?i)((?:pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|authorization)"
            r"[A-Za-z0-9_-]*[\"']?\s*[:=]\s*[\"']?)[^\s\"',;&}]+"
        ),
        r"\1***",
    ),
    # A JWT on its own.
    (re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"), "***"),
    # user:password@host in a URL.
    (re.compile(r"(?i)(\b[a-z][a-z0-9+.-]*://[^\s:/@]+:)[^\s@/]+@"), r"\1***@"),
)


def redact(text: str) -> str:
    """Hide the obvious credentials in log text. Best effort, not a guarantee."""
    for pattern, replacement in _SECRETS:
        text = pattern.sub(replacement, text)
    return text


def valid_ref(ref: str) -> bool:
    return bool(_REF.match(ref))


def _read(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    except OSError:
        return ""


def host_metrics() -> dict:
    """Load, memory, disk and uptime as the kernel reports them."""
    load = _read("/proc/loadavg").split()
    meminfo: dict[str, int] = {}
    for line in _read("/proc/meminfo").splitlines():
        key, _, rest = line.partition(":")
        digits = rest.strip().split(" ")[0]
        if digits.isdigit():
            meminfo[key] = int(digits) * 1024
    uptime = _read("/proc/uptime").split()
    try:
        disk = shutil.disk_usage("/")
        disk_total, disk_used = disk.total, disk.used
    except OSError:
        disk_total = disk_used = 0
    total = meminfo.get("MemTotal", 0)
    available = meminfo.get("MemAvailable", 0)
    return {
        "cpus": os.cpu_count() or 1,
        "load": [float(x) for x in load[:3]] if len(load) >= 3 else [],
        "memory_total": total,
        "memory_available": available,
        "memory_used": max(total - available, 0),
        "swap_total": meminfo.get("SwapTotal", 0),
        "swap_used": max(meminfo.get("SwapTotal", 0) - meminfo.get("SwapFree", 0), 0),
        "disk_total": disk_total,
        "disk_used": disk_used,
        "uptime_seconds": float(uptime[0]) if uptime else 0.0,
    }


_PROJECT_LABEL = "com.docker.compose.project"
_own_project: str | None = None


async def own_project(http: httpx.AsyncClient) -> str:
    """The compose project this controller itself runs in: what "WikiHub" means here."""
    global _own_project
    if _own_project is None:
        me = os.environ.get("HOSTNAME", "")
        response = await http.get(f"/containers/{me}/json") if me else None
        labels = (
            ((response.json().get("Config") or {}).get("Labels") or {})
            if (response is not None and response.status_code == 200)
            else {}
        )
        # Not cached when it could not be read, so a later call can still find it.
        project = str(labels.get(_PROJECT_LABEL, ""))
        if not project:
            return ""
        _own_project = project
    return _own_project


def is_wikihub(project: str, name: str, own: str) -> bool:
    """Only WikiHub's own containers are shown: its compose project, and the Ollama container
    it starts itself. Other services on the same Docker host are none of this page's business -
    their names, images and logs can hold things an administrator of WikiHub should not see."""
    return (bool(own) and project == own) or name == OLLAMA_CONTAINER


async def docker_facts(http: httpx.AsyncClient) -> dict:
    response = await http.get("/info")
    if response.status_code != 200:
        return {}
    info = response.json()
    # Counted over WikiHub's containers only, not everything Docker is running.
    mine = await _visible(http)
    return {
        "docker_version": info.get("ServerVersion", ""),
        "os": info.get("OperatingSystem", ""),
        "kernel": info.get("KernelVersion", ""),
        "containers_total": len(mine),
        "containers_running": sum(1 for s in mine if s.get("State") == "running"),
        "images": 0,
    }


async def _visible(http: httpx.AsyncClient) -> list[dict]:
    """The container summaries this page may show."""
    listed = await http.get("/containers/json", params={"all": "1"})
    listed.raise_for_status()
    own = await own_project(http)
    return [
        summary
        for summary in listed.json()
        if is_wikihub(
            (summary.get("Labels") or {}).get(_PROJECT_LABEL, ""),
            (summary.get("Names") or ["/?"])[0].lstrip("/"),
            own,
        )
    ]


def _cpu_percent(stats: dict) -> float:
    cpu, pre = stats.get("cpu_stats") or {}, stats.get("precpu_stats") or {}
    cpu_delta = (cpu.get("cpu_usage") or {}).get("total_usage", 0) - (
        (pre.get("cpu_usage") or {}).get("total_usage", 0)
    )
    system_delta = cpu.get("system_cpu_usage", 0) - pre.get("system_cpu_usage", 0)
    cores = (
        cpu.get("online_cpus") or len((cpu.get("cpu_usage") or {}).get("percpu_usage") or []) or 1
    )
    if system_delta > 0 and cpu_delta >= 0:
        return round(cpu_delta / system_delta * cores * 100.0, 1)
    return 0.0


def _memory(stats: dict) -> tuple[int, int]:
    memory = stats.get("memory_stats") or {}
    usage = int(memory.get("usage") or 0)
    detail = memory.get("stats") or {}
    # Like `docker stats`: do not count the page cache the kernel can take back.
    cache = int(detail.get("inactive_file") or detail.get("total_inactive_file") or 0)
    return max(usage - cache, 0), int(memory.get("limit") or 0)


def _seconds_since(timestamp: str | None) -> float | None:
    if not timestamp or timestamp.startswith("0001"):
        return None
    try:
        started = datetime.fromisoformat(timestamp.replace("Z", "+00:00")[:32])
    except ValueError:
        # Docker gives nanoseconds; Python takes microseconds.
        trimmed = re.sub(r"(\.\d{6})\d+", r"\1", timestamp.replace("Z", "+00:00"))
        try:
            started = datetime.fromisoformat(trimmed)
        except ValueError:
            return None
    return max((datetime.now(UTC) - started).total_seconds(), 0.0)


async def _one(http: httpx.AsyncClient, summary: dict) -> dict:
    ident = summary["Id"]
    state = summary.get("State", "")
    labels = summary.get("Labels") or {}
    row = {
        "id": ident[:12],
        "name": (summary.get("Names") or ["/?"])[0].lstrip("/"),
        "image": summary.get("Image", ""),
        "state": state,
        "status": summary.get("Status", ""),
        "project": labels.get("com.docker.compose.project", ""),
        "service": labels.get("com.docker.compose.service", ""),
        "created": summary.get("Created", 0),
        "uptime_seconds": None,
        "restarts": 0,
        "health": "",
        "cpu_percent": None,
        "memory_bytes": None,
        "memory_limit": None,
    }
    inspected = await http.get(f"/containers/{ident}/json")
    if inspected.status_code == 200:
        data = inspected.json()
        st = data.get("State") or {}
        row["restarts"] = int(data.get("RestartCount") or 0)
        row["health"] = (st.get("Health") or {}).get("Status", "")
        if state == "running":
            row["uptime_seconds"] = _seconds_since(st.get("StartedAt"))
    if state == "running":
        stats = await http.get(f"/containers/{ident}/stats", params={"stream": "false"})
        if stats.status_code == 200:
            data = stats.json()
            row["cpu_percent"] = _cpu_percent(data)
            row["memory_bytes"], row["memory_limit"] = _memory(data)
    return row


_cache: dict[str, object] = {"at": 0.0, "rows": []}
_CACHE_SECONDS = 3.0


async def containers(http: httpx.AsyncClient) -> list[dict]:
    """Every container with its uptime, CPU and memory. Cached for a few seconds, because
    sampling the CPU of each one takes about a second and the page polls."""
    if time.monotonic() - float(_cache["at"]) < _CACHE_SECONDS:
        return list(_cache["rows"])  # type: ignore[arg-type]
    rows = await asyncio.gather(*(_one(http, summary) for summary in await _visible(http)))
    rows = sorted(rows, key=lambda r: (r["state"] != "running", r["name"]))
    _cache.update(at=time.monotonic(), rows=rows)
    return list(rows)


def _frames(raw: bytes) -> str:
    """Docker's log stream is framed (8-byte header) unless the container has a TTY."""
    out: list[bytes] = []
    pos = 0
    while pos + 8 <= len(raw):
        stream, _, _, _, size = struct.unpack(">BBBBI", raw[pos : pos + 8])
        if stream not in (0, 1, 2) or pos + 8 + size > len(raw):
            return raw.decode("utf-8", errors="replace")  # not framed: plain text
        out.append(raw[pos + 8 : pos + 8 + size])
        pos += 8 + size
    return b"".join(out).decode("utf-8", errors="replace")


async def logs(http: httpx.AsyncClient, ref: str, tail: int) -> list[str]:
    """The last ``tail`` lines of a container's output, secrets hidden."""
    tail = max(1, min(tail, MAX_LOG_LINES))
    # A container that is not WikiHub's is answered exactly like one that does not exist.
    inspected = await http.get(f"/containers/{ref}/json")
    if inspected.status_code == 404:
        raise LookupError(ref)
    inspected.raise_for_status()
    detail = inspected.json()
    if not is_wikihub(
        ((detail.get("Config") or {}).get("Labels") or {}).get(_PROJECT_LABEL, ""),
        str(detail.get("Name", "")).lstrip("/"),
        await own_project(http),
    ):
        raise LookupError(ref)
    response = await http.get(
        f"/containers/{ref}/logs",
        params={"stdout": "1", "stderr": "1", "tail": str(tail), "timestamps": "1"},
    )
    if response.status_code == 404:
        raise LookupError(ref)
    response.raise_for_status()
    text = redact(_frames(response.content))
    # Docker's output can hold carriage returns from progress bars; keep lines readable.
    return [line.rstrip("\r") for line in text.splitlines()][-tail:]
