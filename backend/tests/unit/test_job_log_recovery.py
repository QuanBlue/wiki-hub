"""A failing import/restore must keep the log lines it had not yet committed.

The failure handlers roll the session back, which discards pending rows; these
tests pin that the lines are collected first and re-added afterwards."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.models.backup_job import BackupJob, BackupJobLog
from app.modules.backup.jobs import run_backup_job
from app.modules.backup.service import ExportCancelled
from app.services.job_log_recovery import pending_log_entries, restore_log_entries


def _line(message: str) -> BackupJobLog:
    return BackupJobLog(job_id=uuid.uuid4(), level="warning", phase="restoring", message=message)


def test_only_unflushed_rows_of_the_requested_model_are_collected():
    mine, other = _line("mine"), object()
    session = SimpleNamespace(new=[mine, other])

    assert pending_log_entries(session, BackupJobLog) == [mine]
    assert pending_log_entries(SimpleNamespace(new=[]), BackupJobLog) == []


def test_collected_rows_are_added_back_in_one_call():
    session = SimpleNamespace(add_all=Mock())
    rows = [_line("a"), _line("b")]

    restore_log_entries(session, rows)

    session.add_all.assert_called_once_with(rows)


def _restore_setup(monkeypatch, error: BaseException):
    pending = _line("written just before the failure")
    session = AsyncMock()
    session.new = [pending]
    session.add = Mock()
    session.add_all = Mock()
    job = BackupJob(
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
    archive = Mock(object_key="k", size_bytes=1000)
    session.get.side_effect = lambda model, _pk: job if model is BackupJob else archive

    async def failing_restore(self, path, storage, **kwargs):
        raise error

    monkeypatch.setattr("app.modules.backup.jobs.BackupService.restore_full_package", failing_restore)
    return session, job, pending


@pytest.mark.parametrize(
    ("error", "status"),
    [(ExportCancelled("stop"), "cancelled"), (RuntimeError("boom"), "failed")],
)
async def test_a_stopped_restore_keeps_its_pending_log_lines(monkeypatch, error, status):
    session, job, pending = _restore_setup(monkeypatch, error)

    if isinstance(error, ExportCancelled):
        await run_backup_job(session, AsyncMock(), job.id)
    else:
        with pytest.raises(RuntimeError):
            await run_backup_job(session, AsyncMock(), job.id)

    assert job.status == status
    session.rollback.assert_awaited()
    session.add_all.assert_called_once_with([pending])


async def test_a_timed_out_restore_is_recorded_as_failed_and_still_raises(monkeypatch):
    session, job, pending = _restore_setup(monkeypatch, asyncio.CancelledError())

    with pytest.raises(asyncio.CancelledError):
        await run_backup_job(session, AsyncMock(), job.id)

    assert job.status == "failed" and job.phase == "failed"
    assert "interrupted" in job.error
    session.add_all.assert_called_once_with([pending])
    session.commit.assert_awaited()
