"""The Ollama module against pretend HTTP servers: what it asks the controller and Ollama, and
what it makes of their answers - including the ways they fail."""

from __future__ import annotations

import json

import httpx
import pytest

from app.modules.ai import ollama
from app.modules.ai.ollama import OllamaError


class FakeRedis:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.data.get(key)

    async def set(self, key: str, value: str, nx: bool = False, ex: int | None = None) -> bool:
        if nx and key in self.data:
            return False
        self.data[key] = value
        return True

    async def delete(self, key: str) -> None:
        self.data.pop(key, None)


@pytest.fixture
def redis(monkeypatch: pytest.MonkeyPatch) -> FakeRedis:
    fake = FakeRedis()
    monkeypatch.setattr(ollama, "get_redis", lambda: fake)
    return fake


def serve(monkeypatch: pytest.MonkeyPatch, handler) -> None:
    """Every HTTP client in the module talks to ``handler`` instead of the network."""
    real = httpx.AsyncClient
    monkeypatch.setattr(
        ollama.httpx,
        "AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(handler), **kw),
    )


def lines(*events: object) -> bytes:
    return "".join(
        (event if isinstance(event, str) else json.dumps(event)) + "\n" for event in events
    ).encode()


# ---------------------------------------------------------------- progress in Redis


async def test_a_progress_record_that_cannot_be_read_is_an_idle_one(redis: FakeRedis) -> None:
    redis.data["ollama:install"] = "{not json"

    assert (await ollama.read_progress()).state == "idle"


# ---------------------------------------------------------------- the controller


async def test_the_controller_client_speaks_with_the_shared_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"docker_ok": True})

    serve(monkeypatch, handler)

    assert await ollama.controller_status() == {"docker_ok": True}
    assert seen[0].url.path == "/status" and ollama.HEADER in seen[0].headers


