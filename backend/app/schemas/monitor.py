"""Shapes for the administrator's server monitor."""

from __future__ import annotations

from pydantic import BaseModel


class HostInfo(BaseModel):
    cpus: int = 1
    #: 1, 5 and 15 minute load averages (empty when the kernel does not say).
    load: list[float] = []
    memory_total: int = 0
    memory_used: int = 0
    memory_available: int = 0
    swap_total: int = 0
    swap_used: int = 0
    disk_total: int = 0
    disk_used: int = 0
    uptime_seconds: float = 0.0
    docker_version: str = ""
    os: str = ""
    kernel: str = ""
    containers_total: int = 0
    containers_running: int = 0
    images: int = 0


class ContainerInfo(BaseModel):
    id: str
    name: str
    image: str
    #: ``running``, ``exited``, ``restarting``, ...
    state: str
    #: Docker's own words, e.g. ``Up 7 hours (healthy)``.
    status: str
    #: The compose project and service, empty for a container started by hand.
    project: str = ""
    service: str = ""
    created: int = 0
    #: ``None`` unless it is running.
    uptime_seconds: float | None = None
    restarts: int = 0
    #: ``healthy``, ``unhealthy``, ``starting`` or empty when it has no health check.
    health: str = ""
    cpu_percent: float | None = None
    memory_bytes: int | None = None
    memory_limit: int | None = None


class MonitorOverview(BaseModel):
    docker_ok: bool
    host: HostInfo
    containers: list[ContainerInfo]


class ContainerLogs(BaseModel):
    lines: list[str]
