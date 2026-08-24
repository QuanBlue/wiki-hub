import json
import uuid
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.api.v1.backup import (
    _enqueue,
    create_backup_export,
    get_backup_job,
    import_full_backup_zip,
)
from app.core.exceptions import BadRequestError, PayloadTooLargeError, ServiceUnavailableError
from app.models.backup_job import BackupJob
from app.schemas.backup import BackupExportCreate


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
    
    # 1. Invalid extension
    file = AsyncMock()
    file.filename = "test.txt"
    with pytest.raises(BadRequestError, match="Choose a .zip file created by WikiHub"):
        await import_full_backup_zip(service, file, False, "[]")
        
    # 2. Invalid json
    file.filename = "test.zip"
    with pytest.raises(BadRequestError, match="Overwrite space selection is invalid"):
        await import_full_backup_zip(service, file, False, "invalid")
        
    # 3. Invalid json array (not strings)
    with pytest.raises(BadRequestError, match="Overwrite space selection is invalid"):
        await import_full_backup_zip(service, file, False, "[1, 2]")
        
    # 4. Success payload
    class MockSettings:
        max_import_size_bytes = 1000
    monkeypatch.setattr("app.api.v1.backup.settings", MockSettings)
    
    file.read = AsyncMock(side_effect=[b"x" * 500, b""])
    res = await import_full_backup_zip(service, file, False, '["SPACE"]')
    assert res == {"status": "ok"}
    service.restore_full_package.assert_called_once()
    
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
        m.include_credentials = False
        m.confluence_profile = None
        m.space_keys = []
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
    m.include_credentials = False
    m.confluence_profile = None
    m.space_keys = []
    m.output_filename = None
    m.error = None
    from datetime import datetime, UTC
    m.created_at = datetime.now(UTC)
    m.updated_at = datetime.now(UTC)
    session.get.return_value = m
    
    res = await get_backup_job(job_id, user, session)
    assert res.id == m.id
