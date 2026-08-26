import uuid
import pytest
from unittest.mock import AsyncMock, Mock
from datetime import datetime, timedelta, UTC

from app.modules.backup.jobs import (
    create_export_job,
    create_import_job,
    reap_abandoned_export_jobs,
    run_backup_job,
)
from app.modules.backup.service import STALE_JOB_AFTER, ExportCancelled
from app.models.backup_job import BackupArchive, BackupJob, BackupJobLog
from app.models.page import WikiPage
from app.models.space import Space
from app.models.attachment import PageAttachment
from app.schemas.backup import ImportReport

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
async def test_create_import_job():
    session = AsyncMock()
    user_id = uuid.uuid4()
    archive_id = uuid.uuid4()

    # Unknown archive.
    session.get.return_value = None
    with pytest.raises(ValueError, match="Unknown backup archive"):
        await create_import_job(session, actor_id=user_id, archive_id=archive_id)

    # Archive still mid-upload - nothing to restore yet.
    archive = Mock(status="uploading")
    session.get.return_value = archive
    with pytest.raises(ValueError, match="has not finished uploading"):
        await create_import_job(session, actor_id=user_id, archive_id=archive_id)

    # A scanned archive is ready.
    archive.status = "scanned"
    job = await create_import_job(
        session,
        actor_id=user_id,
        archive_id=archive_id,
        overwrite_space_keys=["ENG"],
        space_keys=["ENG", "SALES"],
    )
    assert job.kind == "full_import"
    assert job.archive_id == archive_id
    assert job.overwrite_space_keys == ["ENG"]
    assert job.space_keys == ["ENG", "SALES"]
    assert job.status == "queued"

    # An already-uploaded (not yet scanned) archive is also accepted.
    archive.status = "uploaded"
    job2 = await create_import_job(session, actor_id=user_id, archive_id=archive_id)
    assert job2.space_keys == []
    assert job2.overwrite_space_keys == []


@pytest.mark.asyncio
async def test_create_export_job_rejects_unknown_space_keys():
    session = AsyncMock()
    user_id = uuid.uuid4()

    m_res = Mock()
    m_res.scalars.return_value = ["ENG"]
    session.execute.return_value = m_res

    with pytest.raises(ValueError, match="Unknown space key"):
        await create_export_job(
            session, actor_id=user_id, kind="full_export", space_keys=["ENG", "GHOST"]
        )

    # A fully-known scope is accepted and stored as given.
    job = await create_export_job(
        session, actor_id=user_id, kind="full_export", space_keys=["ENG"]
    )
    assert job.space_keys == ["ENG"]

    # Empty scope ("all spaces") never triggers the lookup, so it's accepted
    # even though session.execute is still stubbed to only know "ENG".
    job_all = await create_export_job(session, actor_id=user_id, kind="full_export")
    assert job_all.space_keys == []


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

    # 3. Full export - also asserts job.space_keys reaches export_full_package.
    job = BackupJob(
        id=job_id,
        kind="full_export",
        status="queued",
        cancel_requested=False,
        created_at=datetime.now(UTC),
        space_keys=["ENG"],
    )
    session.get.return_value = job

    captured_space_keys = []

    async def mock_export(self, path, storage, include_credentials=False, space_keys=None, job=None):
        captured_space_keys.append(space_keys)
        with open(path, "w") as f:
            f.write("test")
        return {"counts": {"pages": 1}}

    monkeypatch.setattr("app.modules.backup.jobs.BackupService.export_full_package", mock_export)
    await run_backup_job(session, storage, job_id)
    assert job.status == "complete"
    assert job.counters == {"pages": 1}
    assert captured_space_keys == [["ENG"]]

    # 4. Confluence export
    job = BackupJob(id=job_id, kind="confluence_export", status="queued", cancel_requested=False, created_at=datetime.now(UTC), confluence_profile="dc-8", space_keys=["TEST"])
    session.get.return_value = job

    async def mock_conf_export(path, storage, *, profile, spaces, pages, attachments, session=None, job=None):
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
    async def mock_export_cancel(self, path, storage, include_credentials=False, space_keys=None, job=None):
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


def _restore_job(**overrides):
    defaults = dict(
        id=uuid.uuid4(),
        kind="full_import",
        status="queued",
        phase="queued",
        counters={},
        cancel_requested=False,
        created_at=datetime.now(UTC),
        archive_id=uuid.uuid4(),
        overwrite_space_keys=[],
        space_keys=[],
    )
    return BackupJob(**{**defaults, **overrides})


