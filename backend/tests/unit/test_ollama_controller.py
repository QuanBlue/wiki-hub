"""The Ollama controller: the only thing with the Docker socket, so what it can be
made to do is checked closely - fixed parameters, a token on every call, nothing
from a request reaching Docker."""

from __future__ import annotations

import json

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.ollama_controller import app as controller_app
from app.ollama_controller import docker_api
from app.ollama_controller.auth import HEADER, is_valid, token


def docker(handler) -> httpx.AsyncClient:
    """A Docker Engine API stand-in that records nothing and returns what ``handler`` says."""
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://docker")


@pytest.fixture(autouse=True)
def _own_container(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOSTNAME", "abc123")


# ------------------------------------------------------------------------ auth


def test_the_token_depends_on_the_secret_key_and_is_checked_in_constant_time() -> None:
    assert token("one") == token("one")
    assert token("one") != token("two")
    assert is_valid("one", token("one"))
    assert not is_valid("one", token("two"))
    assert not is_valid("one", "")
    assert not is_valid("one", None)


def test_memory_limits_accept_plain_bytes_and_suffixes() -> None:
    assert docker_api.parse_memory("3g") == 3 * 1024**3
    assert docker_api.parse_memory("512M") == 512 * 1024**2
    assert docker_api.parse_memory("1024") == 1024


# ---------------------------------------------------------------- docker calls


async def test_starting_creates_the_container_with_only_fixed_parameters() -> None:
    calls: list[tuple[str, str, dict]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else {}
        calls.append((request.method, request.url.path, body))
        if request.url.path == f"/containers/{docker_api.CONTAINER}/json":
            return httpx.Response(404)
        if request.url.path == "/containers/abc123/json":
            return httpx.Response(
                200, json={"NetworkSettings": {"Networks": {"wikihub_default": {}}}}
            )
        if request.url.path == "/containers/create":
            return httpx.Response(201, json={"Id": "x"})
        return httpx.Response(204)

    async with docker(handler) as http:
        await docker_api.start(http)

    create = next(c for c in calls if c[1] == "/containers/create")
    body = create[2]
    assert body["Image"] == docker_api.IMAGE
    assert body["HostConfig"]["Binds"] == [f"{docker_api.VOLUME}:/root/.ollama"]
    assert body["HostConfig"]["NetworkMode"] == "wikihub_default"
    assert body["HostConfig"]["Memory"] == docker_api.parse_memory(docker_api.MEMORY_LIMIT)
    assert body["HostConfig"]["RestartPolicy"] == {"Name": "no"}
    assert body["NetworkingConfig"]["EndpointsConfig"]["wikihub_default"]["Aliases"] == ["ollama"]
    assert "PortBindings" not in body["HostConfig"]  # nothing is published
    assert "Cmd" not in body and "Entrypoint" not in body
    assert f"OLLAMA_KEEP_ALIVE={docker_api.KEEP_ALIVE}" in body["Env"]
    assert ("POST", f"/containers/{docker_api.CONTAINER}/start", {}) in calls


async def test_starting_an_existing_container_only_starts_it() -> None:
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        if request.url.path.endswith("/json"):
            return httpx.Response(200, json={"State": {"Status": "exited"}})
        return httpx.Response(204)

    async with docker(handler) as http:
        await docker_api.start(http)

    assert "/containers/create" not in paths
    assert paths[-1] == f"/containers/{docker_api.CONTAINER}/start"


async def test_a_docker_refusal_is_reported_not_swallowed() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/json"):
            return httpx.Response(
                404 if "wikihub-ollama" in request.url.path else 200,
                json={"NetworkSettings": {"Networks": {"n": {}}}},
            )
        return httpx.Response(500, text="no space left on device")

    async with docker(handler) as http:
        with pytest.raises(docker_api.DockerError, match="no space left"):
            await docker_api.start(http)


async def test_stopping_stops_then_removes_and_tolerates_a_missing_container() -> None:
    calls: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path))
        return httpx.Response(404 if request.method == "DELETE" else 204)

    async with docker(handler) as http:
        await docker_api.stop(http)

    assert calls == [
        ("POST", f"/containers/{docker_api.CONTAINER}/stop"),
        ("DELETE", f"/containers/{docker_api.CONTAINER}"),
    ]


