"""Administrator endpoints for staged Confluence imports."""

from __future__ import annotations

import uuid
from typing import Annotated

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import desc, select

from app.api.deps import CurrentSuperuser, DbSession
from app.core.config import settings
from app.core.exceptions import ConflictError, NotFoundError, ServiceUnavailableError
from app.models.import_job import ImportArchive, ImportJob, ImportLog
from app.modules.import_export.service import ConfluenceImportService
from app.schemas.confluence_import import (
    ArchiveRead,
    ImportCreate,
    ImportJobRead,
    ImportLogPage,
    ImportLogRead,
    SpaceCandidate,
    UploadInit,
    UploadPartUrlsRead,
    UploadPartUrlsRequest,
    UploadProgressRead,
    UploadTarget,
)
from app.services.site_settings import SiteSettingsService
from app.services.storage import get_storage

router = APIRouter(prefix="/confluence-imports", tags=["confluence imports"])


def service(session: DbSession) -> ConfluenceImportService:
    return ConfluenceImportService(session, get_storage())


Service = Annotated[ConfluenceImportService, Depends(service)]


def archive_read(item: ImportArchive) -> ArchiveRead:
    return ArchiveRead(
        id=item.id,
        filename=item.filename,
        size_bytes=item.size_bytes,
        sha256=item.sha256,
        status=item.status,
        error=item.error,
        spaces=[SpaceCandidate.model_validate(space) for space in item.spaces],
    )