@pytest.mark.asyncio
async def test_run_backup_job_full_import_downloads_then_restores(monkeypatch):
    """A restore job downloads its already-uploaded archive, applies it, and
    stores the resulting `ImportReport` on `job.result` - the piece the old
    synchronous `/backup/import-zip` endpoint used to hand back directly in
    its HTTP response."""
    session = AsyncMock()
    storage = AsyncMock()
    job = _restore_job()
    archive = Mock(object_key="backups/imports/x/file.zip", size_bytes=1000)

    def get_side_effect(model, _pk):
        return job if model is BackupJob else archive

    session.get.side_effect = get_side_effect

    captured = {}

    async def mock_restore(self, path, storage, *, dry_run, overwrite_space_keys, space_keys, job):
        captured["dry_run"] = dry_run
        captured["job"] = job
        return ImportReport(
            dry_run=False, version=2, includes_credentials=False, created={"page": 1}
        )

    monkeypatch.setattr(
        "app.modules.backup.jobs.BackupService.restore_full_package", mock_restore
    )

    await run_backup_job(session, storage, job.id)

    assert job.status == "complete"
    assert job.phase == "complete"
    assert job.result == {
        "dry_run": False,
        "version": 2,
        "includes_credentials": False,
        "created": {"page": 1},
        "skipped": {},
        "errors": {},
        "users_without_password": [],
        "entries": [],
        "entries_truncated": False,
        "conflicting_space_keys": [],
    }
    assert captured["dry_run"] is False
    assert captured["job"] is job
    storage.download_to_file.assert_awaited_once()
    assert storage.download_to_file.await_args.args[0] == archive.object_key


@pytest.mark.asyncio
async def test_run_backup_job_full_import_cancelled(monkeypatch):
    session = AsyncMock()
    storage = AsyncMock()
    job = _restore_job()
    archive = Mock(object_key="k", size_bytes=1000)

    def get_side_effect(model, _pk):
        return job if model is BackupJob else archive

    session.get.side_effect = get_side_effect

    async def mock_restore(self, path, storage, *, dry_run, overwrite_space_keys, space_keys, job):
        raise ExportCancelled("Export cancelled by administrator.")

    monkeypatch.setattr(
        "app.modules.backup.jobs.BackupService.restore_full_package", mock_restore
    )

    await run_backup_job(session, storage, job.id)
    assert job.status == "cancelled"
    assert job.phase == "cancelled"


@pytest.mark.asyncio
async def test_run_backup_job_full_import_missing_archive_fails():
    """No `archive_id` (or a deleted archive) fails the job cleanly instead of
    crashing the worker - `BackupArchive.archive_id` is a `SET NULL` foreign
    key, so this is reachable if the archive row is ever removed."""
    session = AsyncMock()
    storage = AsyncMock()
    job = _restore_job(archive_id=None)
    session.get.return_value = job

    with pytest.raises(ValueError, match="no uploaded archive"):
        await run_backup_job(session, storage, job.id)
    assert job.status == "failed"


def _running_job(**overrides):
    defaults = dict(
        id=uuid.uuid4(), kind="full_export", status="running", phase="exporting",
        counters={}, cancel_requested=False, created_at=datetime.now(UTC),
    )
    return BackupJob(**{**defaults, **overrides})


@pytest.mark.asyncio
async def test_reap_abandoned_export_jobs():
    """Regression test for a reported bug: a job whose worker had been restarted
    stayed "running" forever, so the admin UI's progress bar never stopped and
    Cancel had nobody left to act on the request - even after a page reload.
    """
    stale = datetime.now(UTC) - STALE_JOB_AFTER - timedelta(seconds=1)
    orphaned = _running_job(heartbeat_at=stale)
    orphaned_after_cancel = _running_job(heartbeat_at=stale, cancel_requested=True)
    # Rows predating heartbeats cannot be proven alive, so they are reaped too.
    never_beat = _running_job(heartbeat_at=None)

    session = AsyncMock()
    result = Mock()
    result.scalars.return_value.all.return_value = [
        orphaned,
        orphaned_after_cancel,
        never_beat,
    ]
    session.execute.return_value = result

    assert await reap_abandoned_export_jobs(session) == 3
    session.commit.assert_awaited_once()

    assert (orphaned.status, orphaned.phase) == ("failed", "failed")
    assert orphaned.error == "The export worker stopped before this job finished."
    assert (never_beat.status, never_beat.phase) == ("failed", "failed")
    # An operator who asked for cancellation should not be told it failed.
    assert (orphaned_after_cancel.status, orphaned_after_cancel.phase) == (
        "cancelled",
        "cancelled",
    )
    assert orphaned_after_cancel.error is None


