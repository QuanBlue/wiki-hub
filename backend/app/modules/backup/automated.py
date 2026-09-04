"""Scheduling and retention for host-mounted automatic backups."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.backup_job import AutomatedBackupSettings, BackupJob
from app.modules.backup.jobs import create_export_job


def next_run_after(value: int, unit: str, time_of_day: str, timezone: str, reference: datetime) -> datetime:
    """Return the first scheduled instant strictly after ``reference`` in UTC."""
    zone = ZoneInfo(timezone)
    local = reference.astimezone(zone)
    hour, minute = map(int, time_of_day.split(":"))
    if unit == "hours":
        return (reference + timedelta(hours=value)).astimezone(UTC)
    candidate = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= local:
        candidate += timedelta(days=value)
    return candidate.astimezone(UTC)


async def get_settings(session: AsyncSession) -> AutomatedBackupSettings:
    item = await session.get(AutomatedBackupSettings, 1)
    if item is None:
        item = AutomatedBackupSettings(id=1)
        session.add(item)
        await session.flush()
    return item


def base_directory() -> Path | None:
    """The host-mounted root every automated backup must stay inside.

    Fixed at deploy time (`WIKIHUB_AUTOMATED_BACKUP_DIRECTORY`, the container
    side of a docker-compose volume mount) - unlike `AutomatedBackupSettings
    .subdirectory`, there is no way to repoint this from a running container
    without remounting a new volume and restarting, so it is not something an
    admin picks through the API.
    """
    if not settings.automated_backup_directory:
        return None
    path = Path(settings.automated_backup_directory)
    return path if path.is_dir() else None


def resolve_backup_directory(base: Path, subdirectory: str | None) -> Path | None:
    """`base`, optionally narrowed to an admin-chosen subdirectory under it.

    `subdirectory` is untrusted admin input, so this rejects anything that
    would resolve outside `base` (an absolute path, a `..` segment, a symlink
    that escapes it) by returning `None` rather than silently clamping it to
    `base` - a silent clamp would start writing backups somewhere the admin
    did not ask for, with nothing on screen to explain why. Returns `None`
    too when the resolved directory does not exist: the admin is expected to
    create it under the mounted volume first, the same "must already exist"
    rule `base` itself has always had.
    """
    if not subdirectory:
        return base
    resolved_base = base.resolve()
    candidate = (resolved_base / subdirectory).resolve()
    try:
        candidate.relative_to(resolved_base)
    except ValueError:
        return None
    return candidate if candidate.is_dir() else None


async def configured_directory(session: AsyncSession) -> Path | None:
    """The actual directory automated backups read from / write to right now."""
    base = base_directory()
    if base is None:
        return None
    item = await get_settings(session)
    return resolve_backup_directory(base, item.subdirectory)


async def queue_automatic_backup(session: AsyncSession, *, now: datetime | None = None) -> BackupJob:
    directory = await configured_directory(session)
    if directory is None:
        raise ValueError("Automated backup directory is not configured or mounted.")
    active = (await session.execute(select(BackupJob).where(BackupJob.automated.is_(True), BackupJob.status.in_(["queued", "running"])).limit(1))).scalar_one_or_none()
    if active is not None:
        return active
    item = await get_settings(session)
    job = await create_export_job(session, actor_id=None, kind="full_export", include_credentials=True, automated=True)
    reference = now or datetime.now(UTC)
    item.last_run_at = reference
    item.last_status = "queued"
    item.last_error = None
    item.next_run_at = next_run_after(item.interval_value, item.interval_unit, item.time_of_day, item.timezone, reference)
    await session.commit()
    return job


async def schedule_due_backup(session: AsyncSession, *, now: datetime | None = None) -> BackupJob | None:
    item = await get_settings(session)
    reference = now or datetime.now(UTC)
    if not item.enabled:
        return None
    if item.next_run_at is None:
        item.next_run_at = next_run_after(item.interval_value, item.interval_unit, item.time_of_day, item.timezone, reference - timedelta(seconds=1))
        await session.commit()
        return None
    if item.next_run_at > reference:
        return None
    return await queue_automatic_backup(session, now=reference)


async def apply_retention(session: AsyncSession, *, keep: int) -> None:
    directory = await configured_directory(session)
    if directory is None:
        return
    completed = list((await session.execute(select(BackupJob).where(BackupJob.automated.is_(True), BackupJob.status == "complete").order_by(BackupJob.created_at.desc()))).scalars())
    for job in completed[keep:]:
        if job.local_filename:
            target = directory / job.local_filename
            # Filename is generated by us and has no directory components.
            if target.parent == directory:
                target.unlink(missing_ok=True)
        job.local_filename = None
    await session.commit()


def validate_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except ZoneInfoNotFoundError as exc:
        raise ValueError("Unknown IANA timezone.") from exc
    return value


def validate_subdirectory(value: str | None) -> str | None:
    """Reject an admin-typed subdirectory before it is ever saved.

    Existence is checked here too, not only when a backup later runs: saving
    a path that turns out to be wrong should fail at Save, in front of the
    admin who typed it, rather than surface hours later as a failed
    scheduled run nobody was watching for.
    """
    value = (value or "").strip().strip("/")
    if not value:
        return None
    base = base_directory()
    if base is None:
        # The root itself is unmounted - `resolve_backup_directory` would
        # report the same "not configured" failure regardless of this value,
        # so there is nothing meaningful to validate it against yet.
        return value
    if resolve_backup_directory(base, value) is None:
        raise ValueError(
            f"'{value}' does not exist under the mounted backup directory, "
            "or escapes it. Create the folder there first."
        )
    return value
