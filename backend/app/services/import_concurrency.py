"""One workspace-writing import at a time.

A Confluence import and a WikiHub restore both create `Space`, `WikiPage` and
`PageAttachment` rows, and an overwrite restore additionally deletes a space's
pages outright.  The worker runs several jobs at once (`max_jobs`), so without
this guard the two can interleave on the same rows - a restore deleting pages
an import is still writing, or both racing to create the same space key.

Only *applying* is guarded.  Uploading and scanning an archive touch nothing
but object storage, and must stay available so a large upload can be staged
(and resumed) while something else finishes.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError
from app.models.backup_job import BackupJob
from app.models.import_job import ImportJob

#: Statuses that mean a job still holds the workspace. The two tables spell
#: their terminal states differently (`ImportJob` finishes as "completed",
#: `BackupJob` as "complete"), so match on the active set instead - it is the
#: same in both and cannot drift into a false negative if a new terminal
#: status is ever added.
ACTIVE_JOB_STATUSES = ("queued", "running")


async def assert_no_active_confluence_import(session: AsyncSession) -> None:
    """Raise if a Confluence import is queued or running."""
    running = (
        await session.execute(
            select(ImportJob.id).where(ImportJob.status.in_(ACTIVE_JOB_STATUSES)).limit(1)
        )
    ).first()
    if running is not None:
        raise ConflictError(
            "A Confluence import is still running. Wait for it to finish, or "
            "cancel it, before restoring a WikiHub backup.",
            code="import_already_running",
        )


async def assert_no_active_wikihub_restore(session: AsyncSession) -> None:
    """Raise if a WikiHub restore is queued or running."""
    running = (
        await session.execute(
            select(BackupJob.id)
            .where(
                BackupJob.kind == "full_import",
                BackupJob.status.in_(ACTIVE_JOB_STATUSES),
            )
            .limit(1)
        )
    ).first()
    if running is not None:
        raise ConflictError(
            "A WikiHub restore is still running. Wait for it to finish, or "
            "cancel it, before importing a Confluence archive.",
            code="restore_already_running",
        )
