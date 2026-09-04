from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.backup.automated import (
    base_directory,
    configured_directory,
    next_run_after,
    resolve_backup_directory,
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
