"""Suggesting labels and related pages for a page."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.modules.ai import service as service_module
from app.modules.ai.config import AIConfig
from app.modules.ai.page_context import parse_suggestions
from app.modules.ai.service import AIService
from app.modules.ai.skills import suggest_system_prompt
from tests.unit.ai_fakes import fake_chat

PAGE_TEXT = "Prometheus collects metrics from our services and Grafana draws the dashboards. " * 3


def test_the_model_reply_becomes_labels_and_candidate_indexes() -> None:
    labels, related = parse_suggestions(
        'Here: {"labels": ["Prometheus", "#monitoring", "prometheus", ""], "related": [2, "1", 9, 2, "x"]}',
        candidates=3,
    )

    assert labels == ["Prometheus", "monitoring"]  # tidied, no repeats
    assert related == [1, 0]  # 1-based numbers to 0-based, unknown ones dropped


@pytest.mark.parametrize("reply", ["", "nothing", "{bad json}", "[1, 2]"])
def test_an_unusable_reply_suggests_nothing(reply: str) -> None:
    assert parse_suggestions(reply, 3) == ([], [])


def test_at_most_five_of_each() -> None:
    labels, related = parse_suggestions(
        '{"labels": ["a","b","c","d","e","f","g"], "related": [1,2,3,4,5,6,7]}', candidates=8
    )

    assert len(labels) == 5 and len(related) == 5


def test_the_prompt_asks_for_json_and_treats_the_page_as_data() -> None:
    prompt = suggest_system_prompt("Be brief.")

    assert prompt.startswith("Be brief.")
    assert '"labels"' in prompt and '"related"' in prompt
    assert "untrusted" in prompt


class FakeRedis:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.data.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.data[key] = value


class FakeSession:
    """Answers the two label look-ups: the author's labels, then this page's."""

    def __init__(self, mine: list[str], on_page: list[str]) -> None:
        self.queue = [mine, on_page]

    async def scalars(self, _statement: object) -> list[str]:
        return self.queue.pop(0)


class Harness:
    def __init__(self, monkeypatch: pytest.MonkeyPatch, *, text: str = PAGE_TEXT) -> None:
        self.redis = FakeRedis()
        self.messages: list[list[dict[str, str]]] = []
        self.charges = 0
        self.mine = ["runbook", "Monitoring"]
        self.on_page = ["grafana"]
        page = SimpleNamespace(
            id=uuid.uuid4(),
            title="Monitoring basics",
            content=f"<p>{text}</p>",
            space_id=uuid.uuid4(),
            updated_at=datetime(2026, 10, 14, tzinfo=UTC),
        )
        self.related_pages = [
            SimpleNamespace(
                id=uuid.uuid4(),
                title="Alerting rules",
                slug="alerting-rules",
                content="<p>Alert rules.</p>",
                space=SimpleNamespace(key="OPS", name="Operations"),
            ),
            SimpleNamespace(
                id=uuid.uuid4(),
                title="Unrelated",
                slug="unrelated",
                content="<p>Other.</p>",
                space=SimpleNamespace(key="OPS", name="Operations"),
            ),
        ]

        async def config(_s: object) -> AIConfig:
            return AIConfig(True, "http://gateway.test/v1", "k", "m")

        async def chat(_c: AIConfig, messages: list[dict[str, str]], **_kw: object) -> str:
            self.messages.append(messages)
            return '{"labels": ["monitoring", "Prometheus", "grafana"], "related": [1]}'

        async def enforce(_key: str, _rule: str) -> None:
            self.charges += 1

        async def related(*_args: object, **_kw: object) -> list[SimpleNamespace]:
            return [page, *self.related_pages]  # the page itself must be filtered out

        async def instructions(_session: object) -> str:
            return "Suggest."

        async def visible(_self: object, _key: str, _slug: str) -> SimpleNamespace:
            return page

        monkeypatch.setattr(service_module, "get_redis", lambda: self.redis)
        monkeypatch.setattr(service_module, "load_config", config)
        fake_chat(monkeypatch, chat)
        monkeypatch.setattr(service_module, "find_related", related)
        monkeypatch.setattr(service_module, "suggestions_instructions", instructions)
        monkeypatch.setattr(service_module.rate_limit, "enforce", enforce)
        monkeypatch.setattr(AIService, "_visible_page", visible)
        self.service = AIService.__new__(AIService)
        self.service.session = FakeSession(self.mine, self.on_page)  # type: ignore[assignment]
        self.service.user = SimpleNamespace(id=uuid.uuid4())  # type: ignore[assignment]

    def again(self) -> None:
        self.service.session = FakeSession(self.mine, self.on_page)  # type: ignore[assignment]


async def test_labels_prefer_the_authors_own_and_skip_ones_the_page_has(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = Harness(monkeypatch)

    result = await harness.service.suggest_for_page("OPS", "monitoring-basics")

    assert [(label.name, label.existing) for label in result.labels] == [
        ("monitoring", True),  # one the author already uses
        ("Prometheus", False),
    ]  # "grafana" is already on the page
    assert [page.title for page in result.related] == ["Alerting rules"]
    sent = harness.messages[0][1]["content"]
    assert "<already_has>grafana</already_has>" in sent
    assert "<authors_labels>Monitoring, runbook</authors_labels>" in sent
    assert "1. Alerting rules" in sent and "Monitoring basics -" not in sent  # not itself
    assert harness.charges == 1


async def test_asking_again_for_the_same_page_is_free(monkeypatch: pytest.MonkeyPatch) -> None:
    harness = Harness(monkeypatch)
    await harness.service.suggest_for_page("OPS", "monitoring-basics")
    harness.again()

    second = await harness.service.suggest_for_page("OPS", "monitoring-basics")

    assert second.cached is True
    assert len(harness.messages) == 1 and harness.charges == 1


async def test_a_page_with_almost_no_text_is_not_sent_to_the_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = Harness(monkeypatch, text="Hi.")

    result = await harness.service.suggest_for_page("OPS", "monitoring-basics")

    assert result.labels == [] and result.related == []
    assert harness.messages == [] and harness.charges == 0


async def test_a_damaged_saved_answer_is_asked_for_again(monkeypatch: pytest.MonkeyPatch) -> None:
    harness = Harness(monkeypatch)
    await harness.service.suggest_for_page("OPS", "monitoring-basics")
    harness.again()
    for key in harness.redis.data:
        harness.redis.data[key] = "not json"

    result = await harness.service.suggest_for_page("OPS", "monitoring-basics")

    assert result.cached is False
    assert len(harness.messages) == 2
