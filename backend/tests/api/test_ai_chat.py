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
FILES_URL = "/api/v1/ai/chat/files"


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

    async def rewrite(
        config, messages, *, max_tokens: int = 2000, temperature: float = 0.2
    ) -> ChatReply:
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
        {"messages": [{"role": "user", "content": "x" * 4001}]},
        # At most three files attached in the chat.
        {
            "messages": [{"role": "user", "content": "hello"}],
            "file_ids": [str(uuid.uuid4()) for _ in range(4)],
        },
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
async def test_a_file_attached_in_the_chat_is_read_and_answered_from(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    model: list[list[dict[str, str]]],
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    await _connect(client)

    unreadable = await client.post(
        FILES_URL, files={"file": ("photo.jpg", b"\xff\xd8\xff", "image/jpeg")}
    )
    assert unreadable.status_code == 400
    assert unreadable.json()["error"]["code"] == "unsupported_chat_file"
    read = await client.post(
        FILES_URL, files={"file": ("notes.txt", b"The meeting is on Friday.", "text/plain")}
    )
    assert read.status_code == 201, read.text
    attached = read.json()
    assert attached["filename"] == "notes.txt" and attached["chars"] > 0

    response = await client.post(
        URL,
        json={
            "messages": [{"role": "user", "content": "which day is the meeting?"}],
            "file_ids": [attached["id"]],
        },
    )

    assert response.status_code == 200, response.text
    assert "The meeting is on Friday." in model[-1][-1]["content"]
    expired = await client.post(
        URL,
        json={
            "messages": [{"role": "user", "content": "and now?"}],
            "file_ids": [str(uuid.uuid4())],
        },
    )
    assert expired.status_code == 400
    assert expired.json()["error"]["code"] == "chat_file_expired"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_chat_file_that_is_empty_too_large_or_without_ai_is_refused(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    model: list[list[dict[str, str]]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.modules.ai import chat_files

    client.cookies.set("wikihub_access", api_access_token)
    await _connect(client)

    empty = await client.post(FILES_URL, files={"file": ("a.txt", b"", "text/plain")})
    assert empty.status_code == 400
    assert empty.json()["error"]["code"] == "chat_file_empty"
    monkeypatch.setattr(chat_files, "MAX_CHAT_FILE_BYTES", 4)
    large = await client.post(FILES_URL, files={"file": ("a.txt", b"12345", "text/plain")})
    assert large.status_code == 413
    assert large.json()["error"]["code"] == "chat_file_too_large"

    await _no_connections(client)
    off = await client.post(FILES_URL, files={"file": ("a.txt", b"x", "text/plain")})
    assert off.status_code == 503


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_chat_file_needs_a_signed_in_user(client: AsyncClient) -> None:
    response = await client.post(FILES_URL, files={"file": ("a.txt", b"x", "text/plain")})

    assert response.status_code == 401


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


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_confirmed_plan_is_run_step_by_step_as_the_person(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def allow(key: str, rule: str) -> None:
        return None

    monkeypatch.setattr(chat_module.rate_limit, "enforce", allow)
    client.cookies.set("wikihub_access", api_access_token)
    key = f"P{uuid.uuid4().hex[:6]}".upper()

    response = await client.post(
        "/api/v1/ai/chat/execute",
        json={
            "lang": "en",
            "steps": [
                {"type": "create_space", "args": {"name": "Planned", "key": key}},
                {"type": "favorite_space", "args": {"space": "$1"}},
            ],
        },
    )

    assert response.status_code == 200, response.text
    events = events_of(response.text)
    assert [name for name, _ in events] == ["step", "step", "done"]
    assert all(data["ok"] for name, data in events if name == "step")
    assert events[-1][1]["ok"] is True
