import json
import uuid
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.api.v1.backup import (
    _enqueue,
    cancel_backup_job,
    create_backup_export,
    get_backup_job,
    import_full_backup_zip,
    list_backup_jobs,
)
from app.core.exceptions import BadRequestError, ConflictError, PayloadTooLargeError, ServiceUnavailableError
from app.models.backup_job import BackupJob
from app.schemas.backup import BackupExportCreate


def _stub_effective_import_limit(monkeypatch, max_bytes: int) -> None:
    """Stub `SiteSettingsService.get_effective()`'s import-size cap directly,
    rather than faking the DB row it would otherwise read - the endpoints
    under test now consult the admin-editable site setting instead of the
    static `settings.max_import_size_bytes` these tests used to monkeypatch.
    """

    class _Effective:
        max_backup_import_size_bytes = max_bytes

    async def _get_effective(self):
        return _Effective()

    monkeypatch.setattr(
        "app.services.site_settings.SiteSettingsService.get_effective", _get_effective
    )


@pytest.mark.asyncio
async def test_enqueue_failure(monkeypatch):
    async def mock_create_pool(*args, **kwargs):
        raise Exception("redis failed")
    monkeypatch.setattr("app.api.v1.backup.create_pool", mock_create_pool)
    with pytest.raises(ServiceUnavailableError, match="Backup worker queue is unavailable"):
        await _enqueue(uuid.uuid4())


@pytest.mark.asyncio
async def test_enqueue_success(monkeypatch):
    pool = Mock()
    pool.enqueue_job = AsyncMock()
    pool.aclose = AsyncMock()

    async def mock_create_pool(*args, **kwargs):
        return pool

    monkeypatch.setattr("app.api.v1.backup.create_pool", mock_create_pool)
    job_id = uuid.uuid4()
    await _enqueue(job_id)
    pool.enqueue_job.assert_awaited_once_with("run_backup_job", str(job_id))
    pool.aclose.assert_awaited_once()


@pytest.mark.asyncio
async def test_upload_legacy_restore_package(monkeypatch):
    service = Mock()
    service.restore_full_package = AsyncMock(return_value={"status": "ok"})
    # `import_full_backup_zip` now enforces the admin-editable site setting
    # (not the static `settings.max_import_size_bytes` this test used to
    # monkeypatch) - stub it directly rather than faking a DB row.
    _stub_effective_import_limit(monkeypatch, 1000)
    
    # 1. Invalid extension
    file = AsyncMock()
    file.filename = "test.txt"
    with pytest.raises(BadRequestError, match="Choose a .zip file created by WikiHub"):
        await import_full_backup_zip(service, file, False, "[]")
        
    # 2. Invalid json
    file.filename = "test.zip"
    with pytest.raises(BadRequestError, match="Space selection is invalid"):
        await import_full_backup_zip(service, file, False, "invalid")

    # 3. Invalid json array (not strings)
    with pytest.raises(BadRequestError, match="Space selection is invalid"):
        await import_full_backup_zip(service, file, False, "[1, 2]")

    # 3b. Same validation applies to the restore-scope field.
    with pytest.raises(BadRequestError, match="Space selection is invalid"):
        await import_full_backup_zip(service, file, False, "[]", "invalid")

    # 4. Success payload
    file.read = AsyncMock(side_effect=[b"x" * 500, b""])
    res = await import_full_backup_zip(service, file, False, '["SPACE"]', '["ENG"]')
    assert res == {"status": "ok"}
    service.restore_full_package.assert_called_once()
    assert service.restore_full_package.call_args.kwargs["space_keys"] == {"ENG"}

    # 4b. Empty scope means "every space" - passed through as None, not {}.
    file.read = AsyncMock(side_effect=[b"x" * 500, b""])
    await import_full_backup_zip(service, file, False, "[]", "[]")
    assert service.restore_full_package.call_args.kwargs["space_keys"] is None

    # 5. Payload Too large
    file.read = AsyncMock(side_effect=[b"x" * 1500])
    with pytest.raises(PayloadTooLargeError):
        await import_full_backup_zip(service, file, False, '["SPACE"]')


@pytest.mark.asyncio
async def test_create_backup_export(monkeypatch):
    session = AsyncMock()
    user = Mock()
    user.id = uuid.uuid4()
    
    payload = BackupExportCreate(
        kind="full_export",
        include_credentials=False,
        confluence_profile=None,
        space_keys=[]
    )
    
    async def mock_create_export_job(*args, **kwargs):
        m = Mock()
        m.id = uuid.uuid4()
        m.kind = "full_export"
        m.status = "pending"
        m.phase = "setup"
        m.counters = {}
        m.cancel_requested = False
        m.heartbeat_at = None
        m.include_credentials = False
        m.confluence_profile = None
        m.space_keys = []
        m.archive_id = None
        m.overwrite_space_keys = []
        m.result = None
        m.output_filename = None
        m.error = None
        from datetime import datetime, UTC
        m.created_at = datetime.now(UTC)
        m.updated_at = datetime.now(UTC)
        m.actor_id = uuid.uuid4()
        m.config = {}
        m.progress = None
        m.archive_size_bytes = None
        m.started_at = None
        m.completed_at = None
        m.failed_at = None
        m.error_message = None
        return m
    monkeypatch.setattr("app.api.v1.backup.create_export_job", mock_create_export_job)
    monkeypatch.setattr("app.api.v1.backup._enqueue", AsyncMock())
    
    res = await create_backup_export(payload, user, session)
    assert res.kind == "full_export"
    
    # Error ValueError
    async def mock_create_export_job_err(*args, **kwargs):
        raise ValueError("Invalid export")
    monkeypatch.setattr("app.api.v1.backup.create_export_job", mock_create_export_job_err)
    with pytest.raises(BadRequestError):
        await create_backup_export(payload, user, session)


