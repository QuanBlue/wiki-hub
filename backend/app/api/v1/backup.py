"""Instance backup and restore endpoints.

HTTP concerns live here only — file naming, upload limits, content types. The
service underneath is transport-agnostic so it can move to a background job
without change.
"""

from __future__ import annotations

import json
import os
import tempfile
import uuid
from contextlib import suppress
from datetime import UTC, datetime
from typing import Annotated, Any
from urllib.parse import quote

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError
from sqlalchemy import desc, func, select

from app.api.deps import ClientInfoDep, CurrentSuperuser, DbSession, Impersonator
from app.core.config import settings
from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    NotFoundError,
    PayloadTooLargeError,
    ServiceUnavailableError,
)
from app.models.backup_job import AutomatedBackupSettings, BackupArchive, BackupJob, BackupJobLog
from app.modules.backup.automated import (
    base_directory,
    configured_directory,
    get_settings as get_automated_settings,
    queue_automatic_backup,
    validate_subdirectory,
    validate_timezone,
)
from app.modules.backup.archives import BackupArchiveService
from app.modules.backup.jobs import create_export_job, create_import_job
from app.modules.backup.service import STALE_JOB_AFTER, BackupService
from app.schemas.backup import (
    BackupArchiveRead,
    AutomatedBackupBulkDelete,
    AutomatedBackupJobPage,
    AutomatedBackupSettingsRead,
    AutomatedBackupSettingsUpdate,
    BackupArchiveSpaceRead,
    BackupArchiveUploadInit,
    BackupArchiveUploadPartUrlsRead,
    BackupArchiveUploadPartUrlsRequest,
    BackupArchiveUploadProgressRead,
    BackupArchiveUploadTarget,
    BackupDocument,
    BackupExportCreate,
    BackupImportCreate,
    BackupJobLogPage,
    BackupJobLogRead,
    BackupJobRead,
    ImportReport,
)
from app.services.import_concurrency import assert_no_active_confluence_import
from app.services.job_progress import job_progress
from app.services.site_settings import SiteSettingsService
from app.services.storage import get_storage

router = APIRouter(prefix="/backup", tags=["backup"])

#: A JSON instance backup is small; this is a sanity bound, not a content limit.
MAX_BACKUP_UPLOAD_BYTES = min(settings.max_import_size_bytes, 64 * 1024 * 1024)


def get_backup_service(
    session: DbSession,
    user: CurrentSuperuser,
    client: ClientInfoDep,
    impersonator: Impersonator,
) -> BackupService:
    return BackupService(session, actor=user, client=client, impersonator=impersonator)


BackupServiceDep = Annotated[BackupService, Depends(get_backup_service)]


def get_backup_archive_service(session: DbSession) -> BackupArchiveService:
    return BackupArchiveService(session, get_storage())


BackupArchiveServiceDep = Annotated[BackupArchiveService, Depends(get_backup_archive_service)]


def _archive_read(
    item: BackupArchive, spaces: list[dict[str, Any]] | None = None
) -> BackupArchiveRead:
    return BackupArchiveRead(
        id=item.id,
        filename=item.filename,
        size_bytes=item.size_bytes,
        sha256=item.sha256,
        status=item.status,
        error=item.error,
        spaces=[
            BackupArchiveSpaceRead.model_validate(space)
            for space in (item.spaces if spaces is None else spaces)
        ],
    )


async def _enqueue(job_id: uuid.UUID) -> None:
    try:
        pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        await pool.enqueue_job("run_backup_job", str(job_id))
        await pool.aclose()
    except Exception as exc:
        raise ServiceUnavailableError(
            "Backup worker queue is unavailable; the export was not started."
        ) from exc


