"""Conflict check permission, configuration, and cross-space lookup."""

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import ServiceUnavailableError
from app.modules.ai import service as ai_module
from app.modules.ai.service import AIService


def _page(space, title):
    return SimpleNamespace(
        id=uuid.uuid4(), title=title, slug=title.lower(),
        content="<p>Use the current rule.</p>", space=space,
        updated_at=datetime(2026, 11, 1, tzinfo=UTC),
    )


@pytest.mark.asyncio
async def test_conflict_check_requires_enabled_ai(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ai_module, "load_config", AsyncMock(return_value=SimpleNamespace(ready=False)))
    service = AIService(SimpleNamespace(), SimpleNamespace(id=uuid.uuid4()))
    with pytest.raises(ServiceUnavailableError):
        await service.check_conflict("ENG", "a", "b")


@pytest.mark.asyncio
async def test_conflict_check_resolves_other_space(monkeypatch: pytest.MonkeyPatch) -> None:
    config = SimpleNamespace(ready=True, model="gpt-4o")
    monkeypatch.setattr(ai_module, "load_config", AsyncMock(return_value=config))
    monkeypatch.setattr(ai_module.rate_limit, "enforce", AsyncMock())
    redis = SimpleNamespace(get=AsyncMock(return_value=None), set=AsyncMock())
    monkeypatch.setattr(ai_module, "get_redis", lambda: redis)
    eng = SimpleNamespace(id=uuid.uuid4(), key="ENG", name="Engineering")
    ops = SimpleNamespace(id=uuid.uuid4(), key="OPS", name="Operations")
    first, second = _page(eng, "Policy"), _page(ops, "Runbook")
    service = AIService(SimpleNamespace(), SimpleNamespace(id=uuid.uuid4()))
    service.spaces.get_by_key = AsyncMock(side_effect=[eng, ops])
    service.spaces.require_admin = AsyncMock()
    service.pages.get_by_slug = AsyncMock(side_effect=[first, second])
    service.pages.require_page_view = AsyncMock()
    service._chat = AsyncMock(return_value="[NO_CONFLICT] No conflict")

    result = await service.check_conflict("ENG", "policy", "runbook", page_b_space_key="OPS")
    assert result.has_conflict is False
    assert [page.space_key for page in result.compared] == ["ENG", "OPS"]
    assert service.spaces.get_by_key.await_args_list[1].args == ("OPS",)
