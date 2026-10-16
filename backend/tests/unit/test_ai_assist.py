"""The editor's writing assistant: fix grammar, continue a sentence, harmonise terms."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.core.exceptions import PermissionDeniedError
from app.modules.ai import service as service_module
from app.modules.ai.config import AIConfig
from app.modules.ai.service import AIService
from app.modules.ai.skills import assist_system_prompt
from app.schemas.ai import AssistRequest
from tests.unit.ai_fakes import fake_chat


class Harness:
    def __init__(self, monkeypatch: pytest.MonkeyPatch, *, editor: bool = True) -> None:
        self.messages: list[list[dict[str, str]]] = []
        self.charges = 0
        self.searched: list[str] = []
        page = SimpleNamespace(
            title="Prometheus setup",
            content="<p>Prometheus runs on the monitoring host.</p>",
        )

        async def config(_s: object) -> AIConfig:
            return AIConfig(True, "http://gateway.test/v1", "k", "m")

        async def chat(_c: AIConfig, messages: list[dict[str, str]], **_kw: object) -> str:
            self.messages.append(messages)
            return "  The corrected text.  "

        async def enforce(_key: str, _rule: str) -> None:
            self.charges += 1

        async def related(_session: object, _user: object, text: str, **_kw: object) -> list:
            self.searched.append(text)
            return [page]

        async def instructions(_session: object) -> str:
            return "Be brief."

        async def get_by_key(key: str) -> SimpleNamespace:
            return SimpleNamespace(id=uuid.uuid4(), key=key)

        async def require_editor(_space: object, _user: object) -> None:
            if not editor:
                raise PermissionDeniedError("no")

        monkeypatch.setattr(service_module, "load_config", config)
        fake_chat(monkeypatch, chat)
        monkeypatch.setattr(service_module, "find_related", related)
        monkeypatch.setattr(service_module, "writing_instructions", instructions)
        monkeypatch.setattr(service_module.rate_limit, "enforce", enforce)
        self.service = AIService.__new__(AIService)
        self.service.session = None  # type: ignore[assignment]
        self.service.user = SimpleNamespace(id="u1")  # type: ignore[assignment]
        self.service.spaces = SimpleNamespace(get_by_key=get_by_key)  # type: ignore[assignment]
        self.service.pages = SimpleNamespace(require_editor=require_editor)  # type: ignore[assignment]


def test_each_action_has_its_own_task_and_shares_the_house_style() -> None:
    fix = assist_system_prompt("fix", "Be brief.")
    complete = assist_system_prompt("complete", "Be brief.")
    terms = assist_system_prompt("terms", "Be brief.")

    assert fix.startswith("Be brief.") and "Correct the grammar" in fix
    assert "Continue the text" in complete and "never repeat" in complete
    assert "<wiki> tags" in terms
    assert all("untrusted" in prompt for prompt in (fix, complete, terms))


async def test_fixing_sends_the_text_and_returns_the_trimmed_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = Harness(monkeypatch)

    result = await harness.service.assist_writing(
        "ENG", AssistRequest(action="fix", text="Me and him goes there.")
    )

    assert result.result == "The corrected text."
    assert harness.messages[0][1]["content"] == "<text>\nMe and him goes there.\n</text>"
    assert harness.messages[0][0]["content"].startswith("Be brief.")
    assert harness.charges == 1
    assert harness.searched == []  # only the terminology action looks at the wiki


async def test_continuing_tells_the_model_what_follows_the_cursor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = Harness(monkeypatch)

    await harness.service.assist_writing(
        "ENG", AssistRequest(action="complete", text="Restart the worker", after="Then check.")
    )

    sent = harness.messages[0][1]["content"]
    assert "<text>\nRestart the worker\n</text>" in sent
    assert "<after>\nThen check.\n</after>" in sent


async def test_terminology_is_checked_against_the_related_wiki_pages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = Harness(monkeypatch)

    await harness.service.assist_writing(
        "ENG", AssistRequest(action="terms", text="Prometheus server runs on the monitor box")
    )

    assert harness.searched == ["Prometheus server runs on the monitor box"]
    sent = harness.messages[0][1]["content"]
    assert "<wiki>" in sent and "Prometheus runs on the monitoring host." in sent


async def test_only_someone_who_can_edit_the_space_spends_the_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = Harness(monkeypatch, editor=False)

    with pytest.raises(PermissionDeniedError):
        await harness.service.assist_writing("ENG", AssistRequest(action="fix", text="Hello"))

    assert harness.messages == [] and harness.charges == 0


def test_edit_and_write_need_an_instruction_and_the_rest_need_text() -> None:
    with pytest.raises(ValidationError):
        AssistRequest(action="write")
    with pytest.raises(ValidationError):
        AssistRequest(action="edit", text="Some words")
    with pytest.raises(ValidationError):
        AssistRequest(action="fix")
    assert AssistRequest(action="write", instruction="A checklist for release day").text == ""


async def test_writing_at_the_caret_returns_markdown_and_editor_html(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = Harness(monkeypatch)

    async def chat(_c: AIConfig, messages: list[dict[str, str]], **_kw: object) -> str:
        harness.messages.append(messages)
        return "## Release day\n\n- [ ] Tag the build\n- [ ] Tell the team"

    fake_chat(monkeypatch, chat)

    result = await harness.service.assist_writing(
        "ENG",
        AssistRequest(
            action="write",
            instruction="A checklist for release day",
            before="Intro text.",
            after="Closing text.",
        ),
    )

    sent = harness.messages[0][1]["content"]
    assert "<instruction>\nA checklist for release day\n</instruction>" in sent
    assert "<before>\nIntro text.\n</before>" in sent
    assert "<after>\nClosing text.\n</after>" in sent
    assert result.result.startswith("## Release day")
    assert result.html is not None
    assert "<h2>Release day</h2>" in result.html and 'data-type="taskList"' in result.html
    assert "drafted by AI" not in result.html  # no page-level notice for a passage


async def test_editing_a_selection_follows_the_instruction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = Harness(monkeypatch)

    result = await harness.service.assist_writing(
        "ENG", AssistRequest(action="edit", text="We shall proceed.", instruction="Make it casual")
    )

    sent = harness.messages[0][1]["content"]
    assert "<text>\nWe shall proceed.\n</text>" in sent
    assert "<instruction>\nMake it casual\n</instruction>" in sent
    assert result.html is None


async def test_asking_for_changes_sends_the_draft_back_with_the_new_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = Harness(monkeypatch)

    await harness.service.assist_writing(
        "ENG",
        AssistRequest(action="write", instruction="Shorter, please", draft="## Long\n\nText."),
    )

    sent = harness.messages[0][1]["content"]
    assert "<draft>\n## Long\n\nText.\n</draft>" in sent
    assert "Revise the draft between <draft> tags as follows: Shorter, please" in sent