@pytest.mark.asyncio
async def test_reap_abandoned_export_jobs_leaves_live_jobs_alone():
    """The query must be what excludes healthy jobs: a live worker's job is
    still running and reaping it would report a false failure."""
    session = AsyncMock()
    result = Mock()
    result.scalars.return_value.all.return_value = []
    session.execute.return_value = result

    assert await reap_abandoned_export_jobs(session) == 0
    # Nothing to write - and no empty transaction left behind either.
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_reap_every_running_job_skips_the_heartbeat_filter():
    """A worker's own startup knows it is running nothing, so it finalises
    every running row without waiting out a heartbeat timeout - that is what
    makes a job orphaned by a worker restart clear in seconds instead of
    minutes."""
    session = AsyncMock()
    result = Mock()
    result.scalars.return_value.all.return_value = []
    session.execute.return_value = result

    def executed_where_clause():
        # `heartbeat_at` is always in the SELECT column list, so only the
        # filter tells the two sweeps apart.
        return str(session.execute.await_args.args[0]).split("WHERE", 1)[1]

    await reap_abandoned_export_jobs(session, every_running_job=True)
    assert "heartbeat_at" not in executed_where_clause()

    session.execute.reset_mock()
    await reap_abandoned_export_jobs(session)
    assert "heartbeat_at" in executed_where_clause()


def _logged(session) -> list[BackupJobLog]:
    """Every `BackupJobLog` handed to `session.add`, in the order written."""
    return [
        call.args[0]
        for call in session.add.call_args_list
        if isinstance(call.args[0], BackupJobLog)
    ]


@pytest.mark.asyncio
async def test_run_backup_job_full_import_narrates_what_it_is_doing(monkeypatch):
    """`phase` and `counters` are overwritten on every checkpoint, so once a
    step is over nothing records that it happened. A restore that runs for
    hours behind a single progress bar gives an operator no way to tell steady
    work from a wedged worker, and no account afterwards of what it touched."""
    session = AsyncMock()
    storage = AsyncMock()
    job = _restore_job()
    archive = Mock(
        object_key="backups/imports/x/file.zip", size_bytes=1000, filename="backup.zip"
    )

    def get_side_effect(model, _pk):
        return job if model is BackupJob else archive

    session.get.side_effect = get_side_effect

    async def mock_restore(self, path, storage, *, dry_run, overwrite_space_keys, space_keys, job):
        return ImportReport(
            dry_run=False,
            version=2,
            includes_credentials=False,
            created={"space": 1, "page": 3},
            conflicting_space_keys=["ENG"],
        )

    monkeypatch.setattr(
        "app.modules.backup.jobs.BackupService.restore_full_package", mock_restore
    )

    await run_backup_job(session, storage, job.id)

    entries = _logged(session)
    assert [entry.phase for entry in entries] == [
        "downloading",
        "restoring",
        "complete",
        "complete",
    ]
    assert all(entry.job_id == job.id for entry in entries)
    # The filename is named up front - an operator watching this needs to know
    # *which* archive is being applied, not just that something is.
    assert "backup.zip" in entries[0].message
    # The report's counts are spelled out rather than left to the progress bar.
    assert "1 space" in entries[2].message and "3 pages" in entries[2].message
    # Spaces that were left alone are a warning, not an aside: they are the
    # part of the backup that did *not* land.
    assert entries[3].level == "warning"
    assert "ENG" in entries[3].message


@pytest.mark.asyncio
async def test_run_backup_job_full_import_narrates_a_cancellation(monkeypatch):
    """The closing line has to be written after the rollback, not before it.

    `except ExportCancelled` rolls the session back, which discards every log
    row still pending in it - so a line added before that call would vanish
    exactly when the record matters most."""
    session = AsyncMock()
    storage = AsyncMock()
    job = _restore_job()
    archive = Mock(object_key="k", size_bytes=1000, filename="backup.zip")

    def get_side_effect(model, _pk):
        return job if model is BackupJob else archive

    session.get.side_effect = get_side_effect

    async def mock_restore(self, path, storage, *, dry_run, overwrite_space_keys, space_keys, job):
        raise ExportCancelled("Export cancelled by administrator.")

    monkeypatch.setattr(
        "app.modules.backup.jobs.BackupService.restore_full_package", mock_restore
    )

    await run_backup_job(session, storage, job.id)

    assert job.status == "cancelled"
    closing = _logged(session)[-1]
    assert closing.phase == "cancelled"
    assert closing.level == "warning"
    # Added after the rollback: no `session.rollback` call may follow it.
    add_calls = [c for c in session.method_calls if c[0] in {"add", "rollback"}]
    assert add_calls[-1][0] == "add"
