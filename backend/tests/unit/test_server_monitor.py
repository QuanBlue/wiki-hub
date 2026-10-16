"""The server monitor: read-only, secrets hidden, numbers computed the way `docker stats` does."""

from __future__ import annotations

import json
import struct
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.ollama_controller import app as controller_app
from app.ollama_controller import docker_api, monitor
from app.ollama_controller.auth import HEADER, token


def docker(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://docker")


@pytest.fixture(autouse=True)
def _fresh_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    monitor._cache.update(at=0.0, rows=[])
    # The controller finds out which compose project it is in by asking Docker about itself.
    monkeypatch.setenv("HOSTNAME", "ctl")
    monkeypatch.setattr(monitor, "_own_project", None)


def _labelled(name: str, project: str = "wikihub") -> httpx.Response:
    """Docker's answer for inspecting one container: its name and compose project."""
    labels = {"com.docker.compose.project": project} if project else {}
    return httpx.Response(200, json={"Name": f"/{name}", "Config": {"Labels": labels}})


# ------------------------------------------------------------------ redaction


@pytest.mark.parametrize(
    ("line", "hidden"),
    [
        ("Authorization: Bearer abcdefghijklmnop12345", "abcdefghijklmnop12345"),
        ("login password=hunter2secret ok", "hunter2secret"),
        ('{"api_key": "sk-live-abcdef123456"}', "sk-live-abcdef123456"),
        ("SECRET_KEY: s3cr3t-value", "s3cr3t-value"),
        ("token=abc.def.ghi-123", "abc.def.ghi-123"),
        ("POSTGRES_PASSWORD=wikihub-db-pw", "wikihub-db-pw"),
        ("WIKIHUB_SECRET_KEY=abcdef0123456789", "abcdef0123456789"),
        ("cookie eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4fw", "SflKxwRJ"),
        ("connect postgres://wikihub:topsecretpw@postgres:5432/db", "topsecretpw"),
    ],
)
def test_credentials_are_hidden_in_logs(line: str, hidden: str) -> None:
    cleaned = monitor.redact(line)

    assert hidden not in cleaned
    assert "***" in cleaned


def test_ordinary_log_lines_are_left_alone() -> None:
    line = "2026-10-15T04:54:40Z [info] search_index_pass pages_indexed=9 chunks=9 seconds=57.1"
    assert monitor.redact(line) == line


def test_only_container_names_and_ids_are_accepted() -> None:
    for good in ("wikihub-backend-1", "a1b2c3d4e5f6", "report-control-plane", "x.y_z-1"):
        assert monitor.valid_ref(good)
    for bad in ("", "../etc/passwd", "a/b", "a b", "a;rm", "-leading", "x" * 200, "a?tail=1"):
        assert not monitor.valid_ref(bad), bad


# ------------------------------------------------------------------ numbers


def test_cpu_percent_is_the_share_of_the_machine_times_its_cores() -> None:
    stats = {
        "cpu_stats": {
            "cpu_usage": {"total_usage": 300},
            "system_cpu_usage": 2000,
            "online_cpus": 4,
        },
        "precpu_stats": {"cpu_usage": {"total_usage": 100}, "system_cpu_usage": 1000},
    }
    # 200 of 1000 ticks on a 4-core machine = 80% of one core... times 4 cores = 80.0
    assert monitor._cpu_percent(stats) == 80.0
    assert monitor._cpu_percent({}) == 0.0
    idle = {
        "cpu_stats": {"cpu_usage": {"total_usage": 5}, "system_cpu_usage": 10},
        "precpu_stats": {},
    }
    assert monitor._cpu_percent(idle) >= 0.0


def test_memory_leaves_out_the_cache_the_kernel_can_take_back() -> None:
    stats = {"memory_stats": {"usage": 1000, "limit": 4000, "stats": {"inactive_file": 300}}}
    assert monitor._memory(stats) == (700, 4000)
    v1 = {"memory_stats": {"usage": 900, "limit": 1, "stats": {"total_inactive_file": 400}}}
    assert monitor._memory(v1) == (500, 1)
    assert monitor._memory({}) == (0, 0)


def test_uptime_is_read_from_dockers_nanosecond_timestamps() -> None:
    started = datetime.now(UTC) - timedelta(hours=2)
    stamp = started.strftime("%Y-%m-%dT%H:%M:%S.123456789Z")
    seconds = monitor._seconds_since(stamp)
    assert seconds is not None and 7190 < seconds < 7260
    assert monitor._seconds_since("0001-01-01T00:00:00Z") is None
    assert monitor._seconds_since(None) is None
    assert monitor._seconds_since("garbage") is None


def test_host_metrics_report_cores_memory_and_disk() -> None:
    metrics = monitor.host_metrics()

    assert metrics["cpus"] >= 1
    assert metrics["disk_total"] >= metrics["disk_used"] >= 0
    assert metrics["memory_used"] <= metrics["memory_total"] or metrics["memory_total"] == 0


# ------------------------------------------------------------------ docker calls


def _frame(stream: int, text: str) -> bytes:
    body = text.encode()
    return struct.pack(">BBBBI", stream, 0, 0, 0, len(body)) + body


async def test_framed_and_plain_logs_are_both_read_and_cut_to_the_tail() -> None:
    framed = _frame(1, "one\ntwo\n") + _frame(2, "three password=hunter2secret\n")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/json"):
            return _labelled("web")
        assert request.url.params["tail"] == "2"
        assert request.url.params["timestamps"] == "1"
        return httpx.Response(200, content=framed)

    async with docker(handler) as http:
        lines = await monitor.logs(http, "web", 2)

    assert lines == ["two", "three password=***"]

    def plain(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/json"):
            return _labelled("web")
        return httpx.Response(200, content=b"plain tty line\r\nnext\r\n")

    async with docker(plain) as http:
        assert await monitor.logs(http, "web", 50) == ["plain tty line", "next"]


async def test_the_tail_is_bounded_and_a_missing_container_is_reported() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/json"):
            return _labelled("web")
        seen.append(request.url.params["tail"])
        return httpx.Response(200, content=b"")

    async with docker(handler) as http:
        await monitor.logs(http, "web", 10**6)
        await monitor.logs(http, "web", 0)
    assert seen == [str(monitor.MAX_LOG_LINES), "1"]

    async with docker(lambda r: httpx.Response(404)) as http:
        with pytest.raises(LookupError):
            await monitor.logs(http, "ghost", 10)


async def test_the_container_list_has_uptime_cpu_memory_and_health_and_is_cached() -> None:
    started = (datetime.now(UTC) - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%S.000000000Z")
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        calls.append(path)
        if path == "/containers/ctl/json":
            return _labelled("wikihub-worker-1")
        if path == "/containers/json":
            assert request.url.params["all"] == "1"
            return httpx.Response(
                200,
                json=[
                    {
                        "Id": "a" * 64,
                        "Names": ["/wikihub-backend-1"],
                        "Image": "wikihub-backend",
                        "State": "running",
                        "Status": "Up 5 minutes (healthy)",
                        "Created": 1,
                        "Labels": {
                            "com.docker.compose.project": "wikihub",
                            "com.docker.compose.service": "backend",
                        },
                    },
                    {
                        "Id": "b" * 64,
                        "Names": ["/old-job"],
                        "Image": "busybox",
                        "State": "exited",
                        "Status": "Exited (0) 3 hours ago",
                        "Created": 2,
                        "Labels": {"com.docker.compose.project": "wikihub"},
                    },
                    {
                        "Id": "c" * 64,
                        "Names": ["/someone-elses-db"],
                        "Image": "postgres",
                        "State": "running",
                        "Status": "Up 3 days",
                        "Created": 3,
                        "Labels": {"com.docker.compose.project": "other-stack"},
                    },
                    {
                        "Id": "d" * 64,
                        "Names": ["/wikihub-ollama"],  # started by WikiHub itself, no compose label
                        "Image": "ollama/ollama",
                        "State": "exited",
                        "Status": "Exited (0) 1 hour ago",
                        "Created": 4,
                        "Labels": {},
                    },
                ],
            )
        if path.endswith("/stats"):
            return httpx.Response(
                200,
                json={
                    "cpu_stats": {
                        "cpu_usage": {"total_usage": 200},
                        "system_cpu_usage": 2000,
                        "online_cpus": 2,
                    },
                    "precpu_stats": {"cpu_usage": {"total_usage": 100}, "system_cpu_usage": 1000},
                    "memory_stats": {"usage": 500, "limit": 1000, "stats": {"inactive_file": 100}},
                },
            )
        return httpx.Response(
            200,
            json={
                "RestartCount": 2,
                "State": {"StartedAt": started, "Health": {"Status": "healthy"}},
            },
        )

    async with docker(handler) as http:
        rows = await monitor.containers(http)
        again = await monitor.containers(http)

    # Another stack's container is not listed at all; WikiHub's Ollama is, though unlabelled.
    assert [row["name"] for row in rows] == ["wikihub-backend-1", "old-job", "wikihub-ollama"]
    running, exited, _ollama = rows  # running first
    assert (running["id"], running["name"], running["project"], running["service"]) == (
        "a" * 12,
        "wikihub-backend-1",
        "wikihub",
        "backend",
    )
    assert running["health"] == "healthy" and running["restarts"] == 2
    assert 290 < running["uptime_seconds"] < 320
    assert running["cpu_percent"] == 20.0
    assert (running["memory_bytes"], running["memory_limit"]) == (400, 1000)
    # A stopped container has no uptime, CPU or memory to report.
    assert exited["state"] == "exited" and exited["uptime_seconds"] is None
    assert exited["cpu_percent"] is None and exited["memory_bytes"] is None
    # The second call came from the cache: Docker was not asked again.
    assert again == rows and calls.count("/containers/json") == 1


# ------------------------------------------------------------------ HTTP face


@pytest.fixture
def served(monkeypatch: pytest.MonkeyPatch):
    state = {"handler": lambda request: httpx.Response(200, json={})}
    monkeypatch.setattr(docker_api, "client", lambda: docker(lambda r: state["handler"](r)))

    def make(valid_token: bool = True) -> AsyncClient:
        return AsyncClient(
            transport=ASGITransport(app=controller_app.create_app()),
            base_url="http://controller",
            headers={HEADER: token(settings.secret_key) if valid_token else "nope"},
        )

    return state, make


async def test_the_monitor_routes_need_the_token_and_only_read(served) -> None:
    _, make = served
    async with make(valid_token=False) as client:
        for path in ("/host", "/containers", "/containers/web/logs"):
            assert (await client.get(path)).status_code == 401, path
    app = controller_app.create_app()
    monitor_routes = {
        (m, r.path)
        for r in app.routes
        for m in getattr(r, "methods", set()) - {"HEAD"}
        if r.path in ("/host", "/containers", "/containers/{ref}/logs")
    }
    # Nothing that changes anything: GET only.
    assert monitor_routes == {
        ("GET", "/host"),
        ("GET", "/containers"),
        ("GET", "/containers/{ref}/logs"),
    }


async def test_host_reports_docker_facts_and_load(served) -> None:
    state, make = served
    mine = {"com.docker.compose.project": "wikihub"}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/containers/ctl/json":
            return _labelled("wikihub-worker-1")
        if request.url.path == "/containers/json":
            return httpx.Response(
                200,
                json=[
                    {"Id": "a" * 64, "Names": ["/wikihub-a"], "State": "running", "Labels": mine},
                    {"Id": "b" * 64, "Names": ["/wikihub-b"], "State": "exited", "Labels": mine},
                    {"Id": "c" * 64, "Names": ["/other"], "State": "running", "Labels": {}},
                ],
            )
        return httpx.Response(
            200,
            json={
                "ServerVersion": "27.0.1",
                "OperatingSystem": "Ubuntu 24.04",
                "KernelVersion": "6.6",
                "Containers": 16,
                "ContainersRunning": 12,
                "Images": 15,
            },
        )

    state["handler"] = handler
    async with make() as client:
        body = (await client.get("/host")).json()

    assert body["docker_ok"] is True and body["docker_version"] == "27.0.1"
    # Only WikiHub's containers are counted, not the 16 Docker runs altogether.
    assert (body["containers_running"], body["containers_total"]) == (1, 2)
    assert body["cpus"] >= 1


async def test_a_bad_container_name_never_reaches_docker(served) -> None:
    state, make = served
    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.path)
        if request.url.path.endswith("/json"):
            return _labelled("web")
        return httpx.Response(200, content=b"")

    state["handler"] = handler
    async with make() as client:
        bad = await client.get("/containers/..%2Fetc/logs")
        assert bad.status_code in (404, 422)
        weird = await client.get("/containers/a;b/logs")
        assert weird.status_code == 422
        ok = await client.get("/containers/web/logs?tail=5")
        assert ok.status_code == 200
    assert asked == ["/containers/web/json", "/containers/ctl/json", "/containers/web/logs"]


async def test_logs_of_a_container_outside_wikihub_are_refused_like_a_missing_one(served) -> None:
    state, make = served
    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.path)
        if request.url.path == "/containers/ctl/json":
            return _labelled("wikihub-worker-1")
        if request.url.path.endswith("/json"):
            return _labelled("someone-elses-db", project="other-stack")
        return httpx.Response(200, content=b"secret output")

    state["handler"] = handler
    async with make() as client:
        refused = await client.get("/containers/someone-elses-db/logs")

    assert refused.status_code == 404
    assert "secret" not in refused.text
    # The logs were never even requested from Docker.
    assert not any(path.endswith("/logs") for path in asked)


def test_what_counts_as_wikihub() -> None:
    assert monitor.is_wikihub("wikihub", "wikihub-backend-1", "wikihub")
    assert monitor.is_wikihub("", "wikihub-ollama", "wikihub")  # started by WikiHub, no label
    assert not monitor.is_wikihub("other", "web", "wikihub")
    assert not monitor.is_wikihub("", "web", "wikihub")
    # Unknown project (could not read our own): nothing matches by label.
    assert not monitor.is_wikihub("", "web", "")
    assert not monitor.is_wikihub("wikihub", "web", "")


async def test_logs_of_a_missing_container_are_a_404(served) -> None:
    state, make = served
    state["handler"] = lambda request: httpx.Response(404)
    async with make() as client:
        assert (await client.get("/containers/ghost/logs")).status_code == 404


async def test_docker_being_down_is_reported_not_raised(served) -> None:
    state, make = served

    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no socket")

    state["handler"] = broken
    async with make() as client:
        host = (await client.get("/host")).json()
        listed = (await client.get("/containers")).json()
        logs = await client.get("/containers/web/logs")

    assert host["docker_ok"] is False and host["cpus"] >= 1  # kernel facts still shown
    assert listed == {"docker_ok": False, "containers": []}
    assert logs.status_code == 502
    assert json.dumps(host)  # serialisable