async def _job_read(job: BackupJob) -> BackupJobRead:
    percent, eta_seconds = job_progress(job)
    return BackupJobRead(
        id=job.id,
        kind=job.kind,
        status=job.status,
        phase=job.phase,
        counters=job.counters,
        cancel_requested=job.cancel_requested,
        include_credentials=job.include_credentials,
        confluence_profile=job.confluence_profile,
        space_keys=job.space_keys,
        archive_id=job.archive_id,
        overwrite_space_keys=job.overwrite_space_keys or [],
        result=job.result,
        output_filename=job.output_filename,
        download_url=(
            f"/api/v1/backup/automatic/jobs/{job.id}/download"
            if getattr(job, "automated", False) and job.status == "complete" and getattr(job, "local_filename", None)
            else
            "/api/v1/storage/object?key="
            + quote(job.output_key, safe="")
            + "&download_as="
            + quote(job.output_filename, safe="")
            if not getattr(job, "automated", False) and job.status == "complete" and job.output_key and job.output_filename
            else None
        ),
        error=job.error,
        started_at=job.started_at,
        heartbeat_at=job.heartbeat_at,
        percent=percent,
        eta_seconds=eta_seconds,
        automated=bool(getattr(job, "automated", False)),
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


@router.get(
    "/export",
    response_class=Response,
    summary="Download a full instance backup",
    responses={200: {"content": {"application/json": {}}, "description": "Backup document"}},
)
async def export_backup(
    service: BackupServiceDep,
    include_credentials: bool = Query(
        default=False,
        description=(
            "Include password hashes. Off by default: the download is a "
            "cracking target. Without it, restored accounts need a password reset."
        ),
    ),
) -> Response:
    document = await service.export_document(include_credentials=include_credentials)

    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    filename = f"wikihub-backup-{stamp}.json"
    return Response(
        content=document.model_dump_json(indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import", response_model=ImportReport, summary="Restore from a backup file")
async def import_backup(
    service: BackupServiceDep,
    file: Annotated[UploadFile, File(description="A JSON file produced by /backup/export")],
    dry_run: Annotated[
        bool,
        Form(description="Validate and report without writing. Defaults to true."),
    ] = True,
) -> ImportReport:
    """Upload a backup and preview or apply it.

    Multipart rather than a JSON body: a large document sent as a request body
    would be fully materialised and validated in memory before the handler runs.
    """
    if not file.filename or not file.filename.lower().endswith(".json"):
        raise BadRequestError("Choose a .json file created by WikiHub.", code="invalid_backup_file")

    # Do not materialise an unbounded multipart upload in memory. UploadFile
    # may already be spooled to disk, but read() with no limit would still pull
    # an attacker-controlled file into this process before we can reject it.
    raw = await file.read(MAX_BACKUP_UPLOAD_BYTES + 1)
    if len(raw) > MAX_BACKUP_UPLOAD_BYTES:
        raise PayloadTooLargeError(
            f"Backup exceeds the {MAX_BACKUP_UPLOAD_BYTES // (1024 * 1024)} MB limit."
        )

    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        # A malformed upload is the caller's mistake: 400, never a 500.
        raise BadRequestError(
            "The uploaded file is not valid JSON.", code="malformed_backup"
        ) from exc

    try:
        document = BackupDocument.model_validate(payload)
    except ValidationError as exc:
        raise BadRequestError(
            "The uploaded file is not a WikiHub backup document.",
            code="malformed_backup",
            details={"errors": exc.error_count()},
        ) from exc

    return await service.import_document(document, dry_run=dry_run)


def _parse_space_key_list(raw: str, *, code: str) -> list[str]:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise BadRequestError("Space selection is invalid.", code=code) from exc
    if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
        raise BadRequestError("Space selection is invalid.", code=code)
    return parsed


@router.post("/import-zip", response_model=ImportReport, summary="Restore a full WikiHub ZIP")
async def import_full_backup_zip(
    service: BackupServiceDep,
    file: Annotated[UploadFile, File(description="A full .zip produced by a WikiHub export job")],
    dry_run: Annotated[bool, Form(description="Verify and preview without writing.")] = True,
    overwrite_space_keys: Annotated[
        str, Form(description="JSON array of conflicting space keys to replace.")
    ] = "[]",
    space_keys: Annotated[
        str, Form(description="JSON array of space keys to restore; empty means every space.")
    ] = "[]",
) -> ImportReport:
    """Stage ZIP bytes locally only long enough for strict scan/apply.

    Large, resumable production uploads use the archive/job endpoints; this
    endpoint also keeps the restore operation usable in compact deployments.
    """
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise BadRequestError("Choose a .zip file created by WikiHub.", code="invalid_backup_file")
    overwrite_keys = _parse_space_key_list(
        overwrite_space_keys, code="invalid_backup_overwrite"
    )
    scoped_keys = _parse_space_key_list(space_keys, code="invalid_backup_scope")
    max_size_bytes = (
        await SiteSettingsService(service.session).get_effective()
    ).max_backup_import_size_bytes
    staged_path = ""
    try:
        with tempfile.NamedTemporaryFile(
            prefix="wikihub-restore-", suffix=".zip", delete=False
        ) as staged:
            staged_path = staged.name
            total = 0
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > max_size_bytes:
                    raise PayloadTooLargeError(
                        "Backup archive exceeds the configured import limit."
                    )
                staged.write(chunk)
        return await service.restore_full_package(
            staged_path,
            get_storage(),
            dry_run=dry_run,
            overwrite_space_keys=set(overwrite_keys),
            space_keys=set(scoped_keys) or None,
        )
    finally:
        await file.close()
        if staged_path:
            with suppress(FileNotFoundError):
                os.unlink(staged_path)


# -- Direct-to-storage archive upload (large restores) ----------------------
#
# Mirrors `app/api/v1/confluence_import.py`'s upload endpoints 1:1: a large
# WikiHub backup ZIP is uploaded in small, bounded parts straight to object
# storage instead of as one giant multipart POST through this process, which
# is what `/import-zip` above cannot avoid (see `BackupArchiveService`'s
# module docstring for why that matters for anything approaching double-digit
# gigabytes).


@router.post("/archives/uploads", response_model=BackupArchiveUploadTarget, status_code=201)
async def start_backup_archive_upload(
    payload: BackupArchiveUploadInit, user: CurrentSuperuser, archives: BackupArchiveServiceDep
) -> BackupArchiveUploadTarget:
    archive = await archives.start_upload(
        filename=payload.filename,
        size_bytes=payload.size_bytes,
        actor_id=user.id,
        sha256=payload.sha256,
    )
    complete = archive.status in {"uploaded", "scanned"}
    return BackupArchiveUploadTarget(
        archive_id=archive.id,
        object_key=archive.object_key,
        max_size_bytes=(
            await SiteSettingsService(archives.session).get_effective()
        ).max_backup_import_size_bytes,
        part_size_bytes=archives.upload_part_size_bytes,
        # Parts already in storage from an earlier, interrupted attempt at this
        # same file. The client skips them, so a multi-GB upload picks up where
        # it stopped rather than starting over. Empty for a brand-new archive,
        # and irrelevant once `reused` says the bytes are already whole.
        uploaded_parts=[] if complete else await archives.uploaded_part_numbers(archive),
        status=archive.status,
        sha256=archive.sha256,
        reused=complete,
    )


@router.get("/archives/uploads/active", response_model=list[BackupArchiveUploadProgressRead])
async def list_active_backup_archive_uploads(
    user: CurrentSuperuser, session: DbSession, archives: BackupArchiveServiceDep
) -> list[BackupArchiveUploadProgressRead]:
    """In-progress and scanned (ready-for-restore) archives for this user.

    Scanned archives are included so a new tab can restore the space-picker
    UI without re-uploading a multi-GB archive that already finished.
    """
    imported_archive_ids = select(BackupJob.archive_id).where(BackupJob.archive_id.is_not(None))
    rows = (
        (
            await session.execute(
                select(BackupArchive)
                .where(
                    BackupArchive.created_by_id == user.id,
                    BackupArchive.status.in_(["uploading", "scanned"]),
                    BackupArchive.id.not_in(imported_archive_ids),
                )
                .order_by(desc(BackupArchive.updated_at), desc(BackupArchive.created_at))
                .limit(5)
            )
        )
        .scalars()
        .all()
    )
    return [
        BackupArchiveUploadProgressRead(
            archive_id=archive.id,
            filename=archive.filename,
            size_bytes=archive.size_bytes,
            sha256=archive.sha256,
            status=archive.status,
            part_size_bytes=archives.upload_part_size_bytes,
            uploaded_parts=await archives.uploaded_part_numbers(archive),
        )
        for archive in rows
    ]


@router.get("/archives/{archive_id}/upload", response_model=BackupArchiveUploadProgressRead)
async def get_backup_archive_upload_progress(
    archive_id: uuid.UUID, _user: CurrentSuperuser, archives: BackupArchiveServiceDep
) -> BackupArchiveUploadProgressRead:
    archive = await archives.get_archive(archive_id)
    return BackupArchiveUploadProgressRead(
        archive_id=archive.id,
        filename=archive.filename,
        size_bytes=archive.size_bytes,
        sha256=archive.sha256,
        status=archive.status,
        part_size_bytes=archives.upload_part_size_bytes,
        uploaded_parts=await archives.uploaded_part_numbers(archive),
    )


@router.post(
    "/archives/{archive_id}/upload-parts", response_model=BackupArchiveUploadPartUrlsRead
)
async def get_backup_archive_upload_part_urls(
    archive_id: uuid.UUID,
    payload: BackupArchiveUploadPartUrlsRequest,
    _user: CurrentSuperuser,
    archives: BackupArchiveServiceDep,
) -> BackupArchiveUploadPartUrlsRead:
    archive = await archives.get_archive(archive_id)
    max_part = (
        archive.size_bytes + archives.upload_part_size_bytes - 1
    ) // archives.upload_part_size_bytes
    if any(number < 1 or number > max_part for number in payload.part_numbers):
        raise NotFoundError("Upload part not found.")
    # Keep resumable uploads same-origin, same reasoning as Confluence's
    # equivalent endpoint: a direct MinIO URL carries a localhost/internal
    # hostname and cannot work once WikiHub is reachable from anywhere else.
    if archive.status != "uploading" or not archive.multipart_upload_id:
        return BackupArchiveUploadPartUrlsRead(
            urls=await archives.upload_part_urls(archive, sorted(set(payload.part_numbers)))
        )
    urls = {
        number: (
            "/api/v1/storage/object?key="
            + quote(archive.object_key, safe="")
            + "&upload_id="
            + quote(archive.multipart_upload_id, safe="")
            + f"&part_number={number}"
        )
        for number in sorted(set(payload.part_numbers))
    }
    return BackupArchiveUploadPartUrlsRead(urls=urls)


@router.post("/archives/{archive_id}/complete-upload", response_model=BackupArchiveRead)
async def complete_backup_archive_upload(
    archive_id: uuid.UUID, _user: CurrentSuperuser, archives: BackupArchiveServiceDep
) -> BackupArchiveRead:
    return _archive_read(await archives.complete_upload(await archives.get_archive(archive_id)))


@router.delete("/archives/{archive_id}/upload", status_code=204)
async def cancel_backup_archive_upload(
    archive_id: uuid.UUID, _user: CurrentSuperuser, archives: BackupArchiveServiceDep
) -> None:
    await archives.abort_upload(await archives.get_archive(archive_id))


@router.post("/archives/{archive_id}/scan", response_model=BackupArchiveRead)
async def scan_backup_archive(
    archive_id: uuid.UUID, _user: CurrentSuperuser, archives: BackupArchiveServiceDep
) -> BackupArchiveRead:
    """Populate the archive's space list for the "select spaces to restore" picker."""
    return _archive_read(await archives.scan(await archives.get_archive(archive_id)))


@router.get("/archives/{archive_id}", response_model=BackupArchiveRead)
async def get_backup_archive(
    archive_id: uuid.UUID, _user: CurrentSuperuser, archives: BackupArchiveServiceDep
) -> BackupArchiveRead:
    # Conflicts are recomputed on read, not served from what the scan stored:
    # a restore creates spaces, so re-reading the archive afterwards has to
    # show the keys it just filled as taken.
    archive = await archives.get_archive(archive_id)
    return _archive_read(archive, await archives.spaces_for_display(archive))


@router.post(
    "/archives/{archive_id}/jobs", response_model=BackupJobRead, status_code=201
)
async def create_backup_import(
    archive_id: uuid.UUID,
    payload: BackupImportCreate,
    user: CurrentSuperuser,
    session: DbSession,
) -> BackupJobRead:
    """Queue a restore of an already-uploaded, scanned archive."""
    # A Confluence import writes the same spaces/pages this restore would, so
    # the two must never overlap - see `app/services/import_concurrency.py`.
    await assert_no_active_confluence_import(session)
    try:
        job = await create_import_job(
            session,
            actor_id=user.id,
            archive_id=archive_id,
            overwrite_space_keys=payload.overwrite_space_keys,
            space_keys=payload.space_keys,
        )
    except ValueError as exc:
        raise BadRequestError(str(exc), code="invalid_backup_import") from exc
    await _enqueue(job.id)
    return await _job_read(job)


@router.post("/jobs", response_model=BackupJobRead, status_code=201)
async def create_backup_export(
    payload: BackupExportCreate, user: CurrentSuperuser, session: DbSession
) -> BackupJobRead:
    """Queue a full WikiHub ZIP or a separately compatible DC XML export."""
    try:
        job = await create_export_job(
            session,
            actor_id=user.id,
            kind=payload.kind,
            include_credentials=payload.include_credentials,
            confluence_profile=payload.confluence_profile,
            space_keys=payload.space_keys,
        )
    except ValueError as exc:
        raise BadRequestError(str(exc), code="invalid_backup_export") from exc
    await _enqueue(job.id)
    return await _job_read(job)


async def _automated_read(session: DbSession, item: AutomatedBackupSettings) -> AutomatedBackupSettingsRead:
    root = base_directory()
    directory = await configured_directory(session)
    return AutomatedBackupSettingsRead(
        enabled=item.enabled, interval_unit=item.interval_unit, interval_value=item.interval_value,
        time_of_day=item.time_of_day, timezone=item.timezone, retention_count=item.retention_count,
        subdirectory=item.subdirectory,
        directory_configured=directory is not None,
        base_directory=str(root) if root else None,
        directory=str(directory) if directory else None,
        last_run_at=item.last_run_at, next_run_at=item.next_run_at, last_status=item.last_status,
        last_error=item.last_error,
    )


@router.get("/automatic", response_model=AutomatedBackupSettingsRead)
async def read_automated_backup_settings(_user: CurrentSuperuser, session: DbSession) -> AutomatedBackupSettingsRead:
    return await _automated_read(session, await get_automated_settings(session))


@router.patch("/automatic", response_model=AutomatedBackupSettingsRead)
async def update_automated_backup_settings(payload: AutomatedBackupSettingsUpdate, _user: CurrentSuperuser, session: DbSession) -> AutomatedBackupSettingsRead:
    try:
        validate_timezone(payload.timezone)
    except ValueError as exc:
        raise BadRequestError(str(exc), code="invalid_backup_timezone") from exc
    try:
        subdirectory = validate_subdirectory(payload.subdirectory)
    except ValueError as exc:
        raise BadRequestError(str(exc), code="backup_subdirectory_invalid") from exc
    item = await get_automated_settings(session)
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    item.subdirectory = subdirectory
    if payload.enabled and await configured_directory(session) is None:
        raise BadRequestError("Automated backup directory is not configured or mounted.", code="backup_directory_unavailable")
    # Setting it to now makes the worker calculate an initial due time predictably.
    item.next_run_at = None
    await session.commit()
    await session.refresh(item)
    return await _automated_read(session, item)


@router.post("/automatic/run", response_model=BackupJobRead, status_code=201)
async def run_automated_backup_now(_user: CurrentSuperuser, session: DbSession) -> BackupJobRead:
    try:
        job = await queue_automatic_backup(session)
    except ValueError as exc:
        raise BadRequestError(str(exc), code="backup_directory_unavailable") from exc
    await _enqueue(job.id)
    return await _job_read(job)


@router.get("/automatic/jobs", response_model=AutomatedBackupJobPage)
async def list_automated_backups(
    _user: CurrentSuperuser,
    session: DbSession,
    offset: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
) -> AutomatedBackupJobPage:
    """Page through the automated-backup history table, newest first."""
    total = (
        await session.execute(
            select(func.count())
            .select_from(BackupJob)
            .where(BackupJob.automated.is_(True))
        )
    ).scalar_one()
    jobs = list(
        (
            await session.execute(
                select(BackupJob)
                .where(BackupJob.automated.is_(True))
                .order_by(BackupJob.created_at.desc())
                .offset(offset)
                .limit(limit)
            )
        ).scalars()
    )
    return AutomatedBackupJobPage(
        items=[await _job_read(job) for job in jobs], total=total
    )


@router.get("/automatic/jobs/{job_id}/download")
async def download_automated_backup(job_id: uuid.UUID, _user: CurrentSuperuser, session: DbSession) -> FileResponse:
    job = await session.get(BackupJob, job_id)
    directory = await configured_directory(session)
    if job is None or not job.automated or not job.local_filename or directory is None:
        raise NotFoundError("Automated backup was not found.")
    path = directory / job.local_filename
    if path.parent != directory or not path.is_file():
        raise NotFoundError("Automated backup file was not found.")
    return FileResponse(path, media_type="application/zip", filename=job.output_filename or path.name)


@router.delete("/automatic/jobs/{job_id}", status_code=204)
async def delete_automated_backup(job_id: uuid.UUID, _user: CurrentSuperuser, session: DbSession) -> None:
    job = await session.get(BackupJob, job_id)
    directory = await configured_directory(session)
    if job is None or not job.automated:
        raise NotFoundError("Automated backup was not found.")
    if directory and job.local_filename:
        path = directory / job.local_filename
        if path.parent == directory:
            path.unlink(missing_ok=True)
    await session.delete(job)


@router.post("/automatic/jobs/bulk-delete", status_code=204)
async def bulk_delete_automated_backups(
    payload: AutomatedBackupBulkDelete, _user: CurrentSuperuser, session: DbSession
) -> None:
    """Delete several automated-backup rows (and their files) at once.

    The history table's Actions column offers only Download per row now -
    deleting is a bulk action ("tick the rows you want gone, then Delete").
    Ids that are not found, or belong to a non-automated job, are skipped
    rather than failing the whole batch: the selection driving this can go
    stale between the checkbox and the click (another tab, the retention
    sweep), and a row already gone is not a reason to keep the rest of it.
    """
    directory = await configured_directory(session)
    jobs = (
        await session.execute(
            select(BackupJob).where(
                BackupJob.id.in_(payload.job_ids), BackupJob.automated.is_(True)
            )
        )
    ).scalars()
    for job in jobs:
        if directory and job.local_filename:
            path = directory / job.local_filename
            if path.parent == directory:
                path.unlink(missing_ok=True)
        await session.delete(job)


@router.get("/jobs", response_model=list[BackupJobRead])
async def list_backup_jobs(_user: CurrentSuperuser, session: DbSession) -> list[BackupJobRead]:
    """Recent export jobs, newest first.

    Lets the admin panel reattach to an in-flight export after a reload or on
    a different tab, the same way the Confluence import job list does.
    """
    jobs = (
        await session.execute(select(BackupJob).order_by(BackupJob.created_at.desc()).limit(30))
    ).scalars()
    return [await _job_read(job) for job in jobs]


@router.get("/jobs/{job_id}", response_model=BackupJobRead)
async def get_backup_job(
    job_id: uuid.UUID, _user: CurrentSuperuser, session: DbSession
) -> BackupJobRead:
    job = await session.get(BackupJob, job_id)
    if job is None:
        raise BadRequestError("Backup job was not found.", code="backup_job_not_found")
    return await _job_read(job)


@router.get("/jobs/{job_id}/logs", response_model=BackupJobLogPage)
async def get_backup_job_logs(
    job_id: uuid.UUID,
    _user: CurrentSuperuser,
    session: DbSession,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=250),
) -> BackupJobLogPage:
    """Narration for one backup job, newest first.

    Paged the same way as the Confluence importer's `/jobs/{id}/logs`: a
    restore that copies every attachment writes a bounded number of lines,
    but a failure can add one per item, and the panel only ever shows the
    most recent page of them.
    """
    rows = (
        (
            await session.execute(
                select(BackupJobLog)
                .where(BackupJobLog.job_id == job_id)
                .order_by(BackupJobLog.created_at.desc(), BackupJobLog.id.desc())
                .offset(offset)
                .limit(limit + 1)
            )
        )
        .scalars()
        .all()
    )
    return BackupJobLogPage(
        items=[
            BackupJobLogRead.model_validate(row, from_attributes=True) for row in rows[:limit]
        ],
        next_offset=offset + limit if len(rows) > limit else None,
    )


@router.post("/jobs/{job_id}/cancel", response_model=BackupJobRead)
async def cancel_backup_job(
    job_id: uuid.UUID, _user: CurrentSuperuser, session: DbSession
) -> BackupJobRead:
    job = await session.get(BackupJob, job_id)
    if job is None:
        raise BadRequestError("Backup job was not found.", code="backup_job_not_found")
    if job.status in {"complete", "failed", "cancelled"}:
        raise ConflictError("This export job has already finished.")
    job.cancel_requested = True
    # Finalise here whenever nothing is left to observe the flag, rather than
    # leaving the operator staring at a status that can never change:
    #   - "queued": no worker has picked the job up, so no loop will see it.
    #   - "running" with a stale heartbeat: the worker that owned this job is
    #     gone (crash, restart, deploy). The scheduled reaper would get to it
    #     eventually; a Cancel click should not have to wait for that.
    # A live worker is left alone - it observes `cancel_requested` at its next
    # checkpoint and finalises the job itself, having actually stopped work.
    heartbeat = job.heartbeat_at
    worker_is_gone = heartbeat is None or datetime.now(UTC) - heartbeat > STALE_JOB_AFTER
    if job.status == "queued" or worker_is_gone:
        job.status, job.phase = "cancelled", "cancelled"
    await session.flush()
    # TimestampMixin uses a server-side on-update expression - refresh before
    # serialising so async SQLAlchemy does not attempt a lazy attribute load
    # outside its greenlet context. `DbSession` commits the transaction after
    # this handler returns (see `app/api/deps.py::get_db`).
    await session.refresh(job)
    return await _job_read(job)
