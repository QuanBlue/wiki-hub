"""Unit tests for AI revision diff summary."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.ai import service as service_module
from app.modules.ai.service import AIService
from app.modules.ai.skills import diff_summary_system_prompt
from app.schemas.ai import RevisionDiffSummaryRequest
from app.schemas.revision import PageRevisionDiffLine, PageRevisionDiffRead
from tests.unit.ai_fakes import fake_chat


def test_diff_summary_system_prompt() -> None:
    prompt_vi = diff_summary_system_prompt(lang="vi")
    assert "WikiHub" in prompt_vi
    assert "Tính chất thay đổi" in prompt_vi
    assert "Quy định & Tác động cốt lõi" in prompt_vi
    assert "100% BẰNG TIẾNG VIỆT" in prompt_vi
    assert "Nature of change" not in prompt_vi

    prompt_en = diff_summary_system_prompt(lang="en")
    assert "100% IN ENGLISH" in prompt_en
    assert "Nature of change" in prompt_en
    assert "Key impacts & rule changes" in prompt_en
    assert "Tính chất thay đổi" not in prompt_en


class FakeRedis:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.data.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.data[key] = value


@pytest.mark.asyncio
async def test_summarize_revision_diff_success(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = FakeRedis()
    monkeypatch.setattr(service_module, "get_redis", lambda: redis)
    monkeypatch.setattr(
        service_module,
        "load_config",
        AsyncMock(return_value=SimpleNamespace(ready=True, model="gpt-4o")),
    )
    monkeypatch.setattr(service_module.rate_limit, "enforce", AsyncMock())

    page_id = uuid.uuid4()
    fake_page = SimpleNamespace(
        id=page_id,
        title="Quy định làm việc",
        slug="quy-dinh-lam-viec",
        content="<p>Bản nội dung mới</p>",
        updated_at=datetime(2026, 11, 2, tzinfo=UTC),
    )

    diff_data = PageRevisionDiffRead(
        from_version=3,
        to_version=8,
        title_changed=False,
        from_title="Quy định làm việc",
        to_title="Quy định làm việc",
        chunks=[],
        added_count=1,
        deleted_count=1,
        lines=[
            PageRevisionDiffLine(
                operation="delete",
                old_text="Thời gian làm việc từ 8h30 đến 17h30.",
                new_text=None,
            ),
            PageRevisionDiffLine(
                operation="add",
                old_text=None,
                new_text="Thời gian làm việc linh hoạt từ 8h00-9h00 đến 17h00-18h00.",
            ),
        ],
    )

    service = AIService(session=SimpleNamespace(), user=SimpleNamespace(id=uuid.uuid4()))
    monkeypatch.setattr(service, "_visible_page", AsyncMock(return_value=fake_page))
    monkeypatch.setattr(service.pages, "calculate_diff", AsyncMock(return_value=diff_data))

    ai_reply = (
        "Từ bản v3 đến v8, quy định về thời gian làm việc đã thay đổi từ cố định sang linh hoạt.\n\n"
        "- **Bỏ**: 8h30 đến 17h30\n"
        "- **Mới**: Linh hoạt từ 8h00-9h00 đến 17h00-18h00\n\n"
        "<commit_message>Cập nhật quy định thời gian làm việc linh hoạt</commit_message>"
    )
    fake_chat(monkeypatch, AsyncMock(return_value=ai_reply))

    request = RevisionDiffSummaryRequest(
        from_version=3,
        to_version=8,
        prompt="Từ bản v3 đến v8, những quy định nào đã thay đổi?",
        lang="vi",
    )
    result = await service.summarize_revision_diff("HR", "quy-dinh-lam-viec", request)

    assert result.from_version == 3
    assert result.to_version == 8
    assert result.commit_message == "Cập nhật quy định thời gian làm việc linh hoạt"
    assert "<commit_message>" not in result.summary
    assert "linh hoạt" in result.summary
    assert not result.cached

    # Second call should be served from cache
    cached_result = await service.summarize_revision_diff("HR", "quy-dinh-lam-viec", request)
    assert cached_result.cached is True
    assert cached_result.commit_message == "Cập nhật quy định thời gian làm việc linh hoạt"


@pytest.mark.asyncio
async def test_summarize_diff_custom_content(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = FakeRedis()
    monkeypatch.setattr(service_module, "get_redis", lambda: redis)
    monkeypatch.setattr(
        service_module,
        "load_config",
        AsyncMock(return_value=SimpleNamespace(ready=True, model="gpt-4o")),
    )
    monkeypatch.setattr(service_module.rate_limit, "enforce", AsyncMock())

    fake_page = SimpleNamespace(
        id=uuid.uuid4(),
        title="Draft Test",
        slug="draft-test",
        content="<p>Old</p>",
        updated_at=datetime(2026, 11, 2, tzinfo=UTC),
    )

    service = AIService(session=SimpleNamespace(), user=SimpleNamespace(id=uuid.uuid4()))
    monkeypatch.setattr(service, "_visible_page", AsyncMock(return_value=fake_page))

    ai_reply = "Updated intro section.\n<commit_message>docs: update introduction</commit_message>"
    fake_chat(monkeypatch, AsyncMock(return_value=ai_reply))

    request = RevisionDiffSummaryRequest(
        from_content="Hello World",
        to_content="Hello Universe and Beyond",
        lang="en",
    )
    result = await service.summarize_revision_diff("ENG", "draft-test", request)

    assert result.commit_message == "docs: update introduction"
    assert "Updated intro section." in result.summary


@pytest.mark.asyncio
async def test_summarize_minor_diff(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = FakeRedis()
    monkeypatch.setattr(service_module, "get_redis", lambda: redis)
    monkeypatch.setattr(
        service_module,
        "load_config",
        AsyncMock(return_value=SimpleNamespace(ready=True, model="gpt-4o")),
    )

    fake_page = SimpleNamespace(
        id=uuid.uuid4(),
        title="CICD",
        slug="cicd",
        content="<p>ddd fff</p>",
        updated_at=datetime(2026, 11, 2, tzinfo=UTC),
    )

    diff_data = PageRevisionDiffRead(
        from_version=1,
        to_version=2,
        title_changed=False,
        from_title="CICD",
        to_title="CICD",
        chunks=[],
        added_count=2,
        deleted_count=1,
        lines=[
            PageRevisionDiffLine(operation="delete", old_text="ddd", new_text=None),
            PageRevisionDiffLine(operation="add", old_text=None, new_text="ddd fff"),
            PageRevisionDiffLine(operation="add", old_text=None, new_text="hello"),
        ],
    )

    service = AIService(session=SimpleNamespace(), user=SimpleNamespace(id=uuid.uuid4()))
    monkeypatch.setattr(service, "_visible_page", AsyncMock(return_value=fake_page))
    monkeypatch.setattr(service.pages, "calculate_diff", AsyncMock(return_value=diff_data))

    request = RevisionDiffSummaryRequest(
        from_version=1,
        to_version=2,
        lang="vi",
    )
    result = await service.summarize_revision_diff("DEV", "cicd", request)

    assert "Thay đổi nhỏ" in result.summary
    assert "không có thay đổi về quy định" in result.summary
    assert result.from_version == 1
    assert result.to_version == 2


@pytest.mark.asyncio
async def test_summarize_empty_diff_respects_language(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service_module, "get_redis", lambda: FakeRedis())
    fake_page = SimpleNamespace(
        id=uuid.uuid4(),
        title="Empty Test",
        slug="empty-test",
        content="<p>Same</p>",
        updated_at=datetime(2026, 11, 2, tzinfo=UTC),
    )
    diff_data = PageRevisionDiffRead(
        from_version=2,
        to_version=3,
        title_changed=False,
        from_title="Empty Test",
        to_title="Empty Test",
        chunks=[],
        added_count=0,
        deleted_count=0,
        lines=[],
    )

    service = AIService(session=SimpleNamespace(), user=SimpleNamespace(id=uuid.uuid4()))
    monkeypatch.setattr(service, "_visible_page", AsyncMock(return_value=fake_page))
    monkeypatch.setattr(service.pages, "calculate_diff", AsyncMock(return_value=diff_data))
    monkeypatch.setattr(
        service_module,
        "load_config",
        AsyncMock(return_value=SimpleNamespace(ready=True, model="gpt-4o")),
    )

    # Vietnamese request
    res_vi = await service.summarize_revision_diff(
        "TEST", "empty-test", RevisionDiffSummaryRequest(from_version=2, to_version=3, lang="vi")
    )
    assert res_vi.summary == "Không có thay đổi nào giữa hai phiên bản được chọn."
    assert res_vi.commit_message == "Không có thay đổi"

    # English request
    res_en = await service.summarize_revision_diff(
        "TEST", "empty-test", RevisionDiffSummaryRequest(from_version=2, to_version=3, lang="en")
    )
    assert res_en.summary == "No changes detected between the selected revisions."
    assert res_en.commit_message == "No changes"


@pytest.mark.asyncio
async def test_summarize_diff_requires_ai_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service_module, "load_config", AsyncMock(return_value=SimpleNamespace(ready=False)))
    service = AIService(session=SimpleNamespace(), user=SimpleNamespace(id=uuid.uuid4()))
    with pytest.raises(service_module.ServiceUnavailableError):
        await service.summarize_revision_diff(
            "ENG", "runbook", RevisionDiffSummaryRequest(from_content="old", to_content="new")
        )


@pytest.mark.asyncio
async def test_summarize_initial_diff_without_commit_tag(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = FakeRedis()
    monkeypatch.setattr(service_module, "get_redis", lambda: redis)
    monkeypatch.setattr(service_module, "load_config", AsyncMock(
        return_value=SimpleNamespace(ready=True, model="gpt-4o")
    ))
    monkeypatch.setattr(service_module.rate_limit, "enforce", AsyncMock())
    page = SimpleNamespace(
        id=uuid.uuid4(), title="Runbook", slug="runbook", content="<p>New</p>",
        updated_at=datetime(2026, 11, 2, tzinfo=UTC),
    )
    service = AIService(session=SimpleNamespace(), user=SimpleNamespace(id=uuid.uuid4()))
    monkeypatch.setattr(service, "_visible_page", AsyncMock(return_value=page))
    monkeypatch.setattr(service.pages, "calculate_diff", AsyncMock(return_value=PageRevisionDiffRead(
        from_version=0, to_version=1, title_changed=True, from_title="", to_title="Runbook",
        chunks=[], added_count=1, deleted_count=0,
        lines=[PageRevisionDiffLine(operation="add", old_text=None, new_text="New content")],
    )))
    chat = AsyncMock(return_value="## First page overview")
    fake_chat(monkeypatch, chat)
    result = await service.summarize_revision_diff(
        "ENG", "runbook", RevisionDiffSummaryRequest(from_version=0, to_version=1)
    )
    assert result.commit_message == "First page overview"
    assert result.summary == "## First page overview"
    chat.return_value = "##"
    fallback = await service.summarize_revision_diff(
        "ENG", "runbook", RevisionDiffSummaryRequest(from_version=0, to_version=1, prompt="refresh")
    )
    assert fallback.commit_message == "Initial page creation"


@pytest.mark.asyncio
async def test_summarize_diff_recomputes_invalid_cache_without_commit_tag(monkeypatch: pytest.MonkeyPatch) -> None:
    class InvalidCache(FakeRedis):
        async def get(self, key: str) -> str | None:
            return "not json"

    monkeypatch.setattr(service_module, "get_redis", lambda: InvalidCache())
    monkeypatch.setattr(service_module, "load_config", AsyncMock(
        return_value=SimpleNamespace(ready=True, model="gpt-4o")
    ))
    monkeypatch.setattr(service_module.rate_limit, "enforce", AsyncMock())
    page = SimpleNamespace(
        id=uuid.uuid4(), title="Runbook", slug="runbook", content="<p>New</p>",
        updated_at=datetime(2026, 11, 2, tzinfo=UTC),
    )
    service = AIService(session=SimpleNamespace(), user=SimpleNamespace(id=uuid.uuid4()))
    monkeypatch.setattr(service, "_visible_page", AsyncMock(return_value=page))
    monkeypatch.setattr(service.pages, "calculate_diff", AsyncMock(return_value=PageRevisionDiffRead(
        from_version=1, to_version=2, title_changed=True, from_title="Old", to_title="Runbook",
        chunks=[], added_count=0, deleted_count=0, lines=[],
    )))
    chat = AsyncMock(return_value="Updated title and scope")
    fake_chat(monkeypatch, chat)
    result = await service.summarize_revision_diff(
        "ENG", "runbook", RevisionDiffSummaryRequest(from_version=1, to_version=2)
    )
    assert result.commit_message == "Updated title and scope"
    assert result.cached is False
    chat.return_value = "##"
    fallback = await service.summarize_revision_diff(
        "ENG", "runbook", RevisionDiffSummaryRequest(from_version=1, to_version=2, prompt="refresh")
    )
    assert fallback.commit_message == "Updated content"