async def test_models_are_only_deleted_while_the_container_is_gone() -> None:
    present = {"yes": True}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.startswith("/containers"):
            return httpx.Response(200 if present["yes"] else 404, json={})
        return httpx.Response(204)

    async with docker(handler) as http:
        with pytest.raises(docker_api.DockerError, match="Disable Ollama"):
            await docker_api.remove_models(http)
        present["yes"] = False
        await docker_api.remove_models(http)  # no error


async def test_status_reports_image_container_memory_and_volume() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.startswith("/images/"):
            return httpx.Response(200, json={"Size": 123})
        if path.endswith("/stats"):
            # 1000 bytes used of which 544 is page cache the kernel can take back; 4 of 8 cores' worth
            # of CPU time passed in the sample, on a 12-core view of the system.
            return httpx.Response(
                200,
                json={
                    "memory_stats": {"usage": 1000, "stats": {"inactive_file": 544}},
                    "cpu_stats": {
                        "cpu_usage": {"total_usage": 2_000},
                        "system_cpu_usage": 12_000,
                        "online_cpus": 12,
                    },
                    "precpu_stats": {
                        "cpu_usage": {"total_usage": 1_000},
                        "system_cpu_usage": 6_000,
                    },
                },
            )
        if path.startswith("/containers/"):
            return httpx.Response(
                200,
                json={
                    "State": {"Status": "running"},
                    "HostConfig": {"Memory": 3 * 1024**3, "CpusetCpus": "0-3"},
                    "Config": {"Env": ["OLLAMA_KEEP_ALIVE=10m"]},
                },
            )
        return httpx.Response(200, json={})

    async with docker(handler) as http:
        state = await docker_api.status(http)

    assert state == docker_api.Status(
        image_present=True,
        image_bytes=123,
        container="running",
        memory_bytes=456,
        cpu_percent=200.0,
        volume_present=True,
        applied=docker_api.Params(memory_mb=3072, cpus=4, keep_alive="10m"),
    )


def test_pull_progress_falls_back_to_counting_layers_when_none_reports_sizes() -> None:
    progress = docker_api.PullProgress()
    for layer in ("a", "b"):
        progress.update({"id": layer, "status": "Pulling fs layer", "progressDetail": {}})
    assert progress.percent == 0
    progress.update(
        {"id": "a", "status": "Download complete", "progressDetail": {"hidecounts": True}}
    )
    assert progress.percent == 50
    progress.update({"id": "b", "status": "Pull complete"})
    assert progress.percent == 100


def test_pull_progress_never_goes_backwards_when_a_new_layer_appears() -> None:
    progress = docker_api.PullProgress()
    progress.update(
        {"id": "a", "status": "Downloading", "progressDetail": {"current": 90, "total": 100}}
    )
    assert progress.percent == 90
    progress.update(
        {"id": "b", "status": "Downloading", "progressDetail": {"current": 0, "total": 900}}
    )
    assert progress.percent == 90  # 90 of 1000 would be 9%


def test_pull_progress_sums_the_layers_and_never_exceeds_100() -> None:
    progress = docker_api.PullProgress()
    progress.update(
        {"id": "a", "status": "Downloading", "progressDetail": {"current": 50, "total": 100}}
    )
    progress.update(
        {"id": "b", "status": "Downloading", "progressDetail": {"current": 0, "total": 300}}
    )
    assert progress.percent == 12  # 50 of 400
    progress.update({"id": "b", "status": "Download complete"})
    progress.update({"id": "a", "status": "Pull complete"})
    assert progress.percent == 100
    progress.update({"status": "Pulling from ollama/ollama"})  # no layer id: ignored
    assert progress.percent == 100


