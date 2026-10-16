"""Clarifying a new page's request: key words, the model's questions, and what the draft gets."""

from __future__ import annotations

import json
import uuid
from types import SimpleNamespace

import pytest

from app.modules.ai import service as service_module
from app.modules.ai.config import AIConfig
from app.modules.ai.page_context import keywords, parse_questions, wiki_context
from app.modules.ai.service import AIService
from app.schemas.ai import PageAnswer, PageDraftRequest
from tests.unit.ai_fakes import fake_chat

QUESTIONS = {
    "questions": [
        {
            "header": "Audience",
            "question": "Who is it for?",
            "multi_select": False,
            "options": [
                {"label": "New joiners", "description": "No background"},
                {"label": "Operators", "description": "Daily use"},
            ],
        },
        {"header": "Broken", "question": "One option only", "options": [{"label": "x"}]},
    ]
}


def test_keywords_keep_the_distinctive_words() -> None:
    found = keywords("Hướng dẫn sử dụng Grafana với Prometheus cho page")

    assert "grafana" in found
    assert "prometheus" in found
    assert "page" not in found
    assert found == sorted(found, key=len, reverse=True)


def test_questions_are_read_from_json_even_with_text_around_it() -> None:
    questions = parse_questions("Sure!\n```json\n" + json.dumps(QUESTIONS) + "\n```")

    assert [q.question for q in questions] == ["Who is it for?"]  # one-option question dropped
    assert [o.label for o in questions[0].options] == ["New joiners", "Operators"]


@pytest.mark.parametrize("reply", ["", "no json here", "{not json}", '{"questions": "x"}'])
def test_an_unusable_reply_means_no_questions(reply: str) -> None:
    assert parse_questions(reply) == []


def test_at_most_four_questions_are_kept() -> None:
    item = QUESTIONS["questions"][0]
    assert len(parse_questions(json.dumps({"questions": [item] * 9}))) == 4


def test_wiki_context_wraps_each_page_as_reference_data() -> None:
    page = SimpleNamespace(title='Say "hi"', content="<p>Body   text</p>")

    text = wiki_context([page])  # type: ignore[list-item]

    assert text.startswith("<wiki>") and text.endswith("</wiki>")
    assert "Body text" in text
    assert wiki_context([]) == ""


class Harness:
    def __init__(self, monkeypatch: pytest.MonkeyPatch, reply: str) -> None:
        self.messages: list[list[dict[str, str]]] = []
        self.charges = 0
        page = SimpleNamespace(
            id=uuid.UUID(int=1),
            title="Prometheus setup",
            slug="prometheus-setup",
            content="<p>Prometheus runs on the monitoring host.</p>",
            space=SimpleNamespace(key="OPS", name="Operations"),
        )

        async def config(_session: object) -> AIConfig:
            return AIConfig(True, "http://gateway.test/v1", "k", "m")

        async def chat(_c: AIConfig, messages: list[dict[str, str]], **_kw: object) -> str:
            self.messages.append(messages)
            return reply

        async def enforce(_key: str, _rule: str) -> None:
            self.charges += 1

        async def related(*_args: object, **_kw: object) -> list[SimpleNamespace]:
            return [page]

        async def readable(_self: object, ids: list[str]) -> list[SimpleNamespace]:
            return [page] if ids else []

        async def instructions(_session: object) -> str:
            return "Write a page."

        monkeypatch.setattr(service_module, "load_config", config)
        fake_chat(monkeypatch, chat)
        monkeypatch.setattr(service_module, "find_related", related)
        monkeypatch.setattr(service_module, "page_draft_instructions", instructions)
        monkeypatch.setattr(service_module.rate_limit, "enforce", enforce)
        monkeypatch.setattr(AIService, "_readable_pages", readable)

        async def get_by_key(key: str) -> SimpleNamespace:
            return SimpleNamespace(id="s1", key=key)

        async def require_editor(_space: object, _user: object) -> None:
            return None

        self.service = AIService.__new__(AIService)
        self.service.session = None  # type: ignore[assignment]
        self.service.user = SimpleNamespace(id="u1")  # type: ignore[assignment]
        self.service.spaces = SimpleNamespace(get_by_key=get_by_key)  # type: ignore[assignment]
        self.service.pages = SimpleNamespace(require_editor=require_editor)  # type: ignore[assignment]


async def test_clarify_returns_the_questions_and_the_wiki_pages_it_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = Harness(monkeypatch, json.dumps(QUESTIONS))

    result = await harness.service.clarify_page(
        "OPS", PageDraftRequest(prompt="Guide to Prometheus")
    )

    assert [q.question for q in result.questions] == ["Who is it for?"]
    assert [(p.title, p.space_key) for p in result.related] == [("Prometheus setup", "OPS")]
    user_message = harness.messages[0][1]["content"]
    assert "<request>" in user_message and "Prometheus runs on" in user_message
    assert harness.charges == 1


async def test_a_clear_request_gets_no_questions(monkeypatch: pytest.MonkeyPatch) -> None:
    harness = Harness(monkeypatch, '{"questions": []}')

    result = await harness.service.clarify_page("OPS", PageDraftRequest(prompt="Very clear ask"))

    assert result.questions == []


async def test_the_draft_is_given_the_answers_and_the_related_pages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = Harness(monkeypatch, "Title: Grafana\n\n## Intro\n\nHello.")

    draft = await harness.service.draft_page(
        "OPS",
        PageDraftRequest(
            prompt="Guide to Grafana",
            answers=[PageAnswer(question="Who is it for?", answer="Operators")],
            related_ids=["00000000-0000-0000-0000-000000000001"],  # type: ignore[list-item]
        ),
    )

    sent = harness.messages[0][1]["content"]
    assert "<answers>\n- Who is it for?: Operators\n</answers>" in sent
    assert "<wiki>" in sent and "Prometheus setup" in sent
    assert draft.title == "Grafana"
    assert harness.charges == 1