async def test_a_controller_that_rejects_the_token_is_named_as_such(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    serve(monkeypatch, lambda request: httpx.Response(401))

    with pytest.raises(OllamaError, match="rejected the token"):
        await ollama.controller_status()


async def test_a_controller_that_is_not_running_is_explained(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    serve(monkeypatch, refuse)

    with pytest.raises(OllamaError, match="controller is not running"):
        await ollama.controller_status()


async def test_a_command_to_the_controller_is_sent_with_its_options(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={})

    serve(monkeypatch, handler)

    await ollama._controller_post("/start", json_body={"memory_mb": 2048})

    assert seen[0].method == "POST" and json.loads(seen[0].content) == {"memory_mb": 2048}


@pytest.mark.parametrize(
    ("response", "expected"),
    [
        (httpx.Response(409, json={"detail": "Already running."}), "Already running."),
        (httpx.Response(500, content=b"<html>oops</html>"), "answered HTTP 500"),
        (httpx.Response(502, json={}), "answered HTTP 502"),
    ],
)
async def test_a_command_the_controller_refuses_says_why(
    monkeypatch: pytest.MonkeyPatch, response: httpx.Response, expected: str
) -> None:
    serve(monkeypatch, lambda request: response)

    with pytest.raises(OllamaError, match=expected):
        await ollama._controller_post("/stop")


async def test_a_command_that_cannot_reach_the_controller_fails_plainly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    serve(monkeypatch, refuse)

    with pytest.raises(OllamaError, match="not reachable"):
        await ollama._controller_post("/stop")


async def test_the_image_download_streams_its_progress(monkeypatch: pytest.MonkeyPatch) -> None:
    body = lines({"percent": 10, "status": "pulling"}, "", {"percent": 100, "status": "done"})
    serve(monkeypatch, lambda request: httpx.Response(200, content=body))

    events = [event async for event in ollama.pull_image()]

    assert [e["percent"] for e in events] == [10, 100]


async def test_an_image_download_the_controller_refuses_is_an_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    serve(monkeypatch, lambda request: httpx.Response(503))

    with pytest.raises(OllamaError, match="HTTP 503"):
        _ = [event async for event in ollama.pull_image()]


async def test_an_error_event_in_the_image_download_is_raised(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    serve(monkeypatch, lambda request: httpx.Response(200, content=lines({"error": "no space"})))

    with pytest.raises(OllamaError, match="no space"):
        _ = [event async for event in ollama.pull_image()]


async def test_losing_the_controller_during_the_image_download_is_reported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def drop(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadError("reset")

    serve(monkeypatch, drop)

    with pytest.raises(OllamaError, match="Lost contact with the Ollama controller"):
        _ = [event async for event in ollama.pull_image()]


# ---------------------------------------------------------------- ollama itself


async def test_the_models_ollama_holds_are_listed(monkeypatch: pytest.MonkeyPatch) -> None:
    serve(
        monkeypatch,
        lambda request: httpx.Response(200, json={"models": [{"name": "bge-m3:latest"}]}),
    )

    assert await ollama.installed_models() == ["bge-m3:latest"]


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(500),
        httpx.Response(200, content=b"nope"),
        httpx.Response(200, json={"models": [{}]}),
    ],
)
async def test_ollama_that_does_not_answer_properly_is_an_error(
    monkeypatch: pytest.MonkeyPatch, response: httpx.Response
) -> None:
    serve(monkeypatch, lambda request: response)

    with pytest.raises(OllamaError, match="not answering"):
        await ollama.installed_models()


async def test_a_model_download_reports_a_bar_that_never_runs_backwards(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = lines(
        {"status": "pulling manifest"},
        {"status": "pulling a", "digest": "a", "total": 100, "completed": 50},
        "",
        {"status": "pulling b", "digest": "b", "total": 100, "completed": 0},
        {"status": "pulling a", "digest": "a", "total": 100, "completed": 100},
        {"status": "success"},
    )
    serve(monkeypatch, lambda request: httpx.Response(200, content=body))

    events = [event async for event in ollama.pull_model("bge-m3")]

    percents = [e["percent"] for e in events]
    assert percents == sorted(percents) and percents[-1] == 50
    assert events[0]["total"] == 0 and events[-1]["current"] == 100


async def test_a_model_download_ollama_refuses_says_what_it_said(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    serve(monkeypatch, lambda request: httpx.Response(404, content=b"model not found"))

    with pytest.raises(OllamaError, match="refused to download bge-m3: model not found"):
        _ = [event async for event in ollama.pull_model("bge-m3")]


async def test_an_error_event_in_a_model_download_is_raised(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    serve(monkeypatch, lambda request: httpx.Response(200, content=lines({"error": "disk full"})))

    with pytest.raises(OllamaError, match="disk full"):
        _ = [event async for event in ollama.pull_model("bge-m3")]


async def test_losing_ollama_during_a_model_download_is_reported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def drop(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadError("reset")

    serve(monkeypatch, drop)

    with pytest.raises(OllamaError, match="Lost contact with Ollama"):
        _ = [event async for event in ollama.pull_model("bge-m3")]


# ---------------------------------------------------------------- waiting for it to come up


async def test_waiting_for_ollama_keeps_trying_until_it_answers(
    monkeypatch: pytest.MonkeyPatch, redis: FakeRedis
) -> None:
    attempts = []

    async def models() -> list[str]:
        attempts.append(1)
        if len(attempts) < 3:
            raise OllamaError("not yet")
        return []

    async def no_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(ollama, "installed_models", models)
    monkeypatch.setattr(ollama.asyncio, "sleep", no_sleep)

    await ollama.wait_until_up(wait_seconds=30)

    assert len(attempts) == 3


async def test_waiting_for_ollama_stops_when_the_install_is_cancelled(
    monkeypatch: pytest.MonkeyPatch, redis: FakeRedis
) -> None:
    async def never_up() -> list[str]:
        raise OllamaError("not yet")

    async def cancel_while_waiting(_seconds: float) -> None:
        redis.data["ollama:install:cancel"] = "1"

    monkeypatch.setattr(ollama, "installed_models", never_up)
    monkeypatch.setattr(ollama.asyncio, "sleep", cancel_while_waiting)

    with pytest.raises(ollama.Cancelled):
        await ollama.wait_until_up(wait_seconds=30)


async def test_waiting_for_ollama_gives_up_after_the_time_allowed(
    monkeypatch: pytest.MonkeyPatch, redis: FakeRedis
) -> None:
    async def never_up() -> list[str]:
        raise OllamaError("not yet")

    async def no_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(ollama, "installed_models", never_up)
    monkeypatch.setattr(ollama.asyncio, "sleep", no_sleep)

    with pytest.raises(OllamaError, match="did not answer in time"):
        await ollama.wait_until_up(wait_seconds=0.01)


# ---------------------------------------------------------------- when the install itself breaks


async def test_an_install_that_crashes_leaves_an_error_for_the_card_and_still_raises(
    monkeypatch: pytest.MonkeyPatch, redis: FakeRedis
) -> None:
    async def boom() -> dict:
        raise RuntimeError("bug")

    monkeypatch.setattr(ollama, "controller_status", boom)

    with pytest.raises(RuntimeError):
        await ollama.install("bge-m3")

    saved = json.loads(redis.data["ollama:install"])
    assert saved["state"] == "error" and "RuntimeError" in saved["error"]
    assert "ollama:install:lock" not in redis.data


# ---------------------------------------------------------------- the card while Ollama starts


async def test_the_card_says_starting_while_a_running_container_does_not_answer_yet(
    monkeypatch: pytest.MonkeyPatch, redis: FakeRedis
) -> None:
    async def status() -> dict:
        return {"docker_ok": True, "container": "running", "image_present": True}

    async def not_answering() -> list[str]:
        raise OllamaError("not yet")

    monkeypatch.setattr(ollama, "controller_status", status)
    monkeypatch.setattr(ollama, "installed_models", not_answering)

    assert (await ollama.describe())["state"] == "starting"
