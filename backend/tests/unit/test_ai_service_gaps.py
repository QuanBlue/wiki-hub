"""AIService edges: cache failures, access filtering, and answers that come back empty."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from redis.exceptions import RedisError

from app.core.exceptions import ServiceUnavailableError
from app.modules.ai import service as service_module
from app.modules.ai.client import ChatReply, Usage
from app.modules.ai.config import AIConfig
from app.modules.ai.service import AIService, attachment_ids
from app.schemas.ai import AssistRequest, ExplainRequest, PageDraftRequest
from tests.unit.ai_fakes import fake_chat

READY = AIConfig(True, "http://gateway.test/v1", "k", "m")
OFF = AIConfig(False, "", "", "")


def _service(session: object | None = None) -> AIService:
    return AIService(session or Mock(), SimpleNamespace(id=uuid.uuid4()))


def _config(monkeypatch: pytest.MonkeyPatch, config: AIConfig) -> None:
    async def load(_session: object) -> AIConfig:
        return config

    monkeypatch.setattr(service_module, "load_config", load)


def test_an_attachment_link_that_is_not_an_id_is_ignored() -> None:
    good = uuid.uuid4()
    content = f"/api/v1/attachments/{good} /api/v1/attachments/{'a' * 36}"
    assert attachment_ids(content) == [good]
    assert attachment_ids("") == []


def test_an_attachment_link_of_the_right_shape_but_not_a_uuid_is_ignored() -> None:
    # 36 characters that match the id pattern but cannot be parsed as a UUID
    # ('g' is not a hex digit) hit the ValueError guard.
    good = uuid.uuid4()
    content = f"/api/v1/attachments/{good} /api/v1/attachments/{'g' * 36}"
    assert attachment_ids(content) == [good]
    assert attachment_ids(f"/api/v1/attachments/{'g' * 36}") == []


@pytest.mark.asyncio
async def test_a_model_call_is_logged_with_its_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    recorded = AsyncMock()

    async def with_usage(*_a: object, **_k: object) -> ChatReply:
        return ChatReply("hello", Usage(3, 4))

    monkeypatch.setattr(service_module, "chat_with_usage", with_usage)
    monkeypatch.setattr(service_module, "record_ai_usage", recorded)
    service = _service()

    assert await service._chat("summarize", READY, []) == "hello"
    recorded.assert_awaited_once_with(
        user_id=service.user.id,
        feature="summarize",
        model="m",
        prompt_tokens=3,
        completion_tokens=4,
    )


@pytest.mark.asyncio
async def test_page_text_is_only_reached_after_the_access_checks() -> None:
    service = _service()
    space, page = object(), object()
    service.spaces = Mock(get_by_key=AsyncMock(return_value=space), require_view=AsyncMock())
    service.pages = Mock(get_by_slug=AsyncMock(return_value=page), require_page_view=AsyncMock())

    assert await service._visible_page("ENG", "home") is page
    service.spaces.require_view.assert_awaited_once_with(space, service.user)
    service.pages.require_page_view.assert_awaited_once_with(page, service.user)


@pytest.mark.asyncio
async def test_only_attachments_of_this_page_are_listed() -> None:
    mine = uuid.uuid4()
    row = SimpleNamespace(id=mine, filename="a.pdf", content_type="application/pdf")
    session = Mock(scalars=AsyncMock(return_value=[row]))
    service = _service(session)
    page = SimpleNamespace(
        id=uuid.uuid4(), content=f"/api/v1/attachments/{mine} /api/v1/attachments/{uuid.uuid4()}"
    )

    found = await service._attachments(page)

    assert [(a.id, a.filename) for a in found] == [(mine, "a.pdf")]
    empty = await service._attachments(SimpleNamespace(id=uuid.uuid4(), content="no files"))
    assert empty == []


@pytest.mark.asyncio
async def test_a_redis_outage_never_breaks_the_summary_cache() -> None:
    service = _service()
    redis = Mock(
        get=AsyncMock(side_effect=RedisError("down")),
        set=AsyncMock(side_effect=OSError("down")),
        delete=AsyncMock(side_effect=RedisError("down")),
    )
    assert await service._read(redis, "k") is None
    await service._write(redis, "k", "v")
    await service._forget(redis, "k")


@pytest.mark.asyncio
async def test_related_pages_that_cannot_be_read_are_dropped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    allowed = SimpleNamespace(id=uuid.uuid4())
    hidden = SimpleNamespace(id=uuid.uuid4())
    session = Mock(scalars=AsyncMock(return_value=[allowed, hidden]))
    service = _service(session)

    async def can_view(_self: object, page: object, _user: object) -> bool:
        return page is allowed

    monkeypatch.setattr(service_module.PermissionService, "can_view_page", can_view)

    ids = [allowed.id, hidden.id, uuid.uuid4()]
    assert await service._readable_pages(ids) == [allowed]
    assert await service._readable_pages([]) == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "call",
    [
        lambda s: s.suggest_for_page("ENG", "home"),
        lambda s: s.summarize_page("ENG", "home"),
        lambda s: s.explain_selection("ENG", "home", ExplainRequest(text="word", action="explain")),
        lambda s: s.clarify_page("ENG", PageDraftRequest(prompt="a page")),
    ],
)
async def test_nothing_is_asked_while_the_assistant_is_off(monkeypatch, call) -> None:
    _config(monkeypatch, OFF)
    with pytest.raises(ServiceUnavailableError, match="not enabled"):
        await call(_service())


def _creator(monkeypatch: pytest.MonkeyPatch, service: AIService) -> None:
    _config(monkeypatch, READY)
    service.spaces = Mock(get_by_key=AsyncMock(return_value=SimpleNamespace(id=uuid.uuid4())))
    service.pages = Mock(require_editor=AsyncMock())
    monkeypatch.setattr(service_module.rate_limit, "enforce", AsyncMock())

    async def skill(_session: object) -> str:
        return "skill"

    monkeypatch.setattr(service_module, "page_draft_instructions", skill)
    monkeypatch.setattr(service_module, "writing_instructions", skill)


@pytest.mark.asyncio
async def test_a_draft_keeps_the_title_the_author_typed(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _service()
    _creator(monkeypatch, service)
    sent: list[list[dict[str, str]]] = []

    async def chat(_c: object, messages: list[dict[str, str]], **_k: object) -> str:
        sent.append(messages)
        return "Some body text."

    fake_chat(monkeypatch, chat)
    draft = await service.draft_page("ENG", PageDraftRequest(prompt="a page", title="My title"))

    assert "Title: My title" in sent[0][1]["content"]
    assert draft.title == "My title"


@pytest.mark.asyncio
async def test_an_empty_draft_or_answer_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _service()
    _creator(monkeypatch, service)

    async def chat(*_a: object, **_k: object) -> str:
        return "   "

    fake_chat(monkeypatch, chat)
    with pytest.raises(ServiceUnavailableError, match="write this page"):
        await service.draft_page("ENG", PageDraftRequest(prompt="a page"))
    with pytest.raises(ServiceUnavailableError, match="could not answer"):
        await service.assist_writing("ENG", AssistRequest(action="fix", text="teh cat"))
