"""The Help centre's search box: answering from the Help page and naming the guides to open."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.core.exceptions import ServiceUnavailableError
from app.modules.ai import help_answer as module
from app.modules.ai.assistant_context import Viewer
from app.modules.ai.client import ChatReply, Usage
from app.modules.ai.config import AIConfig
from app.modules.ai.help_answer import HelpAnswerService
from app.schemas.ai import HelpAskRequest

READY = AIConfig(True, "http://gateway.invalid/v1", "key", "model")


class Recorder:
    def __init__(self, reply: str = "Open **Backup** and choose a schedule.") -> None:
        self.reply = reply
        self.asked: list[list[dict]] = []
        self.usage: list[dict] = []
        self.limits: list[str] = []
        self.admin = False


@pytest.fixture
def model(monkeypatch: pytest.MonkeyPatch) -> Recorder:
    recorder = Recorder()

    async def config(_session):
        return READY

    async def chat(config, messages, *, max_tokens=2000, temperature=0.2):
        recorder.asked.append(messages)
        return ChatReply(recorder.reply, Usage(40, 12))

    async def record(**kwargs):
        recorder.usage.append(kwargs)

    async def enforce(key, rule):
        recorder.limits.append(key)

    class Permissions:
        def __init__(self, _session):
            pass

        async def is_system_admin(self, _user):
            return False

    monkeypatch.setattr(module, "load_config", config)
    monkeypatch.setattr(module, "chat_with_usage", chat)
    monkeypatch.setattr(module, "record_ai_usage", record)
    monkeypatch.setattr(module.rate_limit, "enforce", enforce)
    monkeypatch.setattr(module, "PermissionService", Permissions)
    recorder.admin = False

    async def viewer(_session, user):
        return Viewer(SimpleNamespace(id=user.id, is_superuser=recorder.admin), frozenset())

    monkeypatch.setattr(module, "viewer_of", viewer)
    return recorder


def _service() -> HelpAnswerService:
    return HelpAnswerService(None, SimpleNamespace(id="person-1"))  # type: ignore[arg-type]


async def test_a_question_is_answered_from_the_help_page_with_the_guides_to_open(
    model: Recorder,
) -> None:
    result = await _service().answer(HelpAskRequest(question="how do automatic backups work"))

    assert result.found is True and "Backup" in result.answer
    assert result.guides and len(result.guides) <= module.MAX_GUIDES
    assert len({g.id for g in result.guides}) == len(result.guides)
    # The model read the Help page, in the reader's language, for this question.
    system, user = model.asked[0]
    assert "English" in system["content"] and "<help>" in user["content"]
    assert "how do automatic backups work" in user["content"]
    assert model.usage[0]["feature"] == "help_answer" and model.limits == ["ai:person-1"]


async def test_the_guides_are_named_in_the_language_of_the_interface(model: Recorder) -> None:
    english = await _service().answer(HelpAskRequest(question="keyboard shortcuts"))
    vietnamese = await _service().answer(
        HelpAskRequest(question="keyboard shortcuts", locale="vi")
    )

    assert english.guides[0].id == vietnamese.guides[0].id
    assert english.guides[0].title != vietnamese.guides[0].title
    assert "Vietnamese" in model.asked[1][0]["content"]


async def test_a_question_the_help_page_does_not_cover_costs_no_model_call(
    model: Recorder,
) -> None:
    result = await _service().answer(HelpAskRequest(question="zxqv plorb"))

    assert result.found is False and result.answer == "" and result.guides == []
    assert model.asked == []


async def test_when_the_model_says_it_is_not_there_the_guides_are_still_offered(
    model: Recorder,
) -> None:
    model.reply = "NOT_FOUND"

    result = await _service().answer(HelpAskRequest(question="how do automatic backups work"))

    assert result.found is False and result.answer == "" and result.guides


async def test_without_the_ai_assistant_it_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    async def config(_session):
        return AIConfig(False, "", "", "")

    monkeypatch.setattr(module, "load_config", config)

    with pytest.raises(ServiceUnavailableError):
        await _service().answer(HelpAskRequest(question="backups"))


def test_a_question_is_tidied_and_must_say_something() -> None:
    assert HelpAskRequest(question="  how   do I  ").question == "how do I"
    with pytest.raises(ValidationError):
        HelpAskRequest(question="   x   ")
    with pytest.raises(ValidationError):
        HelpAskRequest(question="backups", locale="fr")  # type: ignore[arg-type]


def test_only_a_few_guides_are_named_and_each_once(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(module, "MAX_GUIDES", 2)

    guides = _service().guides_for("page history restore revision export markdown", "en")

    assert len(guides) == 2 and guides[0].id != guides[1].id


async def test_the_endpoint_hands_the_question_to_the_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.v1 import ai as api
    from app.schemas.ai import HelpAnswer

    seen: list[tuple] = []

    class Service:
        def __init__(self, session, user):
            seen.append((session, user))

        async def answer(self, payload):
            return HelpAnswer(found=True, answer=payload.question, guides=[])

    monkeypatch.setattr(api, "HelpAnswerService", Service)

    result = await api.answer_help(HelpAskRequest(question="hello there"), "session", "user")  # type: ignore[arg-type]

    assert result.answer == "hello there" and seen == [("session", "user")]


def test_a_question_is_answered_in_its_own_language() -> None:
    assert module.answer_language("làm sao khôi phục phiên bản cũ", "en") == "Vietnamese"
    assert module.answer_language("how do I restore it", "vi") == "Vietnamese"
    assert module.answer_language("how do I restore it", "en") == "English"


async def test_the_answer_comes_with_buttons_to_the_pages_it_is_about(model: Recorder) -> None:
    result = await _service().answer(HelpAskRequest(question="làm sao để đổi mật khẩu", locale="vi"))

    hrefs = [action.href for action in result.actions]
    assert "/account" in hrefs
    # The Help pages are offered as guides, not as buttons.
    assert not any(href.startswith("/help") for href in hrefs)


async def test_administration_pages_are_buttons_only_for_those_who_may_open_them(
    model: Recorder,
) -> None:
    question = HelpAskRequest(question="how do I set up automatic backups")

    member = await _service().answer(question)
    model.admin = True
    admin = await _service().answer(question)

    assert not any(a.href.startswith("/admin") for a in member.actions)
    assert "/admin/backup" in [a.href for a in admin.actions]


async def test_buttons_are_offered_even_when_the_guides_do_not_answer(model: Recorder) -> None:
    model.reply = "NOT_FOUND"

    result = await _service().answer(HelpAskRequest(question="change my password please"))

    assert result.found is False and "/account" in [a.href for a in result.actions]
