"""Administrator endpoints for staged Confluence imports."""

from __future__ import annotations

import uuid
from typing import Annotated

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select

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
    archive, url = await importer.start_upload(
        filename=payload.filename, size_bytes=payload.size_bytes, actor_id=user.id
    )
    return UploadTarget(
        archive_id=archive.id,
        object_key=archive.object_key,
        upload_url=url,
        max_size_bytes=(
            await SiteSettingsService(importer.session).get_effective()
        ).max_backup_import_size_bytes,
    )


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