def job_read(item: ImportJob) -> ImportJobRead:
    return ImportJobRead(
        id=item.id,
        archive_id=item.archive_id,
        import_all=item.import_all,
        space_keys=item.space_keys,
        overwrite_existing=item.overwrite_existing,
        status=item.status,
        phase=item.phase,
        counters=item.counters,
        cancel_requested=item.cancel_requested,
        error=item.error,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


async def enqueue(job_id: uuid.UUID) -> None:
    try:
        pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        await pool.enqueue_job("run_confluence_import", str(job_id))
        await pool.aclose()
    except Exception as exc:
        raise ServiceUnavailableError(
            "Import worker queue is unavailable; the job was not started."
        ) from exc


@router.post("/uploads", response_model=UploadTarget, status_code=status.HTTP_201_CREATED)
async def start_upload(
    payload: UploadInit, user: CurrentSuperuser, importer: Service
) -> UploadTarget:
    archive = await importer.start_upload(
        filename=payload.filename,
        size_bytes=payload.size_bytes,
        actor_id=user.id,
        sha256=payload.sha256,
    )
    return UploadTarget(
        archive_id=archive.id,
        object_key=archive.object_key,
        max_size_bytes=(
            await SiteSettingsService(importer.session).get_effective()
        ).max_backup_import_size_bytes,
        part_size_bytes=importer.upload_part_size_bytes,
        status=archive.status,
        sha256=archive.sha256,
        reused=archive.status in {"uploaded", "scanned"},
    )


@router.get("/uploads/active", response_model=list[UploadProgressRead])
async def list_active_uploads(
    user: CurrentSuperuser, session: DbSession, importer: Service
) -> list[UploadProgressRead]:
    """Return in-progress and scanned (ready-for-import) archives for this user.

    Scanned archives are included so that a new tab can restore the space
    selection UI without the user having to re-upload the archive.
    """
    archives = (
        (
            await session.execute(
                select(ImportArchive)
                .where(
                    ImportArchive.created_by_id == user.id,
                    ImportArchive.status.in_(["uploading", "scanned"]),
                )
                .order_by(desc(ImportArchive.updated_at), desc(ImportArchive.created_at))
                .limit(5)
            )
        )
        .scalars()
        .all()
    )
    return [
        UploadProgressRead(
            archive_id=archive.id,
            filename=archive.filename,
            size_bytes=archive.size_bytes,
            sha256=archive.sha256,
            status=archive.status,
            part_size_bytes=importer.upload_part_size_bytes,
            uploaded_parts=await importer.uploaded_part_numbers(archive),
        )
        for archive in archives
    ]


@router.get("/archives/{archive_id}/upload", response_model=UploadProgressRead)
async def get_upload_progress(
    archive_id: uuid.UUID, _user: CurrentSuperuser, importer: Service
) -> UploadProgressRead:
    archive = await importer.get_archive(archive_id)
    return UploadProgressRead(
        archive_id=archive.id,
        filename=archive.filename,
        size_bytes=archive.size_bytes,
        sha256=archive.sha256,
        status=archive.status,
        part_size_bytes=importer.upload_part_size_bytes,
        uploaded_parts=await importer.uploaded_part_numbers(archive),
    )


@router.post("/archives/{archive_id}/upload-parts", response_model=UploadPartUrlsRead)
async def get_upload_part_urls(
    archive_id: uuid.UUID,
    payload: UploadPartUrlsRequest,
    _user: CurrentSuperuser,
    importer: Service,
) -> UploadPartUrlsRead:
    archive = await importer.get_archive(archive_id)
    max_part = (
        archive.size_bytes + importer.upload_part_size_bytes - 1
    ) // importer.upload_part_size_bytes
    if any(number < 1 or number > max_part for number in payload.part_numbers):
        raise NotFoundError("Upload part not found.")
    # Keep resumable uploads same-origin. Direct MinIO URLs contain a
    # localhost/internal hostname and cannot work when WikiHub is public.
    from urllib.parse import quote

    if archive.status != "uploading" or not archive.multipart_upload_id:
        # The service remains the authority for invalid/reused archives. This
        # branch also keeps lightweight service doubles informative in tests.
        return UploadPartUrlsRead(
            urls=await importer.upload_part_urls(archive, sorted(set(payload.part_numbers)))
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
    return UploadPartUrlsRead(urls=urls)


@router.post("/archives/{archive_id}/complete-upload", response_model=ArchiveRead)
async def complete_upload(
    archive_id: uuid.UUID, _user: CurrentSuperuser, importer: Service
) -> ArchiveRead:
    return archive_read(await importer.complete_upload(await importer.get_archive(archive_id)))


@router.delete("/archives/{archive_id}/upload", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_upload(archive_id: uuid.UUID, _user: CurrentSuperuser, importer: Service) -> None:
    await importer.abort_upload(await importer.get_archive(archive_id))


@router.post("/archives/{archive_id}/scan", response_model=ArchiveRead)
async def scan_archive(
    archive_id: uuid.UUID, _user: CurrentSuperuser, importer: Service
) -> ArchiveRead:
    return archive_read(await importer.scan(await importer.get_archive(archive_id)))


@router.get("/archives/{archive_id}", response_model=ArchiveRead)
async def get_archive(
    archive_id: uuid.UUID, _user: CurrentSuperuser, importer: Service
) -> ArchiveRead:
    return archive_read(await importer.get_archive(archive_id))


@router.post(
    "/archives/{archive_id}/jobs", response_model=ImportJobRead, status_code=status.HTTP_201_CREATED
)
async def create_job(
    archive_id: uuid.UUID, payload: ImportCreate, user: CurrentSuperuser, importer: Service
) -> ImportJobRead:
    job = await importer.create_job(
        await importer.get_archive(archive_id),
        import_all=payload.import_all,
        space_keys=payload.space_keys,
        overwrite_existing=payload.overwrite_existing,
        actor_id=user.id,
    )
    await enqueue(job.id)
    return job_read(job)


@router.get("/jobs", response_model=list[ImportJobRead])
async def list_jobs(_user: CurrentSuperuser, session: DbSession) -> list[ImportJobRead]:
    return [
        job_read(item)
        for item in (
            await session.execute(select(ImportJob).order_by(ImportJob.created_at.desc()).limit(30))
        ).scalars()
    ]


@router.get("/jobs/{job_id}", response_model=ImportJobRead)
async def get_job(job_id: uuid.UUID, _user: CurrentSuperuser, session: DbSession) -> ImportJobRead:
    item = await session.get(ImportJob, job_id)
    if item is None:
        raise NotFoundError("Import job was not found.")
    return job_read(item)


@router.get("/jobs/{job_id}/logs", response_model=ImportLogPage)
async def get_logs(
    job_id: uuid.UUID,
    _user: CurrentSuperuser,
    session: DbSession,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=250),
) -> ImportLogPage:
    rows = (
        (
            await session.execute(
                select(ImportLog)
                .where(ImportLog.job_id == job_id)
                .order_by(ImportLog.created_at.desc())
                .offset(offset)
                .limit(limit + 1)
            )
        )
        .scalars()
        .all()
    )
    return ImportLogPage(
        items=[ImportLogRead.model_validate(row, from_attributes=True) for row in rows[:limit]],
        next_offset=offset + limit if len(rows) > limit else None,
    )


@router.post("/jobs/{job_id}/cancel", response_model=ImportJobRead)
async def cancel(job_id: uuid.UUID, _user: CurrentSuperuser, session: DbSession) -> ImportJobRead:
    item = await session.get(ImportJob, job_id)
    if item is None:
        raise NotFoundError("Import job was not found.")
    if item.status in {"completed", "cancelled", "failed"}:
        raise ConflictError("This import job has already finished.")
    item.cancel_requested = True
    # A queued ARQ job may sit behind a long-running import. There is no worker
    # loop to observe the flag yet, so cancel it durably here instead of leaving
    # the operator staring at an immutable "queued" state.
    if item.status in {"queued", "retrying"}:
        item.status = "cancelled"
        item.phase = "cancelled"
        session.add(
            ImportLog(
                job_id=item.id,
                level="warning",
                phase="cancelled",
                message="Import cancelled before the worker started it.",
            )
        )
    else:
        session.add(
            ImportLog(
                job_id=item.id,
                level="info",
                phase=item.phase,
                message="Cancellation requested. The current import step will stop shortly.",
            )
        )
    await session.flush()
    # TimestampMixin uses a server-side on-update expression. Refresh before
    # serialising so async SQLAlchemy does not attempt a lazy attribute load
    # outside its greenlet context (which previously turned Cancel into a 500).
    await session.refresh(item)
    return job_read(item)


@router.post(
    "/jobs/{job_id}/retry", response_model=ImportJobRead, status_code=status.HTTP_201_CREATED
)
async def retry(job_id: uuid.UUID, user: CurrentSuperuser, session: DbSession) -> ImportJobRead:
    item = await session.get(ImportJob, job_id)
    if item is None:
        raise NotFoundError("Import job was not found.")
    if item.status not in {"failed", "cancelled"}:
        raise ConflictError("Only failed or cancelled jobs can be retried.")
    replacement = ImportJob(
        archive_id=item.archive_id,
        created_by_id=user.id,
        import_all=item.import_all,
        space_keys=item.space_keys,
        counters=item.counters,
    )
    session.add(replacement)
    await session.flush()
    await enqueue(replacement.id)
    return job_read(replacement)
