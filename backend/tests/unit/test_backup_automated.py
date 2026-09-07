from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.models.backup_job import AutomatedBackupSettings
from app.modules.backup.automated import (
    apply_retention,
    base_directory,
    configured_directory,
    get_settings,
    next_run_after,
    queue_automatic_backup,
    resolve_backup_directory,
    schedule_due_backup,
    validate_subdirectory,
    validate_timezone,
)
from app.schemas.backup import AutomatedBackupSettingsRead, AutomatedBackupSettingsUpdate


class TestSchemaTimeOfDayPattern:
    """Regression coverage for the `time_of_day` pattern.

    It used to be written as ``r"...\\\\d..."`` - a *doubled* backslash - which
    a raw string turns into the two literal characters ``\\`` and ``d``
    instead of the digit metacharacter ``\\d``. That pattern then rejected
    every legal time, including the field's own default, and crashed every
    read of the automatic-backup settings with a 500 (see the admin Backup
    page's "Automatic backups" panel, which read "An unexpected error
    occurred.").
    """

    def _read(self, **overrides: object) -> AutomatedBackupSettingsRead:
        return AutomatedBackupSettingsRead(
            enabled=False,
            directory_configured=True,
            **{"time_of_day": "02:00", **overrides},
        )

    def test_default_time_of_day_is_accepted(self) -> None:
        # This alone reproduces the crash: constructing the response model
        # with nothing but its own field defaults used to raise.
        assert self._read().time_of_day == "02:00"

    @pytest.mark.parametrize("value", ["00:00", "09:05", "13:45", "23:59"])
    def test_valid_times_are_accepted(self, value: str) -> None:
        assert self._read(time_of_day=value).time_of_day == value

    @pytest.mark.parametrize(
        "value",
        [
            "24:00",  # hour out of range
            "12:60",  # minute out of range
            "9:30",  # missing leading zero
            "12:5",  # missing leading zero on minutes
            "noon",
        ],
    )
    def test_invalid_times_are_rejected(self, value: str) -> None:
        with pytest.raises(ValueError, match="time_of_day"):
            self._read(time_of_day=value)

    def test_update_schema_shares_the_same_pattern(self) -> None:
        # AutomatedBackupSettingsRead extends Update - covering both directly
        # guards against a future edit that only fixes one of the two.
        assert AutomatedBackupSettingsUpdate(enabled=True, time_of_day="02:00").time_of_day == "02:00"
        with pytest.raises(ValueError):
            AutomatedBackupSettingsUpdate(enabled=True, time_of_day="2:00")

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("3:00 PM", "15:00"),
            ("03:00 PM", "15:00"),
            ("3:00PM", "15:00"),
            ("12:00 AM", "00:00"),
            ("12:00 PM", "12:00"),
            ("3:00:00 PM", "15:00"),
            (" 3:00 PM ", "15:00"),
        ],
    )
    def test_a_12_hour_time_with_am_pm_is_normalised(self, value: str, expected: str) -> None:
        # Regression: a native <input type="time"> is specified to always
        # report 24-hour "HH:MM", but some browsers hand back a localised
        # 12-hour string instead - saving the schedule then failed the
        # pattern check with an opaque "request payload is invalid".
        assert AutomatedBackupSettingsUpdate(enabled=True, time_of_day=value).time_of_day == expected

    def test_normalisation_does_not_loosen_the_24_hour_pattern(self) -> None:
        # "9:30" (missing leading zero) must stay rejected - it must not be
        # quietly accepted just because the AM/PM recovery path exists.
        with pytest.raises(ValueError, match="time_of_day"):
            AutomatedBackupSettingsUpdate(enabled=True, time_of_day="9:30")

    def test_a_non_string_value_passes_through_untouched(self) -> None:
        # The BeforeValidator runs ahead of pydantic's own str coercion, so a
        # non-string payload (None here) must fall straight through rather
        # than being fed to str.strip()/strptime - leaving pydantic's normal
        # type error, not a validator crash, as the reported failure.
        with pytest.raises(ValueError, match="time_of_day"):
            AutomatedBackupSettingsUpdate(enabled=True, time_of_day=None)