async def test_the_image_pull_streams_progress_and_raises_docker_errors() -> None:
    lines = [
        {"id": "a", "status": "Downloading", "progressDetail": {"current": 10, "total": 100}},
        {"id": "a", "status": "Download complete"},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["fromImage"] == "ollama/ollama"
        assert request.url.params["tag"] == docker_api.IMAGE.split(":")[1]
        return httpx.Response(200, content="".join(json.dumps(line) + "\n" for line in lines))

    async with docker(handler) as http:
        events = [event async for event in docker_api.pull_image(http)]
    assert [e["percent"] for e in events] == [10, 100]

    def failing(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=json.dumps({"error": "toomanyrequests"}) + "\n")

    async with docker(failing) as http:
        with pytest.raises(docker_api.DockerError, match="toomanyrequests"):
            [event async for event in docker_api.pull_image(http)]


# ------------------------------------------------------------------- HTTP face


@pytest.fixture
def served(monkeypatch: pytest.MonkeyPatch):
    """The controller app talking to a scripted Docker."""
    state = {"handler": lambda request: httpx.Response(204)}
    monkeypatch.setattr(docker_api, "client", lambda: docker(lambda r: state["handler"](r)))

    def make() -> AsyncClient:
        return AsyncClient(
            transport=ASGITransport(app=controller_app.create_app()),
            base_url="http://controller",
            headers={HEADER: token(settings.secret_key)},
        )

    return state, make


async def test_every_call_but_health_needs_the_token(served) -> None:
    _, make = served
    async with make() as client:
        assert (await client.get("/health", headers={HEADER: ""})).status_code == 200
        for method, path in (
            ("GET", "/status"),
            ("POST", "/pull-image"),
            ("POST", "/start"),
            ("POST", "/stop"),
            ("DELETE", "/models"),
        ):
            bare = await client.request(method, path, headers={HEADER: "wrong"})
            assert bare.status_code == 401, path


async def test_the_controller_has_no_other_routes_and_takes_no_parameters(served) -> None:
    _, make = served
    app = controller_app.create_app()
    routes = {(m, r.path) for r in app.routes for m in getattr(r, "methods", set()) - {"HEAD"}}
    assert routes == {
        ("GET", "/health"),
        ("GET", "/status"),
        ("POST", "/pull-image"),
        ("POST", "/start"),
        ("POST", "/stop"),
        ("DELETE", "/models"),
        # The server monitor: read-only, no way to change anything.
        ("GET", "/host"),
        ("GET", "/containers"),
        ("GET", "/containers/{ref}/logs"),
    }
    async with make() as client:
        # A body or query string is ignored: nothing a caller sends reaches Docker.
        sent: list[httpx.Request] = []

        def record(request: httpx.Request) -> httpx.Response:
            sent.append(request)
            return httpx.Response(204)

        served[0]["handler"] = record
        await client.post("/stop?name=other&force=1", json={"container": "somebody-else"})
    assert {r.url.path for r in sent} == {
        f"/containers/{docker_api.CONTAINER}/stop",
        f"/containers/{docker_api.CONTAINER}",
    }
    assert all("other" not in str(r.url) and not r.content for r in sent)


async def test_status_says_when_docker_is_unreachable(served) -> None:
    state, make = served

    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no socket")

    state["handler"] = broken
    async with make() as client:
        body = (await client.get("/status")).json()
    assert body["docker_ok"] is False and "not reachable" in body["error"]


async def test_a_docker_failure_becomes_an_http_error_with_the_reason(served) -> None:
    state, make = served

    def refuse(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/json"):
            return httpx.Response(
                404 if "wikihub-ollama" in request.url.path else 200,
                json={"NetworkSettings": {"Networks": {"n": {}}}},
            )
        return httpx.Response(500, text="out of disk")

    state["handler"] = refuse
    async with make() as client:
        response = await client.post("/start")
    assert response.status_code == 500  # Docker's own status is passed through
    assert "out of disk" in response.text


async def test_the_pull_streams_progress_lines_ending_in_done(served) -> None:
    state, make = served
    state["handler"] = lambda r: httpx.Response(
        200,
        content=json.dumps(
            {"id": "a", "status": "Downloading", "progressDetail": {"current": 1, "total": 2}}
        )
        + "\n",
    )
    async with make() as client:
        response = await client.post("/pull-image")
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[0]["percent"] == 50
    assert events[-1] == {"done": True, "percent": 100}


# ------------------------------------------------------- the options an admin may set


def test_the_container_options_are_bounded_numbers_and_a_fixed_list() -> None:
    ok = docker_api.Params.validated(4096, 4, "30m")
    assert (ok.memory_mb, ok.cpus, ok.keep_alive, ok.cpuset) == (4096, 4, "30m", "0-3")
    assert docker_api.Params.validated(1024, 0, "-1").cpuset == ""  # 0 cores = all of them

    for bad in (
        (100, 0, "5m"),  # below the minimum memory
        (10**9, 0, "5m"),  # absurdly large
        ("lots", 0, "5m"),
        (4096, -1, "5m"),
        (4096, 10_000, "5m"),  # more cores than the machine has
        (4096, 0, "forever"),  # not one of the offered keep-alive times
        (4096, 0, "5m; rm -rf /"),  # free text never reaches Docker
    ):
        with pytest.raises(docker_api.DockerError):
            docker_api.Params.validated(*bad)


async def test_starting_applies_the_chosen_memory_cores_and_keep_alive() -> None:
    calls: list[tuple[str, str, dict]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else {}
        calls.append((request.method, request.url.path, body))
        if request.url.path == f"/containers/{docker_api.CONTAINER}/json":
            return httpx.Response(404)
        if request.url.path == "/containers/abc123/json":
            return httpx.Response(200, json={"NetworkSettings": {"Networks": {"n": {}}}})
        return httpx.Response(201 if request.url.path.endswith("/create") else 204, json={})

    async with docker(handler) as http:
        await docker_api.start(http, docker_api.Params(memory_mb=2048, cpus=3, keep_alive="1h"))

    body = next(b for m, p, b in calls if p == "/containers/create")
    assert body["HostConfig"]["Memory"] == 2048 * 1024**2
    assert body["HostConfig"]["CpusetCpus"] == "0-2"
    assert "OLLAMA_KEEP_ALIVE=1h" in body["Env"]


async def test_a_running_container_with_other_settings_is_recreated_not_just_started() -> None:
    state = {"exists": True, "calls": []}

    def handler(request: httpx.Request) -> httpx.Response:
        path, method = request.url.path, request.method
        state["calls"].append((method, path))
        if path == f"/containers/{docker_api.CONTAINER}/json":
            if state["exists"]:
                return httpx.Response(
                    200,
                    json={
                        "HostConfig": {"Memory": 3 * 1024**3, "CpusetCpus": ""},
                        "Config": {"Env": ["OLLAMA_KEEP_ALIVE=5m"]},
                    },
                )
            return httpx.Response(404)
        if path == "/containers/abc123/json":
            return httpx.Response(200, json={"NetworkSettings": {"Networks": {"n": {}}}})
        if method == "DELETE":
            state["exists"] = False
        return httpx.Response(201 if path.endswith("/create") else 204, json={})

    async with docker(handler) as http:
        await docker_api.start(http, docker_api.Params(memory_mb=3072, cpus=0, keep_alive="1h"))

    calls = state["calls"]
    assert ("DELETE", f"/containers/{docker_api.CONTAINER}") in calls
    assert ("POST", "/containers/create") in calls


async def test_an_unchanged_container_is_just_started() -> None:
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        if request.url.path.endswith("/json"):
            return httpx.Response(
                200,
                json={
                    "HostConfig": {"Memory": 3 * 1024**3, "CpusetCpus": ""},
                    "Config": {"Env": ["OLLAMA_KEEP_ALIVE=5m"]},
                },
            )
        return httpx.Response(204)

    async with docker(handler) as http:
        await docker_api.start(http, docker_api.Params(memory_mb=3072, cpus=0, keep_alive="5m"))

    assert "/containers/create" not in paths


async def test_start_rejects_out_of_range_options_and_free_text_over_http(served) -> None:
    _, make = served
    async with make() as client:
        bad = await client.post(
            "/start", json={"memory_mb": 4096, "cpus": 0, "keep_alive": "5m; reboot"}
        )
        assert bad.status_code == 422
        too_big = await client.post(
            "/start", json={"memory_mb": 10**9, "cpus": 0, "keep_alive": "5m"}
        )
        assert too_big.status_code == 422
        no_numbers = await client.post("/start", json={"memory_mb": "lots"})
        assert no_numbers.status_code == 422
