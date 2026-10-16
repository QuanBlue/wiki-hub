"""The corners of the Ollama controller and the server monitor: Docker answering badly, the
kernel's files being odd, and the controller turning every failure into an honest answer."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

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
def _own_container(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOSTNAME", "abc123")
    monkeypatch.setattr(monitor, "_own_project", None)


def lines(*events: object) -> bytes:
    return "".join(
        (event if isinstance(event, str) else json.dumps(event)) + "\n" for event in events
    ).encode()


# ---------------------------------------------------------------- the Docker socket client


async def test_the_docker_client_talks_over_the_unix_socket() -> None:
    async with docker_api.client() as http:
        assert str(http.base_url).startswith("http://docker")


# ---------------------------------------------------------------- finding its own network


async def test_a_controller_that_cannot_find_its_own_container_says_so() -> None:
    async with docker(lambda request: httpx.Response(404)) as http:
        with pytest.raises(docker_api.DockerError, match="own container") as raised:
            await docker_api.own_network(http)
    assert raised.value.status == 404


async def test_a_controller_on_no_network_says_so() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"NetworkSettings": {"Networks": {}}})

    async with docker(handler) as http:
        with pytest.raises(docker_api.DockerError, match="not attached to a network"):
            await docker_api.own_network(http)


# ---------------------------------------------------------------- the image download


async def test_an_image_pull_docker_refuses_says_what_docker_said() -> None:
    async with docker(lambda request: httpx.Response(500, content=b"no space left")) as http:
        with pytest.raises(docker_api.DockerError, match="no space left") as raised:
            _ = [event async for event in docker_api.pull_image(http)]
    assert raised.value.status == 500


async def test_blank_lines_in_an_image_pull_are_skipped_and_layers_without_sizes_still_count() -> (
    None
):
    body = lines(
        {"status": "Pulling fs layer", "id": "a"},
        "",
        {"status": "Pull complete", "id": "a"},
    )
    async with docker(lambda request: httpx.Response(200, content=body)) as http:
        events = [event async for event in docker_api.pull_image(http)]

    assert [e["percent"] for e in events] == [0, 100]


async def test_an_error_event_in_an_image_pull_is_raised() -> None:
    body = lines({"error": "manifest unknown"})
    async with docker(lambda request: httpx.Response(200, content=body)) as http:
        with pytest.raises(docker_api.DockerError, match="manifest unknown"):
            _ = [event async for event in docker_api.pull_image(http)]


# ---------------------------------------------------------------- starting, stopping, deleting


async def test_a_container_docker_cannot_inspect_is_not_started_blindly() -> None:
    async with docker(lambda request: httpx.Response(500)) as http:
        with pytest.raises(docker_api.DockerError, match="could not inspect") as raised:
            await docker_api.start(http)
    assert raised.value.status == 500


async def test_a_container_docker_will_not_start_says_why() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/json"):
            # A container that already has exactly the wanted settings is just started.
            wanted = docker_api.Params.default()
            return httpx.Response(
                200,
                json={
                    "HostConfig": {"Memory": wanted.memory_mb * 1024**2},
                    "Config": {"Env": [f"OLLAMA_KEEP_ALIVE={wanted.keep_alive}"]},
                },
            )
        return httpx.Response(500, text="cannot start")

    async with docker(handler) as http:
        with pytest.raises(
            docker_api.DockerError, match="could not start the container: cannot start"
        ):
            await docker_api.start(http, docker_api.Params.default())


async def test_a_container_docker_will_not_remove_says_why() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return (
            httpx.Response(409, text="in use")
            if request.method == "DELETE"
            else httpx.Response(204)
        )

    async with docker(handler) as http:
        with pytest.raises(docker_api.DockerError, match="could not remove the container: in use"):
            await docker_api.stop(http)


async def test_models_docker_will_not_delete_are_reported() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(404)
        return httpx.Response(409, text="volume in use")

    async with docker(handler) as http:
        with pytest.raises(
            docker_api.DockerError, match="could not remove the volume: volume in use"
        ):
            await docker_api.remove_models(http)


# ---------------------------------------------------------------- the controller's routes


@pytest.fixture
def served(monkeypatch: pytest.MonkeyPatch):
    """The controller app with Docker replaced by ``respond``, and the token already known."""
    state = {"respond": lambda request: httpx.Response(404)}

    monkeypatch.setattr(
        controller_app.docker_api,
        "client",
        lambda: docker(lambda request: state["respond"](request)),
    )

    def client() -> AsyncClient:
        return AsyncClient(
            transport=ASGITransport(app=controller_app.create_app()),
            base_url="http://controller",
            headers={HEADER: token(settings.secret_key)},
        )

    return state, client


async def test_the_status_route_describes_what_docker_holds(served) -> None:
    state, client = served

    def respond(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith(f"/images/{docker_api.IMAGE}/json"):
            return httpx.Response(200, json={"Size": 2048})
        if path.endswith(f"/containers/{docker_api.CONTAINER}/json"):
            return httpx.Response(200, json={"State": {"Status": "exited"}})
        return httpx.Response(404)

    state["respond"] = respond
    async with client() as http:
        body = (await http.get("/status")).json()

    assert body["docker_ok"] is True and body["image_present"] is True
    assert body["image_bytes"] == 2048 and body["container"] == "exited"


async def test_a_pull_that_fails_ends_in_an_error_line_the_caller_can_show(served) -> None:
    state, client = served
    state["respond"] = lambda request: httpx.Response(500, content=b"registry down")

    async with client() as http:
        response = await http.post("/pull-image")

    last = json.loads(response.text.strip().splitlines()[-1])
    assert "registry down" in last["error"]


async def test_deleting_the_models_goes_through_when_nothing_holds_them(served) -> None:
    state, client = served
    state["respond"] = lambda request: (
        httpx.Response(404) if request.method == "GET" else httpx.Response(204)
    )

    async with client() as http:
        response = await http.delete("/models")

    assert response.status_code == 200 and response.json() == {"ok": True}


async def test_an_unexpected_failure_while_acting_is_a_502_without_its_details(
    served, monkeypatch: pytest.MonkeyPatch
) -> None:
    _state, client = served

    async def boom(_http: object) -> None:
        raise RuntimeError("socket path /var/run/docker.sock gone")

    monkeypatch.setattr(controller_app.docker_api, "stop", boom)
    async with client() as http:
        response = await http.post("/stop")

    assert response.status_code == 502
    assert "docker.sock" not in response.text


# ---------------------------------------------------------------- the kernel's files


def test_a_file_that_can_be_read_is_returned_and_one_that_cannot_is_empty(tmp_path: Path) -> None:
    readable = tmp_path / "uptime"
    readable.write_text("123.4 5.6\n", encoding="utf-8")

    assert monitor._read(str(readable)) == "123.4 5.6\n"
    assert monitor._read(str(tmp_path / "missing")) == ""


def test_host_metrics_read_memory_swap_and_disk_from_the_kernel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    files = {
        "/proc/loadavg": "0.5 0.4 0.3 1/100 999",
        "/proc/meminfo": (
            "MemTotal:       1000 kB\nMemAvailable:    400 kB\nSwapTotal: 200 kB\n"
            "SwapFree: 150 kB\nBogus: text\nnocolon\n"
        ),
        "/proc/uptime": "321.5 100.0",
    }
    monkeypatch.setattr(monitor, "_read", lambda path: files.get(path, ""))

    metrics = monitor.host_metrics()

    assert metrics["memory_total"] == 1000 * 1024 and metrics["memory_used"] == 600 * 1024
    assert metrics["swap_used"] == 50 * 1024 and metrics["uptime_seconds"] == 321.5
    assert metrics["load"] == [0.5, 0.4, 0.3]


def test_host_metrics_without_a_readable_disk_report_none(monkeypatch: pytest.MonkeyPatch) -> None:
    def unreadable(_path: str) -> object:
        raise OSError("no such device")

    monkeypatch.setattr(shutil, "disk_usage", unreadable)

    metrics = monitor.host_metrics()

    assert metrics["disk_total"] == 0 and metrics["disk_used"] == 0


# ---------------------------------------------------------------- what counts as WikiHub's


async def test_a_controller_whose_container_has_no_project_label_has_no_project() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"Config": {"Labels": {}}})

    async with docker(handler) as http:
        assert await monitor.own_project(http) == ""

    assert monitor._own_project is None  # not remembered: a later call can still find it


async def test_docker_that_will_not_describe_itself_gives_no_facts() -> None:
    async with docker(lambda request: httpx.Response(500)) as http:
        assert await monitor.docker_facts(http) == {}


async def test_logs_that_vanish_between_the_check_and_the_read_are_a_missing_container() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/json") and "abc123" in path:
            return httpx.Response(
                200, json={"Config": {"Labels": {monitor._PROJECT_LABEL: "wikihub"}}}
            )
        if path.endswith("/json"):
            return httpx.Response(
                200,
                json={
                    "Name": "/wikihub-web-1",
                    "Config": {"Labels": {monitor._PROJECT_LABEL: "wikihub"}},
                },
            )
        return httpx.Response(404)  # the logs

    async with docker(handler) as http:
        with pytest.raises(LookupError):
            await monitor.logs(http, "wikihub-web-1", 50)


def test_running_the_package_serves_the_controller_on_the_compose_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import runpy

    import uvicorn

    started: list[tuple[tuple, dict]] = []
    monkeypatch.setattr(uvicorn, "run", lambda *args, **kwargs: started.append((args, kwargs)))

    runpy.run_module("app.ollama_controller", run_name="__main__")

    assert started[0][0] == ("app.ollama_controller.app:app",)
    assert started[0][1]["port"] == 8765
