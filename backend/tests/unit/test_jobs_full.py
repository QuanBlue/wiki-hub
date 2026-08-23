import uuid
import pytest
from unittest.mock import AsyncMock, Mock
from datetime import datetime, UTC

from app.modules.backup.jobs import create_export_job, run_backup_job
from app.models.backup_job import BackupJob
from app.models.page import WikiPage
from app.models.space import Space
from app.models.attachment import PageAttachment

@pytest.mark.asyncio
async def test_create_export_job():
    session = AsyncMock()
    user_id = uuid.uuid4()
    
    with pytest.raises(ValueError, match="Unknown backup export type"):
        await create_export_job(session, actor_id=user_id, kind="invalid")
        
    with pytest.raises(ValueError, match="Confluence Data Center compatibility profile is required"):
        await create_export_job(session, actor_id=user_id, kind="confluence_export")
        
    job = await create_export_job(session, actor_id=user_id, kind="full_export")
    assert job.kind == "full_export"
    
    job2 = await create_export_job(session, actor_id=user_id, kind="confluence_export", confluence_profile="dc-8")
    assert job2.kind == "confluence_export"

@pytest.mark.asyncio
async def test_run_backup_job_complete(monkeypatch):
    session = AsyncMock()
    storage = AsyncMock()
    job_id = uuid.uuid4()
    
    # 1. Job not found
    session.get.return_value = None
    await run_backup_job(session, storage, job_id)
    
    # 2. Cancelled job
    job = BackupJob(id=job_id, kind="full_export", status="queued", cancel_requested=True, created_at=datetime.now(UTC))
    session.get.return_value = job
    await run_backup_job(session, storage, job_id)
    assert job.status == "cancelled"
    
    # 3. Full export
    job = BackupJob(id=job_id, kind="full_export", status="queued", cancel_requested=False, created_at=datetime.now(UTC))
    session.get.return_value = job
    
    async def mock_export(self, path, storage, include_credentials=False):
        with open(path, "w") as f:
            f.write("test")
        return {"counts": {"pages": 1}}
        
    monkeypatch.setattr("app.modules.backup.jobs.BackupService.export_full_package", mock_export)
    await run_backup_job(session, storage, job_id)
    assert job.status == "complete"
    assert job.counters == {"pages": 1}
    
    # 4. Confluence export
    job = BackupJob(id=job_id, kind="confluence_export", status="queued", cancel_requested=False, created_at=datetime.now(UTC), confluence_profile="dc-8", space_keys=["TEST"])
    session.get.return_value = job
    
    async def mock_conf_export(path, storage, *, profile, spaces, pages, attachments):
        with open(path, "w") as f:
            f.write("test")
            
    monkeypatch.setattr("app.modules.backup.jobs.write_confluence_dc_export", mock_conf_export)
    
    m_res = Mock()
    m_res.scalars.return_value = []
    session.execute.return_value = m_res
    
    await run_backup_job(session, storage, job_id)
    assert job.status == "complete"
    assert job.counters == {"spaces": 0}

    # 5. Cancelled during execution
    job = BackupJob(id=job_id, kind="full_export", status="queued", cancel_requested=False, created_at=datetime.now(UTC))
    session.get.return_value = job
    async def mock_export_cancel(self, path, storage, include_credentials=False):
        job.cancel_requested = True
        return {"counts": {}}
    monkeypatch.setattr("app.modules.backup.jobs.BackupService.export_full_package", mock_export_cancel)
    await run_backup_job(session, storage, job_id)
    assert job.status == "cancelled"
    
    # 6. Unknown job
    job = BackupJob(id=job_id, kind="unknown", status="queued", cancel_requested=False, created_at=datetime.now(UTC))
    session.get.return_value = job
    with pytest.raises(ValueError, match="Unknown backup job"):
        await run_backup_job(session, storage, job_id)
