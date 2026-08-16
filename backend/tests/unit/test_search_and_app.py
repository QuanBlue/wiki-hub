from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.core.config import Environment, settings
from app.core.middleware import SecurityHeadersMiddleware
from app.main import create_app, lifespan
from app.models.audit import AuditAction
from app.models.permission import Permission
from app.modules.search import service as search_module
from app.modules.search.service import SearchService, extract_snippet
from app.services.audit import AuditService, ClientInfo


def test_extract_snippet_handles_empty_query_and_matches() -> None:
    assert extract_snippet("", "") == ""
    assert extract_snippet("<p>A &amp; B</p>", "") == "A & B"
    assert extract_snippet("x" * 150, "") == ("x" * 140) + "..."
    assert extract_snippet("Nothing here", "needle") == "Nothing here"
    assert extract_snippet("<br><img>", "needle") == ""
    snippet = extract_snippet("prefix " * 20 + "needle" + " suffix" * 20, "NEEDLE")
    assert "needle" in snippet.lower()
    assert snippet.startswith("...") and snippet.endswith("...")


@pytest.mark.asyncio
async def test_search_returns_visible_spaces_and_pages(monkeypatch: pytest.MonkeyPatch) -> None:
    visible_space = SimpleNamespace(id="space-1", key="ENG", name="Engineering", description=None)
    hidden_space = SimpleNamespace(id="space-2", key="OPS", name="Ops", description="Ops")
    visible_page = SimpleNamespace(
        id="page-1",
        title="Runbook",
        slug="runbook",
        content="<p>Deploy runbook</p>",
        updated_at=datetime.now(UTC),
        space=visible_space,
    )
    hidden_page = SimpleNamespace(
        id="page-2",
        title="Secret",
        slug="secret",
        content="secret",
        updated_at=None,
        space=hidden_space,
    )
    first = Mock(
        scalars=Mock(return_value=Mock(all=Mock(return_value=[visible_space, hidden_space])))
    )
    second = Mock(
        scalars=Mock(return_value=Mock(all=Mock(return_value=[visible_page, hidden_page])))
    )
    session = Mock(execute=AsyncMock(side_effect=[first, second]))
    permissions = SimpleNamespace(
        effective_permissions=AsyncMock(side_effect=[[Permission.view], []]),
        can_view_page=AsyncMock(side_effect=[True, False]),
    )
    monkeypatch.setattr(search_module, "PermissionService", lambda _session: permissions)

    result = await SearchService(session).search(" runbook ", SimpleNamespace(id="u"), limit=5)
    assert result.query == "runbook"
    assert [space.key for space in result.spaces] == ["ENG"]
    assert [page.slug for page in result.pages] == ["runbook"]
    assert "Deploy runbook" in result.pages[0].snippet

    empty = await SearchService(session).search("   ", SimpleNamespace(id="u"))
    assert empty.query == "" and not empty.pages and not empty.spaces


@pytest.mark.asyncio
async def test_audit_service_records_scrubbed_entries_and_changes() -> None:
    session = Mock(flush=AsyncMock())
    service = AuditService(
        session,
        client=ClientInfo(ip="127.0.0.1", user_agent="x" * 300),
    )
    entry = await service.record(
        AuditAction.user_created,
        entity_type="user",
        entity_label="x" * 300,
        details={"password": "secret", "name": "ok"},
    )
    assert entry.actor_username == "system"
    assert len(entry.entity_label) == 255
    assert len(entry.user_agent) == 255
    assert service.changes({"a": 1, "b": 2}, {"a": 3, "b": 2}, ["a", "b"]) == {
        "a": {"from": 1, "to": 3}
    }


def test_create_app_and_lifespan(monkeypatch: pytest.MonkeyPatch) -> None:
    app = create_app()
    assert app.title.endswith(" API")
    assert len(app.routes) > 4

    dispose = AsyncMock()
    close_redis = AsyncMock()
    monkeypatch.setattr("app.main.dispose_engine", dispose)
    monkeypatch.setattr("app.main.close_redis", close_redis)

    async def run_lifespan() -> None:
        async with lifespan(app):
            pass

    asyncio.run(run_lifespan())
    dispose.assert_awaited_once()
    close_redis.assert_awaited_once()


def test_production_security_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "env", Environment.production)
    middleware = SecurityHeadersMiddleware(lambda *_args: None)
    assert (
        b"strict-transport-security",
        b"max-age=31536000; includeSubDomains",
    ) in middleware._headers
