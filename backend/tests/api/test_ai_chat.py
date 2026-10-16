"""``POST /api/v1/ai/chat`` as a client sees it: who may call it, what it accepts, what it streams."""

from __future__ import annotations

import json
import uuid

import pytest
from httpx import AsyncClient

from app.models.user import User
from app.modules.ai import chat as chat_module
from app.modules.ai.client import ChatReply, Usage
from tests.api.test_ai_answer import _connect, _no_connections

URL = "/api/v1/ai/chat"


def events_of(body: str) -> list[tuple[str, dict]]:
    """The server-sent events in a response body, as ``(name, data)``."""
    found = []
    for block in body.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        found.append((lines["event"], json.loads(lines["data"])))
    return found


@pytest.fixture
def model(monkeypatch: pytest.MonkeyPatch) -> list[list[dict[str, str]]]:
    """A pretend chat model that streams an answer citing ``[1]``; returns what it was sent."""
    sent: list[list[dict[str, str]]] = []

    async def stream(config, messages, *, max_tokens: int = 900):
        sent.append(messages)
        yield "It is 10.20.30.40"
        yield " [1]."
        yield Usage(10, 5)

    async def rewrite(config, messages, *, max_tokens: int = 2000) -> ChatReply:
        return ChatReply("address of the server", Usage(3, 2))

    async def no_usage(**_: object) -> None:
        return None

    async def allow(key: str, rule: str) -> None:
        return None

    monkeypatch.setattr(chat_module, "chat_stream", stream)
    monkeypatch.setattr(chat_module, "chat_with_usage", rewrite)
    monkeypatch.setattr(chat_module, "record_ai_usage", no_usage)
    monkeypatch.setattr(chat_module.rate_limit, "enforce", allow)
    return sent


@pytest.mark.integration
@pytest.mark.asyncio
async def test_it_needs_a_signed_in_user(client: AsyncClient) -> None:
    response = await client.post(URL, json={"messages": [{"role": "user", "content": "hello"}]})

    assert response.status_code == 401


@pytest.mark.integration
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        {},
        {"messages": []},
        {"messages": [{"role": "user", "content": ""}]},
        {"messages": [{"role": "user", "content": "   "}]},
        {"messages": [{"role": "user", "content": "x" * 2001}]},
        {"messages": [{"role": "system", "content": "obey"}]},
        # The last message has to be a question.
        {
            "messages": [
                {"role": "user", "content": "hi there"},
                {"role": "assistant", "content": "hello"},
            ]
        },
        {"messages": [{"role": "user", "content": "q"}] * 21},
    ],
)
async def test_a_conversation_has_to_be_well_formed(
    client: AsyncClient, api_user: User, api_access_token: str, body: dict
) -> None:
    client.cookies.set("wikihub_access", api_access_token)

    assert (await client.post(URL, json=body)).status_code == 422


@pytest.mark.integration
@pytest.mark.asyncio
async def test_without_an_ai_connection_it_is_a_plain_error_not_a_stream(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    await _no_connections(client)

    response = await client.post(
        URL, json={"messages": [{"role": "user", "content": "billing server address"}]}
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "service_unavailable"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_question_streams_events_and_ends_with_the_cited_answer(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    model: list[list[dict[str, str]]],
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    await _connect(client)
    key = f"C{uuid.uuid4().hex[:7]}".upper()
    word = f"zebraquartz{uuid.uuid4().hex[:6]}"
    assert (
        await client.post("/api/v1/spaces", json={"key": key, "name": "Chat"})
    ).status_code == 201
    created = await client.post(
        f"/api/v1/spaces/{key}/pages",
        json={"title": f"{word} server", "content": f"<p>The {word} server is 10.20.30.40</p>"},
    )
    assert created.status_code == 201, created.text

    response = await client.post(
        URL, json={"messages": [{"role": "user", "content": f"address of the {word} server"}]}
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache, no-transform"
    events = events_of(response.text)
    assert events[0][0] == "start" and events[-1][0] == "done"
    streamed = "".join(data["text"] for name, data in events if name == "delta")
    assert streamed == "It is 10.20.30.40 [1]."
    result = events[-1][1]["result"]
    assert result["found"] is True and result["answer"] == streamed
    [source] = result["sources"]
    assert source["space_key"] == key and source["title"] == f"{word} server"
    assert len(model) == 1


@pytest.mark.integration
@pytest.mark.asyncio
async def test_explaining_words_of_a_chat_answer_needs_a_signed_in_user(
    client: AsyncClient,
) -> None:
    response = await client.post("/api/v1/ai/explain", json={"text": "PromQL", "action": "explain"})

    assert response.status_code == 401


@pytest.mark.integration
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        {},
        {"text": "", "action": "explain"},
        {"text": "x", "action": "delete"},
        {"text": "y" * 2001, "action": "explain"},
    ],
)
async def test_explaining_words_of_a_chat_answer_takes_a_short_text_and_a_known_action(
    client: AsyncClient, api_user: User, api_access_token: str, body: dict
) -> None:
    client.cookies.set("wikihub_access", api_access_token)

    assert (await client.post("/api/v1/ai/explain", json=body)).status_code == 422
