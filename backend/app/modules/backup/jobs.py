"""Durable background export jobs for portable backup artifacts."""

from __future__ import annotations

import os
import tempfile
import uuid
from contextlib import suppress
from datetime import UTC, datetime
from typing import BinaryIO

import anyio
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attachment import PageAttachment
from app.models.backup_job import BackupArchive, BackupJob
from app.models.page import WikiPage
from app.models.space import Space
from app.modules.backup.confluence_export import CONFLUENCE_DC_PROFILES, write_confluence_dc_export
from app.modules.backup.service import (
    STALE_JOB_AFTER,
    BackupService,
    ExportCancelled,
    checkpoint_backup_job,
)
from app.services.storage import ObjectStorage


def _open_for_read(path: str) -> BinaryIO:
    """Dispatched to a worker thread; the returned handle is then passed
    straight to `ObjectStorage.put()` so the finished archive is streamed to
    storage rather than read into a `bytes` object first - a multi-GB export
    would otherwise double its own on-disk size in RAM just to upload it,
    right on the heels of the streaming write that avoided exactly that."""
    return open(path, "rb")


async def create_export_job(
    session: AsyncSession,
    *,
    actor_id: uuid.UUID,
    kind: str,
    include_credentials: bool = False,
    confluence_profile: str | None = None,
    space_keys: list[str] | None = None,
) -> BackupJob:
    if kind not in {"full_export", "confluence_export"}:
        raise ValueError("Unknown backup export type.")
    if kind == "confluence_export" and confluence_profile not in CONFLUENCE_DC_PROFILES:
        raise ValueError("A Confluence Data Center compatibility profile is required.")
    if kind == "full_export" and space_keys:
        existing = set(
            (
                await session.execute(select(Space.key).where(Space.key.in_(space_keys)))
            ).scalars()
        )
        unknown = sorted(set(space_keys) - existing)
        if unknown:
            raise ValueError(f"Unknown space key(s): {', '.join(unknown)}")
    job = BackupJob(
        kind=kind,
        created_by_id=actor_id,
        include_credentials=include_credentials if kind == "full_export" else False,
        confluence_profile=confluence_profile,
        space_keys=space_keys or [],
        status="queued",
        phase="queued",
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return job


async def create_import_job(
    session: AsyncSession,
    *,
    actor_id: uuid.UUID,
    archive_id: uuid.UUID,
    overwrite_space_keys: list[str] | None = None,
    space_keys: list[str] | None = None,
) -> BackupJob:
    """Queue a restore of an already-uploaded `BackupArchive`.

    Deliberately separate from `create_export_job`: its validation
    (`confluence_profile` required, `space_keys` checked against *existing*
    spaces) does not apply here - a restore's `space_keys` scope the archive's
    *own* declared spaces, most of which are expected not to exist yet, and
    there is no Confluence-profile concept on this side at all.
    """
    archive = await session.get(BackupArchive, archive_id)
    if archive is None:
        raise ValueError("Unknown backup archive.")
    if archive.status not in {"uploaded", "scanned"}:
        raise ValueError("This archive has not finished uploading yet.")
    job = BackupJob(
        kind="full_import",
        created_by_id=actor_id,
        archive_id=archive_id,
        space_keys=space_keys or [],
        overwrite_space_keys=overwrite_space_keys or [],
        status="queued",
        phase="queued",
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return job


async def reap_abandoned_export_jobs(
    session: AsyncSession, *, every_running_job: bool = False
) -> int:
    """Finalise "running" jobs whose worker died, and report how many.

    Without this a job outlives the worker that owned it: the row still says
    running, no process is advancing it, and `cancel_requested` has nobody
    left to observe it - so the admin UI shows a progress bar that never ends
    and a Cancel button that appears to do nothing. Workers die routinely
    (deploys, container restarts, `arq --watch` reloads), so this has to be
    automatic rather than an operator chore.

    A stale heartbeat is the signal. Cancellation still wins where it was
    requested, so a job the operator cancelled is reported as cancelled rather
    than as a failure they did not cause.

    ``every_running_job`` widens that to *all* running rows, and is only
    correct from a worker's own startup: a worker that has just come up is
    running nothing, so anything still marked running was left behind by the
    process it replaced - no need to wait out a heartbeat timeout to say so.
    It assumes the single worker this stack deploys; with several replicas a
    starting worker would be finalising its peers' live jobs, so that path
    must stay startup-only and the scheduled sweep keeps using the heartbeat.
    """
    query = select(BackupJob).where(BackupJob.status == "running")
    if not every_running_job:
        cutoff = datetime.now(UTC) - STALE_JOB_AFTER
        query = query.where(
            or_(BackupJob.heartbeat_at.is_(None), BackupJob.heartbeat_at < cutoff)
        )
    abandoned = (await session.execute(query)).scalars().all()
    for job in abandoned:
        if job.cancel_requested:
            job.status, job.phase = "cancelled", "cancelled"
        else:
            job.status, job.phase = "failed", "failed"
            job.error = "The export worker stopped before this job finished."
    if abandoned:
        await session.commit()
    return len(abandoned)


#: Throttles how often a restore's archive-download phase checkpoints, the
#: same way `_PROGRESS_CHECK_EVERY` throttles item-based checkpoints during
#: export/restore-apply - `download_to_file`'s callback fires once per 8MB
#: chunk, so a 15GB archive would otherwise checkpoint (refresh + commit)
#: roughly 1900 times.
_DOWNLOAD_PROGRESS_EVERY_CHUNKS = 25


async def _run_restore_job(session: AsyncSession, storage: ObjectStorage, job: BackupJob) -> None:
    """Download an already-uploaded `BackupArchive` and apply it as a restore.

    The inverse of the export path below: the input is staged from storage
    instead of the output being uploaded to it, and there is no artifact to
    publish when it finishes - only `job.result`, the completed
    `ImportReport` the old synchronous `/backup/import-zip` endpoint used to
    return directly in its HTTP response.
    """
    job.status, job.phase, job.error = "running", "downloading", None
    job.started_at = job.heartbeat_at = datetime.now(UTC)
    await session.commit()
    local_path = ""
    try:
        if job.archive_id is None:
            raise ValueError("Restore job has no uploaded archive.")
        archive = await session.get(BackupArchive, job.archive_id)
        if archive is None:
            raise ValueError("Restore job's archive was not found.")
        with tempfile.NamedTemporaryFile(
            prefix="wikihub-restore-", suffix="-full.zip", delete=False
        ) as temp:
            local_path = temp.name
        await checkpoint_backup_job(session, job)

        chunks_seen = 0

        async def _on_download_progress(downloaded: int) -> None:
            nonlocal chunks_seen
            chunks_seen += 1
            if (
                chunks_seen % _DOWNLOAD_PROGRESS_EVERY_CHUNKS != 0
                and downloaded < archive.size_bytes
            ):
                return
            await checkpoint_backup_job(
                session,
                job,
                counters={"items_processed": downloaded, "items_total": archive.size_bytes},
            )

        await storage.download_to_file(
            archive.object_key, local_path, on_progress=_on_download_progress
        )
        # The download phase's progress used bytes as its unit; the apply
        # phase below uses items (attachments/avatars). Resetting the clock
        # here keeps the apply phase's own ETA estimate honest instead of
        # dividing a small item count by elapsed time that mostly measures
        # how long the (usually much larger) download took.
        job.phase = "restoring"
        job.started_at = job.heartbeat_at = datetime.now(UTC)
        await session.commit()

        service = BackupService(session)
        result = await service.restore_full_package(
            local_path,
            storage,
            dry_run=False,
            overwrite_space_keys=set(job.overwrite_space_keys or []),
            space_keys=set(job.space_keys) or None,
            job=job,
        )
        job.result = result.model_dump(mode="json")
        job.status, job.phase = "complete", "complete"
        await session.commit()
    except ExportCancelled:
        await session.rollback()
        current = await session.get(BackupJob, job.id)
        if current:
            current.status, current.phase = "cancelled", "cancelled"
            await session.commit()
    except Exception as exc:
        await session.rollback()
        current = await session.get(BackupJob, job.id)
        if current:
            current.status, current.phase, current.error = "failed", "failed", str(exc)[:4000]
            await session.commit()
        raise
    finally:
        if local_path:
            with suppress(FileNotFoundError):
                os.unlink(local_path)


async def run_backup_job(session: AsyncSession, storage: ObjectStorage, job_id: uuid.UUID) -> None:
    job = await session.get(BackupJob, job_id)
    if job is None or job.status in {"complete", "cancelled"}:
        return
    if job.kind == "full_import":
        await _run_restore_job(session, storage, job)
        return
    job.status, job.phase, job.error = "running", "exporting", None
    # Stamp the heartbeat together with the status: a "running" row with no
    # heartbeat is what the reaper treats as abandoned, so it must never be
    # possible to observe one that has merely not checkpointed yet.
    job.started_at = job.heartbeat_at = datetime.now(UTC)
    await session.commit()
    suffix = "full.zip" if job.kind == "full_export" else "confluence-dc.zip"
    local_path = ""
    try:
        with tempfile.NamedTemporaryFile(
            prefix="wikihub-backup-", suffix=f"-{suffix}", delete=False
        ) as temp:
            local_path = temp.name
        await checkpoint_backup_job(session, job)
        if job.kind == "full_export":
            service = BackupService(session)
            manifest = await service.export_full_package(
                local_path,
                storage,
                include_credentials=job.include_credentials,
                space_keys=job.space_keys,
                job=job,
            )
            job.counters = {
                str(key): int(value) for key, value in manifest.get("counts", {}).items()
            }
            filename = f"wikihub-full-backup-{job.created_at:%Y%m%d-%H%M%S}.zip"
        elif job.kind == "confluence_export":
            spaces_query = select(Space).order_by(Space.key)
            if job.space_keys:
                spaces_query = spaces_query.where(Space.key.in_(job.space_keys))
            spaces = list((await session.execute(spaces_query)).scalars())
            pages = list((await session.execute(select(WikiPage))).scalars())
            attachments = list((await session.execute(select(PageAttachment))).scalars())
            await write_confluence_dc_export(
                local_path,
                storage,
                profile=job.confluence_profile or "",
                spaces=spaces,
                pages=pages,
                attachments=attachments,
                session=session,
                job=job,
            )
            job.counters = {"spaces": len(spaces)}
            filename = (
                f"wikihub-confluence-{job.confluence_profile}-{job.created_at:%Y%m%d-%H%M%S}.zip"
            )
        else:
            raise ValueError("Unknown backup job.")
        # Last chance to bail out before spending time uploading an artifact
        # nobody wants any more; also refreshes the heartbeat, because reading
        # and uploading a multi-GB archive is itself a long silent stretch.
        await checkpoint_backup_job(session, job)
        key = f"backups/exports/{job.id}/{filename}"
        handle = await anyio.to_thread.run_sync(_open_for_read, local_path)
        try:
            await storage.put(key, handle, content_type="application/zip")
        finally:
            await anyio.to_thread.run_sync(handle.close)
        await checkpoint_backup_job(session, job)
        job.output_key, job.output_filename = key, filename
        job.status, job.phase = "complete", "complete"
        await session.commit()
    except ExportCancelled:
        await session.rollback()
        job = await session.get(BackupJob, job_id)
        if job:
            job.status, job.phase = "cancelled", "cancelled"
            await session.commit()
    except Exception as exc:
        await session.rollback()
        job = await session.get(BackupJob, job_id)
        if job:
            job.status, job.phase, job.error = "failed", "failed", str(exc)[:4000]
            await session.commit()
        raise
    finally:
        if local_path:
            with suppress(FileNotFoundError):
                os.unlink(local_path)
