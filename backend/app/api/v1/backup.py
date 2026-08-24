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
from typing import Annotated
from urllib.parse import quote

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from pydantic import ValidationError

from app.api.deps import ClientInfoDep, CurrentSuperuser, DbSession, Impersonator
from app.core.config import settings
from app.core.exceptions import BadRequestError, PayloadTooLargeError, ServiceUnavailableError
from app.models.backup_job import BackupJob
from app.modules.backup.jobs import create_export_job
from app.modules.backup.service import BackupService
from app.schemas.backup import (
    BackupArchiveSpaceRead,
    BackupDocument,
    BackupExportCreate,
    BackupJobRead,
    ImportReport,
)
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
    return BackupJobRead(
        id=job.id,
        kind=job.kind,
        status=job.status,
        phase=job.phase,
        counters=job.counters,
        include_credentials=job.include_credentials,
        confluence_profile=job.confluence_profile,
        space_keys=job.space_keys,
        output_filename=job.output_filename,
        download_url=(
            "/api/v1/storage/object?key="
            + quote(job.output_key, safe="")
            + "&download_as="
            + quote(job.output_filename, safe="")
            if job.status == "complete" and job.output_key and job.output_filename
            else None
        ),
        error=job.error,
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


@router.post(
    "/inspect-zip",
    response_model=list[BackupArchiveSpaceRead],
    summary="List the spaces contained in a WikiHub backup ZIP",
)
async def inspect_full_backup_zip(
    # Unused beyond enforcing the same CurrentSuperuser auth every other
    # endpoint on this router requires - this reads archive contents and
    # must not be reachable by anyone else.
    service: BackupServiceDep,
    file: Annotated[UploadFile, File(description="A full .zip produced by a WikiHub export job")],
) -> list[BackupArchiveSpaceRead]:
    """Read only the space list out of an archive, for the "select spaces to
    restore" picker - never touches the database.

    Kept a separate upload from the actual restore (rather than an automatic
    dry run) so the default "restore everything" path stays a single upload;
    only picking specific spaces costs a second one, to read what's on offer.
    """
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise BadRequestError("Choose a .zip file created by WikiHub.", code="invalid_backup_file")
    staged_path = ""
    try:
        with tempfile.NamedTemporaryFile(
            prefix="wikihub-restore-inspect-", suffix=".zip", delete=False
        ) as staged:
            staged_path = staged.name
            total = 0
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > settings.max_import_size_bytes:
                    raise PayloadTooLargeError(
                        "Backup archive exceeds the configured import limit."
                    )
                staged.write(chunk)
        scanned = BackupService.scan_full_package(staged_path)
        return [
            BackupArchiveSpaceRead(key=space.key, name=space.name)
            for space in scanned.document.spaces
        ]
    finally:
        await file.close()
        if staged_path:
            with suppress(OSError):
                os.unlink(staged_path)


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
    staged_path = ""
    try:
        with tempfile.NamedTemporaryFile(
            prefix="wikihub-restore-", suffix=".zip", delete=False
        ) as staged:
            staged_path = staged.name
            total = 0
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > settings.max_import_size_bytes:
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


@router.get("/jobs/{job_id}", response_model=BackupJobRead)
async def get_backup_job(
    job_id: uuid.UUID, _user: CurrentSuperuser, session: DbSession
) -> BackupJobRead:
    job = await session.get(BackupJob, job_id)
    if job is None:
        raise BadRequestError("Backup job was not found.", code="backup_job_not_found")
    return await _job_read(job)
