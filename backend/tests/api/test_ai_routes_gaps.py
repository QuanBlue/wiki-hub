"""AI routes whose answers depend on something else: the index, Ollama, a person's selection."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.models.user import User
from app.modules.ai import ollama
from app.modules.ai.service import AIService
from app.schemas.ai import ExplainResult


@pytest.mark.integration
@pytest.mark.asyncio
async def test_the_index_status_is_for_administrators_and_says_whether_semantic_search_is_on(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)

    response = await client.get("/api/v1/ai/search-index")

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) >= {"available", "enabled", "total", "indexed"}
    assert body["indexed"] <= body["total"]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_an_administrator_can_pause_and_resume_indexing(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)

    paused = await client.put("/api/v1/ai/search-index/pause", json={"paused": True})
    assert paused.status_code == 200, paused.text
    assert paused.json()["paused"] is True
    assert (await client.get("/api/v1/ai/search-index")).json()["paused"] is True

    resumed = await client.put("/api/v1/ai/search-index/pause", json={"paused": False})
    assert resumed.json()["paused"] is False


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_member_cannot_pause_indexing(
    client: AsyncClient, api_member_user: User, api_member_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_member_access_token)

    response = await client.put("/api/v1/ai/search-index/pause", json={"paused": True})

    assert response.status_code == 403


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_member_cannot_read_the_index_status(
    client: AsyncClient, api_member_user: User, api_member_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_member_access_token)

    assert (await client.get("/api/v1/ai/search-index")).status_code == 403


@pytest.mark.integration
@pytest.mark.asyncio
async def test_words_selected_in_a_chat_answer_are_explained_through_the_service(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    asked: list[str] = []

    async def explain_text(self: AIService, payload) -> ExplainResult:
        asked.append(payload.text)
        return ExplainResult(result="An explanation.")

    monkeypatch.setattr(AIService, "explain_text", explain_text)

    response = await client.post(
        "/api/v1/ai/explain", json={"text": "PromQL", "action": "explain", "lang": "vi"}
    )

    assert response.status_code == 200 and response.json()["result"] == "An explanation."
    assert asked == ["PromQL"]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_disabling_ollama_says_when_the_controller_cannot_do_it(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client.cookies.set("wikihub_access", api_access_token)

    async def refuse() -> None:
        raise ollama.OllamaError("The controller is not reachable.")

    monkeypatch.setattr(ollama, "disable", refuse)

    response = await client.post("/api/v1/ai/ollama/disable")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "service_unavailable"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_deleting_the_models_reports_what_blocked_it_or_the_new_state(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client.cookies.set("wikihub_access", api_access_token)

    async def blocked() -> None:
        raise ollama.OllamaError("Disable Ollama before deleting its models.")

    monkeypatch.setattr(ollama, "delete_models", blocked)
    refused = await client.delete("/api/v1/ai/ollama/models")
    assert refused.status_code == 400 and "Disable Ollama" in refused.text

    async def deleted() -> None:
        return None

    monkeypatch.setattr(ollama, "delete_models", deleted)

    async def idle() -> ollama.Progress:
        return ollama.Progress()

    async def unreachable() -> dict:
        raise ollama.OllamaError("The Ollama controller is not running.")

    monkeypatch.setattr(ollama, "read_progress", idle)
    monkeypatch.setattr(ollama, "controller_status", unreachable)
    done = await client.delete("/api/v1/ai/ollama/models")
    assert done.status_code == 200
    assert done.json()["state"] == "controller_down"