@pytest.mark.asyncio
async def test_get_backup_job():
    session = AsyncMock()
    user = Mock()
    job_id = uuid.uuid4()
    
    session.get.return_value = None
    with pytest.raises(BadRequestError, match="Backup job was not found."):
        await get_backup_job(job_id, user, session)
        
    m = Mock()
    m.id = uuid.uuid4()
    m.kind = "full_export"
    m.status = "pending"
    m.phase = "setup"
    m.counters = {}
    m.cancel_requested = False
    m.started_at = None
    m.heartbeat_at = None
    m.include_credentials = False
    m.confluence_profile = None
    m.space_keys = []
    m.archive_id = None
    m.overwrite_space_keys = []
    m.result = None
    m.output_filename = None
    m.error = None
    from datetime import datetime, UTC
    m.created_at = datetime.now(UTC)
    m.updated_at = datetime.now(UTC)
    session.get.return_value = m

    res = await get_backup_job(job_id, user, session)
    assert res.id == m.id


@pytest.mark.asyncio
async def test_list_backup_jobs():
    session = AsyncMock()
    user = Mock()
    from datetime import datetime, UTC

    def make_job(**overrides):
        defaults = dict(
            id=uuid.uuid4(), created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
            counters={}, cancel_requested=False, include_credentials=False, space_keys=[],
        )
        return BackupJob(**{**defaults, **overrides})

    jobs = [
        make_job(kind="full_export", status="complete", phase="complete"),
        make_job(kind="confluence_export", status="running", phase="exporting"),
    ]
    result = Mock()
    result.scalars.return_value = jobs
    session.execute.return_value = result

    res = await list_backup_jobs(user, session)
    assert [job.id for job in res] == [j.id for j in jobs]


@pytest.mark.asyncio
async def test_cancel_backup_job_not_found():
    session = AsyncMock()
    user = Mock()
    session.get.return_value = None
    with pytest.raises(BadRequestError, match="Backup job was not found."):
        await cancel_backup_job(uuid.uuid4(), user, session)


@pytest.mark.asyncio
async def test_cancel_backup_job_already_finished():
    session = AsyncMock()
    user = Mock()
    job = BackupJob(id=uuid.uuid4(), kind="full_export", status="complete")
    session.get.return_value = job
    with pytest.raises(ConflictError, match="already finished"):
        await cancel_backup_job(job.id, user, session)


@pytest.mark.asyncio
async def test_cancel_backup_job_queued_finalizes_immediately():
    session = AsyncMock()
    user = Mock()
    from datetime import datetime, UTC

    job = BackupJob(
        id=uuid.uuid4(), kind="full_export", status="queued", phase="queued",
        created_at=datetime.now(UTC), updated_at=datetime.now(UTC), counters={},
        cancel_requested=False, include_credentials=False, space_keys=[],
    )
    session.get.return_value = job

    res = await cancel_backup_job(job.id, user, session)
    assert res.status == "cancelled"
    assert res.phase == "cancelled"
    assert res.cancel_requested is True


@pytest.mark.asyncio
async def test_cancel_backup_job_running_with_live_worker_only_sets_flag():
    """A worker that is still heartbeating stops itself at its next checkpoint,
    so the endpoint must not declare the job finished on its behalf."""
    session = AsyncMock()
    user = Mock()
    from datetime import datetime, UTC

    job = BackupJob(
        id=uuid.uuid4(), kind="full_export", status="running", phase="exporting",
        created_at=datetime.now(UTC), updated_at=datetime.now(UTC), counters={},
        cancel_requested=False, include_credentials=False, space_keys=[],
        heartbeat_at=datetime.now(UTC),
    )
    session.get.return_value = job

    res = await cancel_backup_job(job.id, user, session)
    assert res.status == "running"
    assert res.cancel_requested is True


@pytest.mark.asyncio
async def test_cancel_backup_job_finalizes_a_job_whose_worker_died():
    """Regression test for a reported bug: clicking Cancel appeared to do
    nothing and the progress bar spun forever, even across a page reload.

    The job's worker had been restarted (an `arq --watch` reload), leaving the
    row saying "running" with nobody left to observe `cancel_requested`. Since
    the endpoint only finalised *queued* jobs, the row could never change
    state again. A stale heartbeat now identifies that case so Cancel resolves
    it on the spot.
    """
    from datetime import datetime, timedelta, UTC

    from app.modules.backup.service import STALE_JOB_AFTER

    for heartbeat in (None, datetime.now(UTC) - STALE_JOB_AFTER - timedelta(seconds=1)):
        session = AsyncMock()
        user = Mock()
        job = BackupJob(
            id=uuid.uuid4(), kind="confluence_export", status="running", phase="exporting",
            created_at=datetime.now(UTC), updated_at=datetime.now(UTC), counters={},
            cancel_requested=False, include_credentials=False, space_keys=[],
            heartbeat_at=heartbeat,
        )
        session.get.return_value = job

        res = await cancel_backup_job(job.id, user, session)
        assert res.status == "cancelled", f"heartbeat={heartbeat!r}"
        assert res.phase == "cancelled"
        assert res.cancel_requested is True
