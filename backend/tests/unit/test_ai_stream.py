"""The streamed reply of an OpenAI-compatible gateway, as the client reads it."""

from __future__ import annotations

import json

import httpx
import pytest

from app.core.exceptions import ServiceUnavailableError
from app.modules.ai import client
from app.modules.ai.client import Usage, chat_stream, parse_stream_line
from app.modules.ai.config import AIConfig

CONFIG = AIConfig(True, "http://gateway.test/v1/", "k", "m")
MESSAGES = [{"role": "user", "content": "hi"}]


def _gateway(monkeypatch: pytest.MonkeyPatch, handler) -> None:
    real = httpx.AsyncClient
    monkeypatch.setattr(
        client.httpx,
        "AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(handler), **kw),
    )
    monkeypatch.setattr(client, "_BACKOFF", (0.0, 0.0))


def _chunk(text: str | None = None, **extra: object) -> str:
    delta = {} if text is None else {"content": text}
    return "data: " + json.dumps({"choices": [{"delta": delta}], **extra}) + "\n\n"


def _sse(*parts: str) -> httpx.Response:
    return httpx.Response(
        200, headers={"content-type": "text/event-stream"}, content="".join(parts).encode()
    )


async def _read(config: AIConfig = CONFIG) -> list[str | Usage]:
    return [piece async for piece in chat_stream(config, MESSAGES)]


# ---------------------------------------------------------------- one line


def test_a_data_line_gives_its_text() -> None:
    assert parse_stream_line(_chunk("Hel").strip()) == ("Hel", None, False)


def test_the_done_marker_finishes_the_stream() -> None:
    assert parse_stream_line("data: [DONE]") == ("", None, True)


@pytest.mark.parametrize(
    "line",
    ["", ": keep-alive", "event: ping", "data: not json", "data: [1, 2]", "data: {}"],
)
def test_anything_else_is_skipped_rather_than_breaking_the_answer(line: str) -> None:
    assert parse_stream_line(line) == ("", None, False)


def test_a_reasoning_models_thinking_is_not_part_of_the_answer() -> None:
    line = 'data: {"choices": [{"delta": {"reasoning_content": "hmm", "content": null}}]}'
    assert parse_stream_line(line) == ("", None, False)


def test_the_usage_chunk_has_no_choices_and_is_still_read() -> None:
    line = 'data: {"choices": [], "usage": {"prompt_tokens": 7, "completion_tokens": 3}}'
    assert parse_stream_line(line) == ("", Usage(7, 3), False)


# ---------------------------------------------------------------- the whole stream


async def test_text_arrives_in_pieces_and_then_the_usage(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        usage = {"usage": {"prompt_tokens": 12, "completion_tokens": 4}}
        return _sse(
            _chunk("Hello"),
            _chunk(None),
            _chunk(" there"),
            "data: " + json.dumps({"choices": [], **usage}) + "\n\n",
            "data: [DONE]\n\n",
        )

    _gateway(monkeypatch, handler)

    assert await _read() == ["Hello", " there", Usage(12, 4)]
    assert seen[0]["stream"] is True and seen[0]["stream_options"] == {"include_usage": True}


async def test_a_gateway_that_does_not_stream_gives_the_whole_reply_at_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _gateway(
        monkeypatch,
        lambda request: httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "All of it"}}],
                "usage": {"prompt_tokens": 2, "completion_tokens": 3},
            },
        ),
    )

    assert await _read() == ["All of it", Usage(2, 3)]


async def test_an_option_the_gateway_rejects_is_dropped_and_the_request_repeated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        bodies.append(body)
        if "stream_options" in body or "reasoning_effort" in body:
            return httpx.Response(400, json={"error": "unknown parameter"})
        return _sse(_chunk("fine"), "data: [DONE]\n\n")

    _gateway(monkeypatch, handler)

    assert await _read() == ["fine"]
    assert "reasoning_effort" not in bodies[-1] and "stream_options" not in bodies[-1]


async def test_a_busy_gateway_is_retried_before_anything_is_shown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) < 3:
            return httpx.Response(504)
        return _sse(_chunk("ok"), "data: [DONE]\n\n")

    _gateway(monkeypatch, handler)

    assert await _read() == ["ok"] and len(calls) == 3


async def test_a_gateway_that_keeps_failing_ends_in_an_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _gateway(monkeypatch, lambda request: httpx.Response(503))

    with pytest.raises(ServiceUnavailableError):
        await _read()


async def test_a_stream_with_no_text_is_an_error_not_an_empty_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _gateway(monkeypatch, lambda request: _sse(_chunk(None), "data: [DONE]\n\n"))

    with pytest.raises(ServiceUnavailableError):
        await _read()


async def test_a_disabled_assistant_is_refused_without_a_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no request should be made")

    _gateway(monkeypatch, handler)

    with pytest.raises(ServiceUnavailableError):
        await _read(AIConfig(False, "http://gateway.test/v1/", "k", "m"))


async def test_a_dropped_connection_is_retried_and_then_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            raise httpx.ConnectError("refused")
        return _sse(_chunk("back"), "data: [DONE]\n\n")

    _gateway(monkeypatch, handler)

    assert await _read() == ["back"] and len(calls) == 2


async def test_a_gateway_that_stays_unreachable_ends_in_an_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.RemoteProtocolError("closed")

    _gateway(monkeypatch, refuse)

    with pytest.raises(ServiceUnavailableError):
        await _read()


async def test_a_reply_that_is_not_what_a_gateway_sends_is_an_error_not_a_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(
            200, headers={"content-type": "application/json"}, content=b'{"choices": []}'
        )

    _gateway(monkeypatch, handler)

    with pytest.raises(ServiceUnavailableError):
        await _read()
    assert len(calls) == 1
