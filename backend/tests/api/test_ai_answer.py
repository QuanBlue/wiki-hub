"""``POST /api/v1/ai/answer`` as a client sees it: who may call it, what it accepts, what it says."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

from app.models.user import User
from app.modules.ai import answer as answer_module
from app.modules.ai.client import ChatReply, Usage

URL = "/api/v1/ai/answer"
CONNECTIONS = "/api/v1/ai/connections"


async def _no_connections(client: AsyncClient) -> None:
    for item in (await client.get(CONNECTIONS)).json()["items"]:
        await client.delete(f"{CONNECTIONS}/{item['id']}")


async def _connect(client: AsyncClient) -> None:
    await _no_connections(client)
    created = await client.post(
        CONNECTIONS,
        json={
            "name": "answer-test",
            "base_url": "http://gateway.test/v1/",
            "model": "m",
            "api_key": "sk-adc2cecc0ebee434-c1c72e-c056297a",
        },
    )
    assert created.status_code == 201
    # Keyword retrieval only: no embedding model to call, whatever an earlier test left behind.
    off = await client.put("/api/v1/ai/embedding", json={"source": "provider", "model": ""})
    assert off.status_code == 200, off.text


@pytest.fixture
def model(monkeypatch: pytest.MonkeyPatch) -> list[list[dict[str, str]]]:
    """A pretend chat model that answers ``[1]`` to everything; returns what it was sent."""
    sent: list[list[dict[str, str]]] = []

    async def fake(config, messages, *, max_tokens: int = 2000) -> ChatReply:
        sent.append(messages)
        return ChatReply("It is 10.20.30.40 [1].", Usage(10, 5))

    async def no_usage(**_: object) -> None:
        return None

    class Memory:
        """A Redis that lives in this test: the answer cache and nothing else."""

        def __init__(self) -> None:
            self.data: dict[str, str] = {}

        async def get(self, key: str) -> str | None:
            return self.data.get(key)

        async def set(self, key: str, value: str, **_: object) -> None:
            self.data[key] = value

    async def allow(key: str, rule: str) -> None:
        return None

    memory = Memory()
    monkeypatch.setattr(answer_module, "chat_with_usage", fake)
    monkeypatch.setattr(answer_module, "record_ai_usage", no_usage)
    monkeypatch.setattr(answer_module, "get_redis", lambda: memory)
    monkeypatch.setattr(answer_module.rate_limit, "enforce", allow)
    return sent


@pytest.mark.integration
@pytest.mark.asyncio
async def test_it_needs_a_signed_in_user(client: AsyncClient) -> None:
    response = await client.post(URL, json={"query": "anything at all"})

    assert response.status_code == 401


@pytest.mark.integration
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [{}, {"query": ""}, {"query": " "}, {"query": "a"}, {"query": "x" * 301}, {"query": 5}],
)
async def test_a_question_must_be_two_to_three_hundred_characters(
    client: AsyncClient, api_user: User, api_access_token: str, body: dict
) -> None:
    client.cookies.set("wikihub_access", api_access_token)

    response = await client.post(URL, json=body)

    assert response.status_code == 422


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_question_is_a_post_body_so_it_stays_out_of_access_logs(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)

    assert (await client.get(URL, params={"query": "billing server"})).status_code == 405


@pytest.mark.integration
@pytest.mark.asyncio
async def test_without_an_ai_connection_it_says_the_assistant_is_not_enabled(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    await _no_connections(client)

    response = await client.post(URL, json={"query": "billing server address"})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "service_unavailable"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_question_is_answered_from_a_page_with_a_link_to_it(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    model: list[list[dict[str, str]]],
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    await _connect(client)
    key = f"A{uuid.uuid4().hex[:7]}".upper()
    word = f"zebraquartz{uuid.uuid4().hex[:6]}"
    assert (
        await client.post("/api/v1/spaces", json={"key": key, "name": "Answers"})
    ).status_code == 201
    created = await client.post(
        f"/api/v1/spaces/{key}/pages",
        json={"title": f"{word} server", "content": f"<p>The {word} server is 10.20.30.40</p>"},
    )
    assert created.status_code == 201, created.text

    response = await client.post(URL, json={"query": f"address of the {word} server"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["found"] is True and body["cached"] is False
    assert body["answer"] == "It is 10.20.30.40 [1]."
    [source] = body["sources"]
    assert source["n"] == 1 and source["space_key"] == key and source["slug"]
    assert source["title"] == f"{word} server" and "10.20.30.40" in source["excerpt"]
    assert len(model) == 1

    again = await client.post(URL, json={"query": f"address of the {word} server"})
    assert again.json()["cached"] is True and len(model) == 1


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_question_nothing_matches_says_so_without_calling_the_model(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    model: list[list[dict[str, str]]],
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    await _connect(client)

    response = await client.post(
        URL, json={"query": f"qqqq{uuid.uuid4().hex} wwww{uuid.uuid4().hex}"}
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["found"], body["reason"], body["sources"], body["related"]) == (
        False,
        "no_match",
        [],
        [],
    )
    assert model == []
