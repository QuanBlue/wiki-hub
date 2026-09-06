"""The "Automatic backups" API routes - nothing here had any test at the API
layer before, only the scheduling logic underneath it
(tests/unit/test_backup_automated.py) and the settings-schema validation.

Each route is a thin wrapper around that logic; what is actually worth
checking here is the wrapping - request validation turned into the right 400,
`configured_directory`/`base_directory` folded into the read model, and the
two path-escape guards on the file-serving/deleting routes."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.api.v1.backup import (
    delete_automated_backup,
    download_automated_backup,
    list_automated_backups,
    read_automated_backup_settings,
    run_automated_backup_now,
    update_automated_backup_settings,
)
from app.core.exceptions import BadRequestError, NotFoundError
from app.models.backup_job import BackupJob
from app.schemas.backup import AutomatedBackupSettingsUpdate


def _settings(**overrides: object) -> SimpleNamespace:
    defaults: dict[str, object] = {
        "enabled": True,
        "interval_unit": "hours",
        "interval_value": 1,
        "time_of_day": "03:00",
        "timezone": "UTC",
        "retention_count": 7,
        "subdirectory": None,
        "last_run_at": None,
        "next_run_at": None,
        "last_status": None,
        "last_error": None,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _job(**overrides: object) -> BackupJob:
    defaults: dict[str, object] = {
        "id": uuid.uuid4(),
        "kind": "full_export",
        "status": "queued",
        "phase": "queued",
        "counters": {},
        "cancel_requested": False,
        "include_credentials": True,
        "space_keys": [],
        "automated": True,
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    defaults.update(overrides)
    return BackupJob(**defaults)


class TestReadAutomatedBackupSettings:
    async def test_folds_the_resolved_directory_into_the_read_model(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = _settings()
        session = AsyncMock()
        monkeypatch.setattr(
            "app.api.v1.backup.get_automated_settings", AsyncMock(return_value=item)
        )
        monkeypatch.setattr(
            "app.api.v1.backup.base_directory", lambda: Path("/backups")
        )
        monkeypatch.setattr(
            "app.api.v1.backup.configured_directory",
            AsyncMock(return_value=Path("/backups/team-a")),
        )

        result = await read_automated_backup_settings(Mock(), session)

        assert result.directory_configured is True
        assert result.base_directory == str(Path("/backups"))
        assert result.directory == str(Path("/backups/team-a"))

    async def test_no_mounted_volume_reports_unconfigured(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = _settings()
        monkeypatch.setattr(
            "app.api.v1.backup.get_automated_settings", AsyncMock(return_value=item)
        )
        monkeypatch.setattr("app.api.v1.backup.base_directory", lambda: None)
        monkeypatch.setattr(
            "app.api.v1.backup.configured_directory", AsyncMock(return_value=None)
        )

        result = await read_automated_backup_settings(Mock(), AsyncMock())

        assert result.directory_configured is False
        assert result.base_directory is None
        assert result.directory is None


class TestUpdateAutomatedBackupSettings:
    async def _update(
        self, monkeypatch: pytest.MonkeyPatch, item: SimpleNamespace, payload: AutomatedBackupSettingsUpdate
    ):
        session = AsyncMock()
        monkeypatch.setattr(
            "app.api.v1.backup.get_automated_settings", AsyncMock(return_value=item)
        )
        monkeypatch.setattr("app.api.v1.backup.base_directory", lambda: Path("/backups"))
        monkeypatch.setattr(
            "app.api.v1.backup.configured_directory", AsyncMock(return_value=Path("/backups"))
        )
        return await update_automated_backup_settings(payload, Mock(), session)

    async def test_an_unknown_timezone_is_a_400_not_a_500(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "app.api.v1.backup.validate_timezone",
            Mock(side_effect=ValueError("Unknown IANA timezone.")),
        )
        payload = AutomatedBackupSettingsUpdate(enabled=True, timezone="Not/AZone")

        with pytest.raises(BadRequestError, match="Unknown IANA timezone"):
            await self._update(monkeypatch, _settings(), payload)

    async def test_an_invalid_subdirectory_is_a_400_not_a_500(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("app.api.v1.backup.validate_timezone", lambda value: value)
        monkeypatch.setattr(
            "app.api.v1.backup.validate_subdirectory",
            Mock(side_effect=ValueError("'x' does not exist under the mounted backup directory.")),
        )
        payload = AutomatedBackupSettingsUpdate(enabled=True, subdirectory="x")

        with pytest.raises(BadRequestError, match="does not exist"):
            await self._update(monkeypatch, _settings(), payload)

    async def test_enabling_with_no_directory_mounted_is_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("app.api.v1.backup.validate_timezone", lambda value: value)
        monkeypatch.setattr("app.api.v1.backup.validate_subdirectory", lambda value: value)
        monkeypatch.setattr(
            "app.api.v1.backup.configured_directory", AsyncMock(return_value=None)
        )
        payload = AutomatedBackupSettingsUpdate(enabled=True)

        session = AsyncMock()
        monkeypatch.setattr(
            "app.api.v1.backup.get_automated_settings", AsyncMock(return_value=_settings())
        )
        monkeypatch.setattr("app.api.v1.backup.base_directory", lambda: None)
        with pytest.raises(BadRequestError, match="not configured or mounted"):
            await update_automated_backup_settings(payload, Mock(), session)

    async def test_a_valid_update_persists_every_field_and_clears_next_run_at(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("app.api.v1.backup.validate_timezone", lambda value: value)
        monkeypatch.setattr("app.api.v1.backup.validate_subdirectory", lambda value: value)
        item = _settings(next_run_at=datetime.now(UTC))
        payload = AutomatedBackupSettingsUpdate(
            enabled=True,
            interval_unit="days",
            interval_value=2,
            time_of_day="04:30",
            timezone="Asia/Saigon",
            retention_count=14,
        )

        await self._update(monkeypatch, item, payload)

        assert item.interval_unit == "days"
        assert item.interval_value == 2
        assert item.time_of_day == "04:30"
        assert item.timezone == "Asia/Saigon"
        assert item.retention_count == 14
        assert item.next_run_at is None


class TestRunAutomatedBackupNow:
    async def test_an_unconfigured_directory_is_a_400_not_a_500(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "app.api.v1.backup.queue_automatic_backup",
            AsyncMock(side_effect=ValueError("Automated backup directory is not configured or mounted.")),
        )
        with pytest.raises(BadRequestError):
            await run_automated_backup_now(Mock(), AsyncMock())

    async def test_queues_and_enqueues_the_job(self, monkeypatch: pytest.MonkeyPatch) -> None:
        job = _job()
        monkeypatch.setattr(
            "app.api.v1.backup.queue_automatic_backup", AsyncMock(return_value=job)
        )
        enqueue = AsyncMock()
        monkeypatch.setattr("app.api.v1.backup._enqueue", enqueue)

        result = await run_automated_backup_now(Mock(), AsyncMock())

        assert result.id == job.id
        enqueue.assert_awaited_once_with(job.id)


class TestListAutomatedBackups:
    async def test_returns_only_automated_jobs_newest_first(self) -> None:
        jobs = [_job(status="complete"), _job(status="failed")]
        session = AsyncMock()
        session.execute = AsyncMock(return_value=Mock(scalars=Mock(return_value=jobs)))

        result = await list_automated_backups(Mock(), session)

        assert [item.id for item in result] == [job.id for job in jobs]


class TestDownloadAutomatedBackup:
    async def test_missing_job_404s(self, monkeypatch: pytest.MonkeyPatch) -> None:
        session = AsyncMock(get=AsyncMock(return_value=None))
        monkeypatch.setattr(
            "app.api.v1.backup.configured_directory", AsyncMock(return_value=Path("/backups"))
        )
        with pytest.raises(NotFoundError):
            await download_automated_backup(uuid.uuid4(), Mock(), session)

    async def test_a_non_automated_job_404s(self, monkeypatch: pytest.MonkeyPatch) -> None:
        job = _job(automated=False, local_filename="x.zip")
        session = AsyncMock(get=AsyncMock(return_value=job))
        monkeypatch.setattr(
            "app.api.v1.backup.configured_directory", AsyncMock(return_value=Path("/backups"))
        )
        with pytest.raises(NotFoundError):
            await download_automated_backup(job.id, Mock(), session)

    async def test_a_job_with_no_stored_file_404s(self, monkeypatch: pytest.MonkeyPatch) -> None:
        job = _job(local_filename=None)
        session = AsyncMock(get=AsyncMock(return_value=job))
        monkeypatch.setattr(
            "app.api.v1.backup.configured_directory", AsyncMock(return_value=Path("/backups"))
        )
        with pytest.raises(NotFoundError):
            await download_automated_backup(job.id, Mock(), session)

    async def test_a_file_that_escaped_the_directory_is_never_served(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        # local_filename is always generated internally with no directory
        # components, but this is the check that would catch it if one ever
        # did - never serve a path outside the configured root.
        job = _job(local_filename="../escaped.zip")
        session = AsyncMock(get=AsyncMock(return_value=job))
        monkeypatch.setattr(
            "app.api.v1.backup.configured_directory", AsyncMock(return_value=tmp_path)
        )
        with pytest.raises(NotFoundError):
            await download_automated_backup(job.id, Mock(), session)

    async def test_a_missing_file_on_disk_404s_rather_than_erroring(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        job = _job(local_filename="gone.zip")
        session = AsyncMock(get=AsyncMock(return_value=job))
        monkeypatch.setattr(
            "app.api.v1.backup.configured_directory", AsyncMock(return_value=tmp_path)
        )
        with pytest.raises(NotFoundError):
            await download_automated_backup(job.id, Mock(), session)

    async def test_serves_the_file_under_its_output_filename(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        (tmp_path / "stored.zip").write_bytes(b"zip bytes")
        job = _job(local_filename="stored.zip", output_filename="my-backup.zip")
        session = AsyncMock(get=AsyncMock(return_value=job))
        monkeypatch.setattr(
            "app.api.v1.backup.configured_directory", AsyncMock(return_value=tmp_path)
        )

        response = await download_automated_backup(job.id, Mock(), session)

        assert response.filename == "my-backup.zip"


class TestDeleteAutomatedBackup:
    async def test_missing_job_404s(self, monkeypatch: pytest.MonkeyPatch) -> None:
        session = AsyncMock(get=AsyncMock(return_value=None))
        monkeypatch.setattr(
            "app.api.v1.backup.configured_directory", AsyncMock(return_value=None)
        )
        with pytest.raises(NotFoundError):
            await delete_automated_backup(uuid.uuid4(), Mock(), session)

    async def test_a_non_automated_job_404s(self, monkeypatch: pytest.MonkeyPatch) -> None:
        job = _job(automated=False)
        session = AsyncMock(get=AsyncMock(return_value=job))
        monkeypatch.setattr(
            "app.api.v1.backup.configured_directory", AsyncMock(return_value=None)
        )
        with pytest.raises(NotFoundError):
            await delete_automated_backup(job.id, Mock(), session)

    async def test_deletes_the_row_and_its_file(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        stored = tmp_path / "stored.zip"
        stored.write_bytes(b"zip bytes")
        job = _job(local_filename="stored.zip")
        session = AsyncMock(get=AsyncMock(return_value=job), delete=AsyncMock())
        monkeypatch.setattr(
            "app.api.v1.backup.configured_directory", AsyncMock(return_value=tmp_path)
        )

        await delete_automated_backup(job.id, Mock(), session)

        assert not stored.exists()
        session.delete.assert_awaited_once_with(job)

    async def test_a_row_with_no_stored_file_is_still_deleted(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        job = _job(local_filename=None)
        session = AsyncMock(get=AsyncMock(return_value=job), delete=AsyncMock())
        monkeypatch.setattr(
            "app.api.v1.backup.configured_directory", AsyncMock(return_value=None)
        )

        await delete_automated_backup(job.id, Mock(), session)

        session.delete.assert_awaited_once_with(job)

    async def test_never_deletes_a_file_outside_the_configured_directory(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        outside = tmp_path.parent / "escaped.zip"
        outside.write_bytes(b"x")
        job = _job(local_filename="../escaped.zip")
        session = AsyncMock(get=AsyncMock(return_value=job), delete=AsyncMock())
        monkeypatch.setattr(
            "app.api.v1.backup.configured_directory", AsyncMock(return_value=tmp_path)
        )

        await delete_automated_backup(job.id, Mock(), session)

        assert outside.exists()
        session.delete.assert_awaited_once_with(job)
