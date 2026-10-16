"""Explaining or translating words a reader selected on a page."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.modules.ai import service as service_module
from app.modules.ai.config import AIConfig
from app.modules.ai.service import AIService
from app.modules.ai.skills import selection_system_prompt
from app.schemas.ai import ExplainRequest
from tests.unit.ai_fakes import fake_chat


class FakeRedis:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.data.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.data[key] = value


class Harness:
    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.redis = FakeRedis()
        self.messages: list[list[dict[str, str]]] = []
        self.charges = 0
        page = SimpleNamespace(
            id=uuid.uuid4(), title="Runbook", updated_at=datetime(2026, 10, 13, tzinfo=UTC)
        )

        async def config(_session: object) -> AIConfig:
            return AIConfig(True, "http://gateway.test/v1", "k", "m")

        async def chat(_c: AIConfig, messages: list[dict[str, str]], **_kw: object) -> str:
            self.messages.append(messages)
            return "An answer."

        async def instructions(_session: object, action: str) -> str:
            return f"Custom {action} instructions."

        async def enforce(_key: str, _rule: str) -> None:
            self.charges += 1

        async def visible(_self: object, _key: str, _slug: str) -> SimpleNamespace:
            return page

        monkeypatch.setattr(service_module, "get_redis", lambda: self.redis)
        monkeypatch.setattr(service_module, "load_config", config)
        fake_chat(monkeypatch, chat)
        monkeypatch.setattr(service_module, "selection_instructions", instructions)
        monkeypatch.setattr(service_module.rate_limit, "enforce", enforce)
        monkeypatch.setattr(AIService, "_visible_page", visible)
        self.service = AIService.__new__(AIService)
        self.service.session = None  # type: ignore[assignment]
        self.service.user = SimpleNamespace(id="u1")  # type: ignore[assignment]

    async def ask(self, **kwargs: object):
        body = {"text": "PromQL", "action": "explain", "lang": "vi", **kwargs}
        return await self.service.explain_selection("ENG", "runbook", ExplainRequest(**body))  # type: ignore[arg-type]


@pytest.fixture
def harness(monkeypatch: pytest.MonkeyPatch) -> Harness:
    return Harness(monkeypatch)


def test_the_two_actions_ask_for_different_things_in_the_readers_language() -> None:
    explain = selection_system_prompt("explain", "vi")
    translate = selection_system_prompt("translate", "vi")

    assert "Explain the selected text" in explain and "Vietnamese" in explain
    assert "Translate the selected text into Vietnamese" in translate
    assert "untrusted" in explain
    assert "English" in selection_system_prompt("explain", "xx")  # unknown -> English


async def test_a_selection_is_sent_with_its_page_and_surroundings(harness: Harness) -> None:
    result = await harness.ask(context="Query it with PromQL and draw dashboards.")

    assert (result.result, result.cached) == ("An answer.", False)
    sent = harness.messages[0][1]["content"]
    assert "<page_title>Runbook</page_title>" in sent
    assert "<surrounding>\nQuery it with PromQL and draw dashboards.\n</surrounding>" in sent
    assert "<selected>\nPromQL\n</selected>" in sent
    assert harness.charges == 1


async def test_asking_again_is_free_and_each_action_is_its_own_answer(harness: Harness) -> None:
    await harness.ask()
    again = await harness.ask()
    await harness.ask(action="translate")

    assert again.cached is True
    assert len(harness.messages) == 2  # explain once, translate once
    assert harness.charges == 2


def test_the_built_in_instructions_are_used_unless_an_administrator_writes_their_own() -> None:
    assert "at most 100 words" in selection_system_prompt("explain", "vi")
    assert "Translate the selected text faithfully" in selection_system_prompt("translate", "vi")
    custom = selection_system_prompt("explain", "vi", "Explain like I am five.")
    assert custom.startswith("Explain like I am five.")
    assert "Write the explanation in Vietnamese." in custom


async def test_words_selected_in_a_chat_answer_are_explained_without_any_page(
    harness: Harness,
) -> None:
    request = ExplainRequest(
        text="Debian/Ubuntu",
        context="Install on Debian/Ubuntu with apt.",
        action="explain",
        lang="vi",
    )

    result = await harness.service.explain_text(request)

    assert (result.result, result.cached) == ("An answer.", False)
    sent = harness.messages[0][1]["content"]
    assert "<page_title>" not in sent
    assert "<surrounding>\nInstall on Debian/Ubuntu with apt.\n</surrounding>" in sent
    assert "<selected>\nDebian/Ubuntu\n</selected>" in sent


async def test_an_answer_to_a_chat_selection_is_saved_for_that_person_only(
    harness: Harness,
) -> None:
    request = ExplainRequest(text="PromQL", action="explain", lang="vi")

    await harness.service.explain_text(request)
    again = await harness.service.explain_text(request)
    harness.service.user = SimpleNamespace(id="u2")  # type: ignore[assignment]
    other = await harness.service.explain_text(request)

    assert again.cached is True and other.cached is False
    assert len(harness.messages) == 2


async def test_secrets_in_a_chat_selection_are_not_sent_on(harness: Harness) -> None:
    request = ExplainRequest(
        text="login with password: hunter2",
        context="use admin / password: hunter2 on the host",
        action="translate",
        lang="en",
    )

    await harness.service.explain_text(request)

    assert "hunter2" not in harness.messages[0][1]["content"]
