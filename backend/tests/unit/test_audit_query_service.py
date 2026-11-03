from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.api.v1.audit_logs import export_audit_logs, list_actions, list_actors, list_audit_logs
from app.models.audit import AuditAction
from app.modules.audit.service import AuditQueryService
from app.repositories.audit import AuditLogRepository
from app.schemas.audit import AuditLogRead


def _sample_entry() -> AuditLogRead:
    return AuditLogRead(
        id=uuid.uuid4(),
        created_at=datetime(2026, 11, 2, 1, 30, tzinfo=UTC),
        actor_id=uuid.uuid4(),
        actor_username="alice",
        impersonator_username="root",
        action=AuditAction.space_updated.value,
        entity_type="space",
        entity_id=uuid.uuid4(),
        entity_label="Engineering",
        details={"space_key": "ENG", "changes": {"visibility": {"from": "open", "to": "restricted"}}},
        ip_address="127.0.0.1",
    )


def test_audit_csv_and_json_serialization() -> None:
    entry = _sample_entry()
    csv_text = AuditQueryService.to_csv([entry])
    assert "actor_username,actor_id,impersonator_username,action,entity_type" in csv_text
    assert "alice" in csv_text
    assert "root" in csv_text
    assert "space_updated" in csv_text
    assert "Engineering" in csv_text

    json_text = AuditQueryService.to_json([entry])
    parsed = json.loads(json_text)
    assert len(parsed) == 1
    assert parsed[0]["actor_username"] == "alice"
    assert parsed[0]["impersonator_username"] == "root"
    assert parsed[0]["action"] == "space_updated"
    assert parsed[0]["details"]["space_key"] == "ENG"


@pytest.mark.asyncio
async def test_audit_log_endpoints_and_export() -> None:
    entry = _sample_entry()
    service = AuditQueryService(Mock())
    service.repo = Mock()
    service.repo.search = AsyncMock(return_value=([entry], 1))
    service.repo.export = AsyncMock(return_value=[entry])
    service.repo.actor_usernames = AsyncMock(return_value=["alice", "root"])

    admin = SimpleNamespace(id=uuid.uuid4(), username="root", is_superuser=True)

    page = await list_audit_logs(
        _admin=admin,
        service=service,
        action="space_updated",
        entity_type="space",
        actor_id=None,
        actor_username="root",
        entity_id=None,
        since=None,
        until=None,
        q="ENG",
        limit=50,
        offset=0,
    )
    assert page.total == 1
    assert page.items[0].actor_username == "alice"

    actions = await list_actions(_admin=admin)
    assert "space_updated" in actions
    assert "group_created" in actions
    assert "space_permission_granted" in actions

    actors = await list_actors(_admin=admin, service=service)
    assert actors == ["alice", "root"]

    csv_resp = await export_audit_logs(
        _admin=admin,
        service=service,
        format="csv",
        action=None,
        entity_type=None,
        actor_id=None,
        actor_username="root",
        entity_id=None,
        since=None,
        until=None,
        q=None,
        limit=100,
    )
    assert csv_resp.media_type == "text/csv; charset=utf-8"
    assert 'filename="audit-logs.csv"' in csv_resp.headers["Content-Disposition"]

    json_resp = await export_audit_logs(
        _admin=admin,
        service=service,
        format="json",
        action=None,
        entity_type=None,
        actor_id=None,
        actor_username=None,
        entity_id=None,
        since=None,
        until=None,
        q=None,
        limit=100,
    )
    assert json_resp.media_type == "application/json; charset=utf-8"
    assert 'filename="audit-logs.json"' in json_resp.headers["Content-Disposition"]


@pytest.mark.asyncio
async def test_audit_search_enriches_known_actor_and_tolerates_metadata_failure() -> None:
    entry = _sample_entry()
    session = Mock()
    session.execute = AsyncMock(return_value=Mock(all=Mock(return_value=[("alice", "/avatar.png", "Alice")])))
    service = AuditQueryService(session)
    service.repo = Mock(session=session)
    service.repo.search = AsyncMock(return_value=([entry], 1))

    enriched = await service.search(limit=10, offset=0)
    assert enriched.items[0].actor_avatar_url == "/avatar.png"
    assert enriched.items[0].actor_full_name == "Alice"

    session.execute.side_effect = RuntimeError("metadata unavailable")
    service.repo.search.return_value = ([_sample_entry()], 1)
    fallback = await service.search(limit=10, offset=0)
    assert fallback.items[0].actor_avatar_url is None


@pytest.mark.asyncio
async def test_audit_repository_export_and_actor_names() -> None:
    entry = _sample_entry()
    session = Mock()
    rows = Mock()
    rows.scalars.return_value.all.return_value = [entry]
    session.execute = AsyncMock(return_value=rows)
    repo = AuditLogRepository(session)

    exported = await repo.export(actor_username="alice", limit=10)
    assert exported == [entry]
    session.execute.assert_awaited_once()
    assert "impersonator_username" in str(session.execute.await_args.args[0])

    rows.scalars.return_value.all.return_value = ["alice", None, "root"]
    assert await repo.actor_usernames() == ["alice", "root"]
