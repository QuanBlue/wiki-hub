"""Import Word/PDF/HTML documents as pages.

Uploads go straight through as one multipart POST rather than through the
resumable, hash-then-stage machinery the Confluence and backup archives use.
That machinery exists for multi-gigabyte archives; a batch of documents is
bounded by the workspace upload ceiling per file (50 MB by default) times a
small file count, and paying for resumability there would be all cost.

The bytes still land in object storage before the job is queued, because the
API and the worker are separate containers: a temp file written by uvicorn is
invisible to arq.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Annotated

import filetype
from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, File, Form, UploadFile, status

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    NotFoundError,
    PayloadTooLargeError,
    ServiceUnavailableError,
    UnsupportedMediaTypeError,
)
from app.core.logging import get_logger
from app.models.page import WikiPage
from app.models.space import Space
from app.modules.attachments.store import safe_attachment_filename
from app.modules.document_import.convert import format_for_filename
from app.modules.document_import.service import (
    StagedDocument,
    create_document_import_job,
    get_job_for_user,
    list_active_jobs,
    to_job_read,
    worker_is_gone,
)
from app.modules.pages.service import PageService
from app.modules.spaces.service import SpaceService
from app.schemas.document_import import (
    MAX_DOCUMENT_IMPORT_FILES,
    DocumentImportJobRead,
)
from app.services.import_concurrency import assert_no_active_wikihub_restore
from app.services.site_settings import SiteSettingsService
from app.services.storage import get_storage

logger = get_logger(__name__)

router = APIRouter(prefix="/document-imports", tags=["document imports"])
space_router = APIRouter(tags=["document imports"])

#: Read size for the streaming upload guard. Never `await file.read()` without
#: a bound - that is how one request becomes the worker's memory ceiling.
_CHUNK_BYTES = 1024 * 1024

#: Magic-byte families we can meaningfully cross-check against the extension.
#: Text formats (html, markdown) have no signature and are skipped.
_SNIFFABLE_FORMATS = {
    "pdf": {"pdf"},
    # OOXML and ODF are both zip containers; `filetype` reports the specific
    # type when it can and "zip" when it cannot look inside.
    "docx": {"docx", "zip"},
    "odt": {"odt", "zip"},
    "epub": {"epub", "zip"},
    "rtf": {"rtf"},
}


async def _enqueue(job_id: uuid.UUID) -> None:
    try:
        pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        await pool.enqueue_job("run_document_import", str(job_id))
        await pool.aclose()
    except Exception as exc:
        raise ServiceUnavailableError(
            "The import worker queue is unavailable; the import was not started."
        ) from exc


def _check_magic_bytes(filename: str, doc_format: str, data: bytes) -> None:
    """Reject a file whose contents disagree with its extension.

    A `.docx` that is really a PDF is at best a confusing failure three steps
    later, and at worst a way to steer the file at a converter that was not
    chosen for it.
    """
    expected = _SNIFFABLE_FORMATS.get(doc_format)
    if expected is None:
        return
    sniffed = filetype.guess(data[:4096])
    if sniffed is None or sniffed.extension in expected:
        # Unrecognised is not the same as wrong: `filetype` knows a bounded set
        # of signatures, and refusing everything it has not heard of would
        # reject legitimate documents.
        return
    raise UnsupportedMediaTypeError(
        f"{filename} does not look like a {doc_format.upper()} file.",
        code="unsupported_document_type",
    )


async def _read_upload(file: UploadFile, *, limit_bytes: int, limit_mb: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(_CHUNK_BYTES):
        total += len(chunk)
        if total > limit_bytes:
            raise PayloadTooLargeError(
                f"{file.filename or 'This file'} is larger than {limit_mb} MB.",
                code="document_too_large",
            )
        chunks.append(chunk)
    return b"".join(chunks)


@space_router.post(
    "/spaces/{key}/document-imports",
    response_model=DocumentImportJobRead,
    status_code=status.HTTP_201_CREATED,
    summary="Import documents as pages",
)
async def create_document_import(
    key: str,
    user: CurrentUser,
    session: DbSession,
    files: Annotated[list[UploadFile], File(description="Documents to import")],
    parent_id: Annotated[str | None, Form(description="Parent page id")] = None,
) -> DocumentImportJobRead:
    space = await SpaceService(session).get_by_key(key)
    page_service = PageService(session)
    await page_service.require_editor(space, user)

    if not files or all(not (f.filename or "").strip() for f in files):
        raise BadRequestError("Choose at least one document.", code="invalid_document_import")
    if len(files) > MAX_DOCUMENT_IMPORT_FILES:
        raise BadRequestError(
            f"Import at most {MAX_DOCUMENT_IMPORT_FILES} documents at a time.",
            code="invalid_document_import",
        )

    parent = await _resolve_parent(session, space_id=space.id, parent_id=parent_id)

    # An overwrite restore deletes a space's pages outright, so a page created
    # mid-restore would vanish. The reverse guard is deliberately absent: a
    # document import must not block an administrator for the hours a workspace
    # export can run.
    await assert_no_active_wikihub_restore(session)

    effective = await SiteSettingsService(session).get_effective()
    documents: list[StagedDocument] = []
    for file in files:
        filename = safe_attachment_filename(file.filename)
        doc_format = format_for_filename(filename)
        if doc_format is None:
            raise UnsupportedMediaTypeError(
                f"WikiHub cannot import {Path(filename).suffix or 'this file type'}.",
                code="unsupported_document_type",
            )
        # Checked before a byte is read: no reason to pull 50 MB off the wire
        # for a file we already know we will not convert.
        data = await _read_upload(
            file,
            limit_bytes=effective.max_upload_size_bytes,
            limit_mb=effective.max_upload_size_mb,
        )
        if not data:
            raise BadRequestError(f"{filename} is empty.", code="invalid_document_import")
        _check_magic_bytes(filename, doc_format, data)
        documents.append(
            StagedDocument(
                filename=filename,
                content_type=(file.content_type or "application/octet-stream").lower(),
                data=data,
                source_format=doc_format,
            )
        )

    job = await create_document_import_job(
        session,
        get_storage(),
        space=space,
        parent_id=parent.id if parent is not None else None,
        documents=documents,
        creator=user,
    )
    await session.flush()
    await session.refresh(job)
    await _enqueue(job.id)
    return to_job_read(job, space_key=space.key)


async def _resolve_parent(
    session: DbSession, *, space_id: uuid.UUID, parent_id: str | None
) -> WikiPage | None:
    raw = (parent_id or "").strip()
    if not raw:
        return None
    try:
        identifier = uuid.UUID(raw)
    except ValueError as exc:
        raise BadRequestError(
            "The parent page id is not valid.", code="invalid_document_import"
        ) from exc
    parent = await session.get(WikiPage, identifier)
    if parent is None or parent.space_id != space_id:
        raise NotFoundError("Parent page not found.")
    return parent


@space_router.get(
    "/spaces/{key}/document-imports/active",
    response_model=list[DocumentImportJobRead],
    summary="List this user's unfinished document imports in a space",
)
async def list_active_document_imports(
    key: str, user: CurrentUser, session: DbSession
) -> list[DocumentImportJobRead]:
    """Lets the UI re-attach its progress card after a page reload."""
    space_service = SpaceService(session)
    space = await space_service.get_by_key(key)
    await space_service.require_view(space, user)
    jobs = await list_active_jobs(session, space=space, user=user)
    return [to_job_read(job, space_key=space.key) for job in jobs]


@router.get(
    "/{job_id}",
    response_model=DocumentImportJobRead,
    summary="Read a document import job",
)
async def get_document_import(
    job_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> DocumentImportJobRead:
    job = await get_job_for_user(session, job_id, user)
    if job is None:
        raise NotFoundError("Import job not found.")
    space = await session.get(Space, job.space_id)
    return to_job_read(job, space_key=space.key if space else "")


@router.post(
    "/{job_id}/cancel",
    response_model=DocumentImportJobRead,
    summary="Cancel a document import",
)
async def cancel_document_import(
    job_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> DocumentImportJobRead:
    job = await get_job_for_user(session, job_id, user)
    if job is None:
        raise NotFoundError("Import job not found.")
    if job.status in {"complete", "failed", "cancelled"}:
        raise ConflictError("This import has already finished.")

    job.cancel_requested = True
    # Finalise here whenever nothing is left to observe the flag, rather than
    # leaving the user watching a status that can never change:
    #   - "queued": no worker has picked it up, so no loop will see it.
    #   - "running" with a stale heartbeat: the worker that owned it is gone.
    # A live worker is left alone; it observes the flag at its next checkpoint
    # and finalises the job itself, having actually stopped work.
    if job.status == "queued" or worker_is_gone(job):
        job.status, job.phase = "cancelled", "cancelled"
        for item in job.items:
            if item.status in {"queued", "running"}:
                item.status = "cancelled"
    await session.flush()
    # TimestampMixin updates server-side; refresh before serialising so async
    # SQLAlchemy does not attempt a lazy attribute load during response build.
    await session.refresh(job)
    space = await session.get(Space, job.space_id)
    logger.info("document_import_cancel_requested", job_id=str(job.id), by=user.username)
    return to_job_read(job, space_key=space.key if space else "")
