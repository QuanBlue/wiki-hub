from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from redis.exceptions import RedisError

from app.core import rate_limit
from app.core import redis as redis_module
from app.core.exceptions import RateLimitedError
from app.modules.audit.service import AuditQueryService
from app.repositories.audit import AuditLogRepository
from app.services.audit import AuditService
from app.workers import settings as worker_settings
from app.workers import tasks


def test_rate_limit_rules_and_redis_client_lifecycle(monkeypatch: pytest.MonkeyPatch) -> None:
    assert rate_limit.parse_rule(" 10 / MINUTE ") == (10, 60)
    with pytest.raises(ValueError):
        rate_limit.parse_rule("ten/minute")

    fake = Mock()
    monkeypatch.setattr(redis_module, "_client", None)
    monkeypatch.setattr(redis_module, "from_url", lambda *args, **kwargs: fake)
    assert redis_module.get_redis() is fake
    assert redis_module.get_redis() is fake


@pytest.mark.asyncio
async def test_rate_limit_enforce_allows_limits_rejects_overages_and_fails_open(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipe = Mock()
    pipe.execute = AsyncMock(return_value=(2, True))
    redis = Mock(pipeline=Mock(return_value=pipe))
    monkeypatch.setattr(rate_limit, "get_redis", lambda: redis)

    await rate_limit.enforce("login", "2/second")
    pipe.incr.assert_called_once_with("ratelimit:login")
    pipe.expire.assert_called_once_with("ratelimit:login", 1, nx=True)

    pipe.execute = AsyncMock(return_value=(3, True))
    with pytest.raises(RateLimitedError):
        await rate_limit.enforce("login", "2/second")

    pipe.execute = AsyncMock(side_effect=RedisError("redis down"))
    await rate_limit.enforce("login", "2/second")


@pytest.mark.asyncio
async def test_worker_entrypoints(monkeypatch: pytest.MonkeyPatch) -> None:
    result = await tasks.ping({"job_id": "job-1"})
    assert result["status"] == "ok"
    assert result["job_id"] == "job-1"
    assert "at" in result

    session = object()
    context = AsyncMock()
    context.__aenter__.return_value = session
    context.__aexit__.return_value = False
    monkeypatch.setattr(tasks, "session_scope", lambda: context)
    storage = object()
    monkeypatch.setattr(tasks, "get_storage", lambda: storage)
    run = AsyncMock()
    monkeypatch.setattr(tasks, "run_import", run)
    import uuid

    job_id = str(uuid.uuid4())
    await tasks.run_confluence_import({}, job_id)
    run.assert_awaited_once_with(session, storage, uuid.UUID(job_id))

    backup_run = AsyncMock()
    monkeypatch.setattr(tasks, "execute_backup_job", backup_run)
    await tasks.run_backup_job({}, job_id)
    backup_run.assert_awaited_once_with(session, storage, uuid.UUID(job_id))

    monkeypatch.setattr(worker_settings, "configure_logging", Mock())
    # Startup sweeps export jobs orphaned by the previous worker; see
    # `reap_abandoned_export_jobs`.
    reap = AsyncMock()
    monkeypatch.setattr(worker_settings, "reap_backup_jobs", reap)
    await worker_settings.startup({})
    reap.assert_awaited_once()
    dispose = AsyncMock()
    monkeypatch.setattr(worker_settings, "dispose_engine", dispose)
    await worker_settings.shutdown({})
    dispose.assert_awaited_once()
    assert worker_settings.redis_settings is not None


@pytest.mark.asyncio
async def test_redis_close_resets_client(monkeypatch: pytest.MonkeyPatch) -> None:
    client = Mock()
    client.aclose = AsyncMock()
    monkeypatch.setattr(redis_module, "_client", client)
    await redis_module.close_redis()
    client.aclose.assert_awaited_once()
    assert redis_module._client is None
    await redis_module.close_redis()


@pytest.mark.asyncio
async def test_audit_repository_filters_and_query_service(monkeypatch: pytest.MonkeyPatch) -> None:
    repo = AuditLogRepository(Mock())
    statement = repo._filtered(
        action="created",
        entity_type="page",
        actor_id=SimpleNamespace(),
        entity_id=SimpleNamespace(),
        since=SimpleNamespace(),
        until=SimpleNamespace(),
        q="needle",
    )
    assert statement is not None

    entries = []
    session = Mock()
    count_result = Mock(scalar_one=Mock(return_value=0))
    page_result = Mock()
    page_result.scalars.return_value.all.return_value = entries
    session.execute = AsyncMock(side_effect=[count_result, page_result])
    result, total = await AuditLogRepository(session).search(
        action=None,
        entity_type=None,
        actor_id=None,
        entity_id=None,
        since=None,
        until=None,
        q=None,
    )
    assert result == entries
    assert total == 0

    service = AuditQueryService(session)
    service.repo = Mock()
    service.repo.search = AsyncMock(return_value=([], 0))
    page = await service.search(limit=10, offset=2)
    assert page.total == 0


def test_audit_service_changes() -> None:
    assert AuditService.changes({"a": 1}, {"a": 2}, ("a",)) == {"a": {"from": 1, "to": 2}}
    assert AuditService.changes({"a": 1}, {"a": 1}, ("a",)) == {}
