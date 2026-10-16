"""Switching a summary's language translates the saved summary; only a refresh
goes back to the page. Run against a fake Redis and a fake model."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.modules.ai import service as service_module
from app.modules.ai.config import AIConfig
from app.modules.ai.service import AIService
from tests.unit.ai_fakes import fake_chat

PAGE_TEXT = "Run the restart script on the host and then check the queue. " * 6


class FakeRedis:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.data.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.data[key] = value

    async def delete(self, *keys: str) -> None:
        for key in keys:
            self.data.pop(key, None)


class Harness:
    def __init__(self, monkeypatch: pytest.MonkeyPatch, content: str = PAGE_TEXT) -> None:
        self.redis = FakeRedis()
        self.calls: list[dict[str, str]] = []  # one entry per model call
        self.charges = 0
        page = SimpleNamespace(
            id=uuid.uuid4(),
            title="Runbook",
            content=f"<p>{content}</p>",
            updated_at=datetime(2026, 10, 13, tzinfo=UTC),
        )

        async def config(_session: object) -> AIConfig:
            return AIConfig(True, "http://gateway.test/v1", "k", "m")

        async def instructions(_session: object) -> str:
            return "Summarise."

        async def chat(_config: AIConfig, messages: list[dict[str, str]], **_kw: object) -> str:
            system, user = messages[0]["content"], messages[1]["content"]
            kind = "translate" if system.startswith("Translate the Markdown") else "summary"
            self.calls.append({"kind": kind, "user": user, "system": system})
            return "- A summary." if kind == "summary" else f"[translated] {user}"

        async def enforce(_key: str, _rule: str) -> None:
            self.charges += 1

        monkeypatch.setattr(service_module, "get_redis", lambda: self.redis)
        monkeypatch.setattr(service_module, "load_config", config)
        monkeypatch.setattr(service_module, "summary_instructions", instructions)
        fake_chat(monkeypatch, chat)
        monkeypatch.setattr(service_module.rate_limit, "enforce", enforce)

        async def visible(_self: object, _key: str, _slug: str) -> SimpleNamespace:
            return page

        async def attachments(_self: object, _page: object) -> list[object]:
            return []

        monkeypatch.setattr(AIService, "_visible_page", visible)
        monkeypatch.setattr(AIService, "_attachments", attachments)
        self.service = AIService.__new__(AIService)
        self.service.session = None  # type: ignore[assignment]
        self.service.user = SimpleNamespace(id="user-1")  # type: ignore[assignment]

    async def summarize(self, **kwargs: object):
        return await self.service.summarize_page("ENG", "runbook", **kwargs)  # type: ignore[arg-type]

    @property
    def kinds(self) -> list[str]:
        return [call["kind"] for call in self.calls]


@pytest.fixture
def harness(monkeypatch: pytest.MonkeyPatch) -> Harness:
    return Harness(monkeypatch)


async def test_the_first_summary_reads_the_page_once_and_is_then_saved(harness: Harness) -> None:
    first = await harness.summarize()
    again = await harness.summarize()

    assert (first.summary, first.cached) == ("- A summary.", False)
    assert (again.summary, again.cached) == ("- A summary.", True)
    assert harness.kinds == ["summary"]
    assert harness.charges == 1
    assert "restart script" in harness.calls[0]["user"]  # the page text went in


async def test_switching_language_translates_the_saved_summary_not_the_page(
    harness: Harness,
) -> None:
    await harness.summarize()

    vi = await harness.summarize(lang="vi")

    assert harness.kinds == ["summary", "translate"]
    translation = harness.calls[1]
    assert translation["user"] == "- A summary."  # only the summary went in...
    assert "restart script" not in translation["user"]  # ...never the page again
    assert "Vietnamese" in translation["system"]
    assert (vi.summary, vi.cached) == ("[translated] - A summary.", False)
    assert harness.charges == 2


async def test_a_translation_is_saved_so_switching_back_and_forth_costs_nothing(
    harness: Harness,
) -> None:
    await harness.summarize()
    await harness.summarize(lang="vi")
    calls_so_far = len(harness.calls)

    vi = await harness.summarize(lang="vi")
    page_language = await harness.summarize()

    assert len(harness.calls) == calls_so_far
    assert vi.cached is True
    assert page_language.summary == "- A summary."
    assert harness.charges == 2


async def test_each_language_is_translated_on_its_own(harness: Harness) -> None:
    await harness.summarize()

    await harness.summarize(lang="vi")
    await harness.summarize(lang="en")

    assert harness.kinds == ["summary", "translate", "translate"]
    assert "English" in harness.calls[2]["system"]


async def test_asking_for_a_language_first_writes_the_summary_then_translates_it_for_one_charge(
    harness: Harness,
) -> None:
    result = await harness.summarize(lang="vi")

    assert harness.kinds == ["summary", "translate"]
    assert result.summary == "[translated] - A summary."
    assert harness.charges == 1  # one request, one unit of the user's quota
    # The page-language summary was saved on the way, so it is free now.
    assert (await harness.summarize()).cached is True


async def test_summarize_again_goes_back_to_the_page_and_drops_old_translations(
    harness: Harness,
) -> None:
    await harness.summarize()
    await harness.summarize(lang="vi")
    harness.calls.clear()

    refreshed = await harness.summarize(refresh=True)

    assert harness.kinds == ["summary"]
    assert "restart script" in harness.calls[0]["user"]
    assert refreshed.cached is False
    # The old translation described the old summary, so it must not come back.
    harness.calls.clear()
    vi = await harness.summarize(lang="vi")
    assert harness.kinds == ["translate"]
    assert vi.cached is False


async def test_summarize_again_in_a_language_summarizes_then_translates(
    harness: Harness,
) -> None:
    await harness.summarize()
    harness.calls.clear()

    result = await harness.summarize(refresh=True, lang="vi")

    assert harness.kinds == ["summary", "translate"]
    assert result.summary == "[translated] - A summary."


async def test_an_unknown_language_code_just_gives_the_page_language(harness: Harness) -> None:
    result = await harness.summarize(lang="xx")

    assert harness.kinds == ["summary"]
    assert result.summary == "- A summary."


async def test_a_page_with_too_little_text_is_not_sent_to_the_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = Harness(monkeypatch, content="Short.")

    result = await harness.summarize(lang="vi")

    assert result.too_short is True
    assert result.summary == ""
    assert harness.calls == []
    assert harness.charges == 0
