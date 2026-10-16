"""Administration > Server: only administrators, and only what the controller says."""

from __future__ import annotations

import httpx
import pytest
from httpx import AsyncClient

from app.api.v1 import admin_monitor
from app.models.user import User

pytestmark = pytest.mark.integration

MONITOR = "/api/v1/admin/monitor"

HOST = {
    "docker_ok": True,
    "cpus": 12,
    "load": [1.5, 2.5, 3.5],
    "memory_total": 1000,
    "memory_used": 400,
    "memory_available": 600,
    "disk_total": 10_000,
    "disk_used": 2_000,
    "uptime_seconds": 3600.0,
    "docker_version": "27.0.1",
    "containers_total": 2,
    "containers_running": 1,
    "images": 3,
}
CONTAINERS = {
    "docker_ok": True,
    "containers": [
        {
            "id": "abc123abc123",
            "name": "wikihub-backend-1",
            "image": "wikihub-backend",
            "state": "running",
            "status": "Up 1 hour (healthy)",
            "project": "wikihub",
            "service": "backend",
            "uptime_seconds": 3600.0,
            "restarts": 0,
            "health": "healthy",
            "cpu_percent": 3.5,
            "memory_bytes": 150,
            "memory_limit": 1000,
        }
    ],
}


def fake_controller(routes: dict[str, httpx.Response]):
    def handler(request: httpx.Request) -> httpx.Response:
        for path, response in routes.items():
            if request.url.path == path:
                return response
        return httpx.Response(404)

    def client() -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=httpx.MockTransport(handler), base_url="http://controller"
        )

    return client


async def test_an_administrator_sees_the_host_and_every_container(
    client: AsyncClient, api_user: User, api_access_token: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    monkeypatch.setattr(
        admin_monitor,
        "controller_client",
        fake_controller(
            {
                "/host": httpx.Response(200, json=HOST),
                "/containers": httpx.Response(200, json=CONTAINERS),
            }
        ),
    )

    body = (await client.get(MONITOR)).json()

    assert body["docker_ok"] is True
    assert body["host"]["cpus"] == 12 and body["host"]["load"] == [1.5, 2.5, 3.5]
    assert body["host"]["memory_used"] == 400 and body["host"]["docker_version"] == "27.0.1"
    (container,) = body["containers"]
    assert (container["name"], container["id"], container["state"]) == (
        "wikihub-backend-1",
        "abc123abc123",
        "running",
    )
    assert container["cpu_percent"] == 3.5 and container["memory_bytes"] == 150
    assert container["uptime_seconds"] == 3600.0 and container["health"] == "healthy"


async def test_a_member_cannot_see_the_server_or_its_logs(
    client: AsyncClient, api_member_user: User, api_member_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_member_access_token)

    assert (await client.get(MONITOR)).status_code == 403
    assert (await client.get(f"{MONITOR}/containers/web/logs")).status_code == 403


async def test_nobody_signed_in_gets_nothing(client: AsyncClient) -> None:
    client.cookies.clear()

    assert (await client.get(MONITOR)).status_code == 401
    assert (await client.get(f"{MONITOR}/containers/web/logs")).status_code == 401


async def test_a_missing_controller_is_explained(
    client: AsyncClient, api_user: User, api_access_token: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    client.cookies.set("wikihub_access", api_access_token)

    def down() -> httpx.AsyncClient:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no route")

        return httpx.AsyncClient(
            transport=httpx.MockTransport(handler), base_url="http://controller"
        )

    monkeypatch.setattr(admin_monitor, "controller_client", down)

    response = await client.get(MONITOR)

    assert response.status_code == 503 and "server monitor is not running" in response.text


async def test_docker_being_unreachable_shows_the_host_but_no_containers(
    client: AsyncClient, api_user: User, api_access_token: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    monkeypatch.setattr(
        admin_monitor,
        "controller_client",
        fake_controller(
            {
                "/host": httpx.Response(200, json={"docker_ok": False, "cpus": 4}),
                "/containers": httpx.Response(200, json={"docker_ok": False, "containers": []}),
            }
        ),
    )

    body = (await client.get(MONITOR)).json()

    assert body["docker_ok"] is False and body["host"]["cpus"] == 4 and body["containers"] == []


async def test_container_logs_come_back_and_the_tail_is_bounded(
    client: AsyncClient, api_user: User, api_access_token: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(f"{request.url.path}?tail={request.url.params['tail']}")
        return httpx.Response(200, json={"lines": ["2026-10-15T04:54Z started", "ready"]})

    monkeypatch.setattr(
        admin_monitor,
        "controller_client",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://c"),
    )

    ok = await client.get(f"{MONITOR}/containers/wikihub-backend-1/logs?tail=50")
    assert ok.json() == {"lines": ["2026-10-15T04:54Z started", "ready"]}
    assert asked == ["/containers/wikihub-backend-1/logs?tail=50"]

    # Out-of-range tails are refused before anything is asked of Docker.
    assert (await client.get(f"{MONITOR}/containers/web/logs?tail=0")).status_code == 422
    assert (await client.get(f"{MONITOR}/containers/web/logs?tail=100000")).status_code == 422
    assert len(asked) == 1


async def test_logs_of_an_unknown_container_are_a_404_and_a_controller_error_is_a_503(
    client: AsyncClient, api_user: User, api_access_token: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    monkeypatch.setattr(
        admin_monitor,
        "controller_client",
        fake_controller({"/containers/ghost/logs": httpx.Response(404, json={"detail": "x"})}),
    )
    assert (await client.get(f"{MONITOR}/containers/ghost/logs")).status_code == 404

    monkeypatch.setattr(
        admin_monitor,
        "controller_client",
        fake_controller({"/containers/web/logs": httpx.Response(502, json={"detail": "x"})}),
    )
    assert (await client.get(f"{MONITOR}/containers/web/logs")).status_code == 503