class TestNextRunAfter:
    def test_hourly_interval_adds_hours_from_reference(self) -> None:
        reference = datetime(2026, 1, 1, 10, 0, tzinfo=UTC)
        result = next_run_after(3, "hours", "02:00", "UTC", reference)
        assert result == datetime(2026, 1, 1, 13, 0, tzinfo=UTC)

    def test_daily_interval_uses_todays_time_of_day_when_still_ahead(self) -> None:
        reference = datetime(2026, 1, 1, 1, 0, tzinfo=UTC)  # before 02:00
        result = next_run_after(1, "days", "02:00", "UTC", reference)
        assert result == datetime(2026, 1, 1, 2, 0, tzinfo=UTC)

    def test_daily_interval_rolls_over_when_todays_time_has_passed(self) -> None:
        reference = datetime(2026, 1, 1, 5, 0, tzinfo=UTC)  # after 02:00
        result = next_run_after(1, "days", "02:00", "UTC", reference)
        assert result == datetime(2026, 1, 2, 2, 0, tzinfo=UTC)

    def test_daily_interval_respects_a_multi_day_cadence(self) -> None:
        reference = datetime(2026, 1, 1, 5, 0, tzinfo=UTC)
        result = next_run_after(7, "days", "02:00", "UTC", reference)
        assert result == datetime(2026, 1, 8, 2, 0, tzinfo=UTC)

    def test_result_converts_local_time_of_day_back_to_utc(self) -> None:
        # Reference is 07:00 in Ho Chi Minh City (UTC+7) - already past
        # 02:00 local, so the next run is 02:00 local the *following* day,
        # i.e. 19:00 UTC the day of the reference.
        reference = datetime(2026, 1, 1, 0, 0, tzinfo=UTC)
        result = next_run_after(1, "days", "02:00", "Asia/Ho_Chi_Minh", reference)
        assert result == datetime(2026, 1, 1, 19, 0, tzinfo=UTC)


class TestValidateTimezone:
    def test_accepts_a_known_iana_zone(self) -> None:
        assert validate_timezone("Asia/Ho_Chi_Minh") == "Asia/Ho_Chi_Minh"

    def test_rejects_an_unknown_zone(self) -> None:
        with pytest.raises(ValueError, match="Unknown IANA timezone"):
            validate_timezone("Not/AZone")


class TestResolveBackupDirectory:
    """`resolve_backup_directory`: the mounted root, optionally narrowed to
    an admin-chosen subdirectory - and the one place that turns an
    admin-typed string into an actual filesystem path.
    """

    def test_no_subdirectory_resolves_to_the_root_itself(self, tmp_path: Path) -> None:
        assert resolve_backup_directory(tmp_path, None) == tmp_path
        assert resolve_backup_directory(tmp_path, "") == tmp_path

    def test_an_existing_subdirectory_resolves_under_the_root(self, tmp_path: Path) -> None:
        (tmp_path / "team-a").mkdir()
        assert resolve_backup_directory(tmp_path, "team-a") == tmp_path / "team-a"

    def test_a_nested_existing_subdirectory_is_fine(self, tmp_path: Path) -> None:
        (tmp_path / "team-a" / "2026").mkdir(parents=True)
        assert resolve_backup_directory(tmp_path, "team-a/2026") == tmp_path / "team-a" / "2026"

    def test_a_missing_subdirectory_is_none(self, tmp_path: Path) -> None:
        # "must already exist" - same rule the root itself has always had,
        # not something this function creates on the admin's behalf.
        assert resolve_backup_directory(tmp_path, "does-not-exist") is None

    def test_a_subdirectory_that_is_actually_a_file_is_none(self, tmp_path: Path) -> None:
        (tmp_path / "not-a-dir").write_text("x")
        assert resolve_backup_directory(tmp_path, "not-a-dir") is None

    def test_a_path_traversal_attempt_is_rejected_even_if_it_exists(
        self, tmp_path: Path
    ) -> None:
        # A real directory one level above the root - reachable with "..",
        # and it does exist, which is exactly why this has to be checked by
        # containment rather than by existence alone.
        outside = tmp_path.parent / "escaped-directory"
        outside.mkdir(exist_ok=True)
        try:
            root = tmp_path / "root"
            root.mkdir()
            assert resolve_backup_directory(root, "../escaped-directory") is None
        finally:
            outside.rmdir()

    def test_an_absolute_path_outside_the_root_is_rejected(self, tmp_path: Path) -> None:
        # An absolute right-hand side makes `pathlib`'s `/` operator discard
        # the left side entirely (`Path("/a") / "/b" == Path("/b")`), so an
        # absolute `subdirectory` has to be caught by the containment check,
        # not by the join silently doing the wrong thing.
        root = tmp_path / "root"
        root.mkdir()
        outside = tmp_path / "outside-the-root"
        outside.mkdir()
        assert resolve_backup_directory(root, str(outside)) is None


class TestValidateSubdirectory:
    """`validate_subdirectory`: the Save-time gate in front of the above -
    raises instead of returning `None`, with a message the admin who typed
    the path can actually act on.
    """

    def test_blank_input_normalises_to_none(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.setattr(
            "app.modules.backup.automated.settings.automated_backup_directory",
            str(tmp_path),
        )
        assert validate_subdirectory(None) is None
        assert validate_subdirectory("") is None
        assert validate_subdirectory("   ") is None

    def test_surrounding_slashes_are_stripped(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        (tmp_path / "team-a").mkdir()
        monkeypatch.setattr(
            "app.modules.backup.automated.settings.automated_backup_directory",
            str(tmp_path),
        )
        assert validate_subdirectory("/team-a/") == "team-a"

    def test_an_existing_directory_is_accepted(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        (tmp_path / "team-a").mkdir()
        monkeypatch.setattr(
            "app.modules.backup.automated.settings.automated_backup_directory",
            str(tmp_path),
        )
        assert validate_subdirectory("team-a") == "team-a"

    def test_a_missing_directory_is_rejected_with_a_actionable_message(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.setattr(
            "app.modules.backup.automated.settings.automated_backup_directory",
            str(tmp_path),
        )
        with pytest.raises(ValueError, match="does not exist"):
            validate_subdirectory("nope")

    def test_a_traversal_attempt_is_rejected(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.setattr(
            "app.modules.backup.automated.settings.automated_backup_directory",
            str(tmp_path),
        )
        with pytest.raises(ValueError, match="escapes it"):
            validate_subdirectory("../")

    def test_an_unmounted_root_is_not_this_functions_problem_to_report(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # `base_directory()` already reports "not configured" on save via the
        # existing `directory_configured` check - this only has to not crash
        # or reject a value that might turn out fine once the root exists.
        monkeypatch.setattr(
            "app.modules.backup.automated.settings.automated_backup_directory", ""
        )
        assert base_directory() is None
        assert validate_subdirectory("team-a") == "team-a"


class TestConfiguredDirectory:
    """`configured_directory`: what a scheduled backup actually reads from
    and writes to right now - the root, combined with whatever subdirectory
    is saved in `AutomatedBackupSettings`."""

    @pytest.mark.asyncio
    async def test_combines_the_root_with_the_saved_subdirectory(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        (tmp_path / "team-a").mkdir()
        monkeypatch.setattr(
            "app.modules.backup.automated.settings.automated_backup_directory",
            str(tmp_path),
        )
        session = AsyncMock()
        session.get = AsyncMock(return_value=SimpleNamespace(subdirectory="team-a"))

        assert await configured_directory(session) == tmp_path / "team-a"

    @pytest.mark.asyncio
    async def test_no_saved_subdirectory_is_the_root_itself(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.setattr(
            "app.modules.backup.automated.settings.automated_backup_directory",
            str(tmp_path),
        )
        session = AsyncMock()
        session.get = AsyncMock(return_value=SimpleNamespace(subdirectory=None))

        assert await configured_directory(session) == tmp_path

    @pytest.mark.asyncio
    async def test_no_mounted_root_at_all_is_unconfigured_without_reading_settings(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "app.modules.backup.automated.settings.automated_backup_directory", None
        )
        session = AsyncMock()

        assert await configured_directory(session) is None
        # Nothing saved in the database can matter when there is no volume
        # mounted to resolve it against in the first place.
        session.get.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_subdirectory_deleted_after_being_saved_is_reported_unconfigured(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        # Nothing stops an operator from `rm -rf`-ing a folder WikiHub does
        # not own. A scheduled run must fail loudly rather than fall back to
        # writing into the root the admin deliberately moved backups out of.
        monkeypatch.setattr(
            "app.modules.backup.automated.settings.automated_backup_directory",
            str(tmp_path),
        )
        session = AsyncMock()
        session.get = AsyncMock(
            return_value=SimpleNamespace(subdirectory="deleted-after-save")
        )

        assert await configured_directory(session) is None


class TestGetSettings:
    """The one settings row (id=1) is created lazily on first read - there is
    no seed migration for it, so a fresh instance has no row at all yet."""

    @pytest.mark.asyncio
    async def test_creates_the_row_when_none_exists_yet(self) -> None:
        session = AsyncMock()
        session.get = AsyncMock(return_value=None)

        item = await get_settings(session)

        assert isinstance(item, AutomatedBackupSettings)
        assert item.id == 1
        session.add.assert_called_once_with(item)
        session.flush.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_returns_the_existing_row_without_creating_another(self) -> None:
        existing = SimpleNamespace(id=1)
        session = AsyncMock()
        session.get = AsyncMock(return_value=existing)

        item = await get_settings(session)

        assert item is existing
        session.add.assert_not_called()


class TestQueueAutomaticBackup:
    """What "Run now" and the scheduler both call to actually start a run."""

    @pytest.mark.asyncio
    async def test_raises_when_no_directory_is_configured(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "app.modules.backup.automated.configured_directory",
            AsyncMock(return_value=None),
        )

        with pytest.raises(ValueError, match="not configured or mounted"):
            await queue_automatic_backup(AsyncMock())

    @pytest.mark.asyncio
    async def test_an_already_running_job_is_returned_instead_of_starting_a_second_one(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.setattr(
            "app.modules.backup.automated.configured_directory",
            AsyncMock(return_value=tmp_path),
        )
        active_job = SimpleNamespace(id="already-running")
        session = AsyncMock()
        session.execute = AsyncMock(
            return_value=SimpleNamespace(scalar_one_or_none=lambda: active_job)
        )
        create = AsyncMock()
        monkeypatch.setattr("app.modules.backup.automated.create_export_job", create)

        result = await queue_automatic_backup(session)

        assert result is active_job
        create.assert_not_called()

    @pytest.mark.asyncio
    async def test_creates_a_job_and_schedules_the_next_run(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.setattr(
            "app.modules.backup.automated.configured_directory",
            AsyncMock(return_value=tmp_path),
        )
        session = AsyncMock()
        session.execute = AsyncMock(
            return_value=SimpleNamespace(scalar_one_or_none=lambda: None)
        )
        item = SimpleNamespace(
            interval_value=1,
            interval_unit="hours",
            time_of_day="03:00",
            timezone="UTC",
            last_run_at=None,
            last_status=None,
            last_error="a previous run's error",
            next_run_at=None,
        )
        monkeypatch.setattr(
            "app.modules.backup.automated.get_settings", AsyncMock(return_value=item)
        )
        new_job = SimpleNamespace(id="new-job")
        create = AsyncMock(return_value=new_job)
        monkeypatch.setattr("app.modules.backup.automated.create_export_job", create)
        reference = datetime(2026, 1, 1, tzinfo=UTC)

        result = await queue_automatic_backup(session, now=reference)

        assert result is new_job
        create.assert_awaited_once_with(
            session,
            actor_id=None,
            kind="full_export",
            include_credentials=True,
            automated=True,
        )
        assert item.last_run_at == reference
        assert item.last_status == "queued"
        # A stale error from a previous failed run must not still be showing
        # once a new run has been queued.
        assert item.last_error is None
        assert item.next_run_at == reference + timedelta(hours=1)
        session.commit.assert_awaited_once()


class TestScheduleDueBackup:
    """The poller: decides whether it is time to call `queue_automatic_backup`."""

    @pytest.mark.asyncio
    async def test_a_disabled_schedule_does_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "app.modules.backup.automated.get_settings",
            AsyncMock(return_value=SimpleNamespace(enabled=False)),
        )
        queue = AsyncMock()
        monkeypatch.setattr("app.modules.backup.automated.queue_automatic_backup", queue)

        assert await schedule_due_backup(AsyncMock()) is None
        queue.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_schedule_with_no_next_run_yet_gets_one_without_queuing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A freshly-enabled schedule has never computed a `next_run_at` - this
        # is what gives it its first one, on the *next* poll's due check
        # rather than firing a backup the moment it is turned on.
        item = SimpleNamespace(
            enabled=True,
            next_run_at=None,
            interval_value=1,
            interval_unit="hours",
            time_of_day="03:00",
            timezone="UTC",
        )
        monkeypatch.setattr(
            "app.modules.backup.automated.get_settings", AsyncMock(return_value=item)
        )
        queue = AsyncMock()
        monkeypatch.setattr("app.modules.backup.automated.queue_automatic_backup", queue)
        session = AsyncMock()
        reference = datetime(2026, 1, 1, tzinfo=UTC)

        result = await schedule_due_backup(session, now=reference)

        assert result is None
        assert item.next_run_at is not None
        session.commit.assert_awaited_once()
        queue.assert_not_called()

    @pytest.mark.asyncio
    async def test_not_due_yet_does_nothing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        reference = datetime(2026, 1, 1, tzinfo=UTC)
        item = SimpleNamespace(enabled=True, next_run_at=reference + timedelta(hours=1))
        monkeypatch.setattr(
            "app.modules.backup.automated.get_settings", AsyncMock(return_value=item)
        )
        queue = AsyncMock()
        monkeypatch.setattr("app.modules.backup.automated.queue_automatic_backup", queue)

        result = await schedule_due_backup(AsyncMock(), now=reference)

        assert result is None
        queue.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_due_schedule_queues_a_backup(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        reference = datetime(2026, 1, 1, tzinfo=UTC)
        item = SimpleNamespace(enabled=True, next_run_at=reference - timedelta(seconds=1))
        monkeypatch.setattr(
            "app.modules.backup.automated.get_settings", AsyncMock(return_value=item)
        )
        new_job = SimpleNamespace(id="queued")
        queue = AsyncMock(return_value=new_job)
        monkeypatch.setattr("app.modules.backup.automated.queue_automatic_backup", queue)
        session = AsyncMock()

        result = await schedule_due_backup(session, now=reference)

        assert result is new_job
        queue.assert_awaited_once_with(session, now=reference)


class TestApplyRetention:
    """Deletes the archive files of completed automated runs beyond the
    admin's configured "keep" count - never the DB rows themselves, which is
    why only `local_filename` gets cleared rather than the job deleted."""

    @pytest.mark.asyncio
    async def test_does_nothing_when_no_directory_is_configured(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "app.modules.backup.automated.configured_directory",
            AsyncMock(return_value=None),
        )
        session = AsyncMock()

        await apply_retention(session, keep=5)

        session.execute.assert_not_called()
        session.commit.assert_not_called()

    @pytest.mark.asyncio
    async def test_deletes_files_beyond_the_keep_count(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.setattr(
            "app.modules.backup.automated.configured_directory",
            AsyncMock(return_value=tmp_path),
        )
        kept_file = tmp_path / "kept.zip"
        kept_file.write_bytes(b"x")
        pruned_file = tmp_path / "pruned.zip"
        pruned_file.write_bytes(b"x")
        kept = SimpleNamespace(local_filename="kept.zip")
        pruned = SimpleNamespace(local_filename="pruned.zip")
        session = AsyncMock()
        # Newest-first, same as the query itself orders by - `kept` is the one
        # single completed run inside the retention window.
        session.execute = AsyncMock(
            return_value=SimpleNamespace(scalars=lambda: [kept, pruned])
        )

        await apply_retention(session, keep=1)

        assert kept_file.exists()
        assert kept.local_filename == "kept.zip"
        assert not pruned_file.exists()
        assert pruned.local_filename is None
        session.commit.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_a_job_with_no_stored_filename_is_left_alone(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        # Already pruned by an earlier retention pass (or never wrote a file
        # to begin with) - re-processing it a second time must not raise.
        monkeypatch.setattr(
            "app.modules.backup.automated.configured_directory",
            AsyncMock(return_value=tmp_path),
        )
        job = SimpleNamespace(local_filename=None)
        session = AsyncMock()
        session.execute = AsyncMock(return_value=SimpleNamespace(scalars=lambda: [job]))

        await apply_retention(session, keep=0)

        assert job.local_filename is None
        session.commit.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_never_deletes_a_file_outside_the_configured_directory(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        # `local_filename` is always generated internally with no directory
        # components, but the check exists anyway so a value that somehow
        # escapes the configured directory is never the thing unlinked.
        monkeypatch.setattr(
            "app.modules.backup.automated.configured_directory",
            AsyncMock(return_value=tmp_path),
        )
        outside = tmp_path.parent / "outside.zip"
        outside.write_bytes(b"x")
        job = SimpleNamespace(local_filename="../outside.zip")
        session = AsyncMock()
        session.execute = AsyncMock(return_value=SimpleNamespace(scalars=lambda: [job]))

        await apply_retention(session, keep=0)

        assert outside.exists()
        # Cleared regardless - the row must stop pointing at a file this pass
        # decided (correctly) not to touch.
        assert job.local_filename is None
