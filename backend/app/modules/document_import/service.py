"""Document import: job lifecycle, staging and serialisation.

The worker body lives in `jobs.py`; this module is everything both it and the
API need - creating the job and its items, staging the uploaded bytes, reading
a job back for the UI, and the checkpoint that carries progress, the heartbeat
and cancellation in one place.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.document_import import DocumentImportItem, DocumentImportJob
from app.models.space import Space
from app.models.user import User
from app.modules.attachments.store import safe_attachment_filename
from app.schemas.document_import import (
    ACTIVE_DOCUMENT_IMPORT_STATUSES,
    DocumentImportItemRead,
    DocumentImportJobRead,
)
from app.services.job_progress import job_progress
from app.services.storage import ObjectStorage

logger = get_logger(__name__)

#: A `running` job whose worker has not checked in for this long is orphaned -
#: the worker crashed, was restarted, or the container was replaced mid-deploy.
#: Same window the backup jobs use; there is no reason for the two to differ.
STALE_JOB_AFTER_SECONDS = 300

#: How often to checkpoint inside a long inner loop (a document with hundreds
#: of images). Per-file checkpoints are unconditional - a batch is small.
PROGRESS_CHECK_EVERY = 25

TERMINAL_STATUSES = frozenset({"complete", "failed", "cancelled"})


class DocumentImportCancelled(Exception):
    """Raised inside the worker when a cancel request is observed."""


class StagedDocument:
    """One file's bytes, already validated by the API, waiting to be stored."""

    __slots__ = ("content_type", "data", "filename", "source_format")

    def __init__(self, *, filename: str, content_type: str, data: bytes, source_format: str):
        self.filename = filename
        self.content_type = content_type
        self.data = data
        self.source_format = source_format


def staged_object_key(job_id: uuid.UUID, item_id: uuid.UUID, filename: str) -> str:
    return f"imports/documents/{job_id}/{item_id}/{filename}"


def staged_job_prefix(job_id: uuid.UUID) -> str:
    return f"imports/documents/{job_id}/"


async def create_document_import_job(
    session: AsyncSession,
    storage: ObjectStorage,
    *,
    space: Space,
    parent_id: uuid.UUID | None,
    documents: list[StagedDocument],
    creator: User,
    conflict_mode: str = "rename",
) -> DocumentImportJob:
    """Persist the job and its items, and stage every file in object storage.

    Storage is written *after* the rows are flushed so a database failure does
    not leave orphaned objects behind; if a `put` then fails, the request
    aborts and the transaction rolls the rows back with it.
    """
    job = DocumentImportJob(
        space_id=space.id,
        parent_id=parent_id,
        created_by_id=creator.id,
        status="queued",
        phase="queued",
        conflict_mode=conflict_mode,
        counters={
            "items_total": len(documents),
            "items_processed": 0,
            "items_failed": 0,
            "pages_created": 0,
            "attachments_created": 0,
        },
    )
    session.add(job)
    await session.flush()

    items: list[tuple[DocumentImportItem, StagedDocument]] = []
    for position, document in enumerate(documents):
        item_id = uuid.uuid4()
        filename = safe_attachment_filename(document.filename)
        item = DocumentImportItem(
            id=item_id,
            job_id=job.id,
            position=position,
            filename=filename,
            content_type=document.content_type,
            object_key=staged_object_key(job.id, item_id, filename),
            size_bytes=len(document.data),
            source_format=document.source_format,
            status="queued",
        )
        session.add(item)
        items.append((item, document))
    await session.flush()

    for item, document in items:
        await storage.put(item.object_key, document.data, content_type=item.content_type)

    logger.info(
        "document_import_queued",
        job_id=str(job.id),
        space_key=space.key,
        files=len(documents),
        by=creator.username,
    )
    return job


async def get_job_for_user(
    session: AsyncSession, job_id: uuid.UUID, user: User
) -> DocumentImportJob | None:
    """The job, if this user is allowed to watch it.

    Scoped to the creator (or a superuser) rather than to space membership: a
    job's item rows carry the source filenames, which are the uploader's
    business and no one else's.
    """
    job = await session.get(DocumentImportJob, job_id)
    if job is None:
        return None
    if job.created_by_id != user.id and not user.is_superuser:
        return None
    return job


async def list_active_jobs(
    session: AsyncSession, *, space: Space, user: User, limit: int = 5
) -> list[DocumentImportJob]:
    """This user's unfinished imports in this space, newest first.

    Used to re-attach the progress card after a page refresh - without it, a
    reload mid-import looks like the import vanished.
    """
    result = await session.execute(
        select(DocumentImportJob)
        .where(
            DocumentImportJob.space_id == space.id,
            DocumentImportJob.created_by_id == user.id,
            DocumentImportJob.status.in_(ACTIVE_DOCUMENT_IMPORT_STATUSES),
        )
        .order_by(DocumentImportJob.created_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


def to_job_read(job: DocumentImportJob, *, space_key: str) -> DocumentImportJobRead:
    percent, eta_seconds = job_progress(job)
    return DocumentImportJobRead(
        id=job.id,
        space_key=space_key,
        parent_id=job.parent_id,
        status=job.status,
        phase=job.phase,
        conflict_mode=job.conflict_mode,
        counters=dict(job.counters or {}),
        cancel_requested=job.cancel_requested,
        error=job.error,
        percent=percent,
        eta_seconds=eta_seconds,
        started_at=job.started_at,
        heartbeat_at=job.heartbeat_at,
        created_at=job.created_at,
        updated_at=job.updated_at,
        items=[
            DocumentImportItemRead.model_validate(item, from_attributes=True)
            for item in sorted(job.items, key=lambda i: i.position)
        ],
    )


def worker_is_gone(job: DocumentImportJob, *, now: datetime | None = None) -> bool:
    """True when nothing is left running that could observe a cancel flag.

    A `running` row with no heartbeat at all is indistinguishable from an
    abandoned one, which is why the worker stamps both together when it starts.
    """
    if job.heartbeat_at is None:
        return True
    reference = now or datetime.now(UTC)
    return (reference - job.heartbeat_at).total_seconds() > STALE_JOB_AFTER_SECONDS


async def checkpoint_job(
    session: AsyncSession,
    job: DocumentImportJob,
    *,
    counters: dict[str, int] | None = None,
) -> None:
    """Prove the job is alive, honour a pending cancel, and persist progress.

    The refresh matters: `cancel_requested` is written by the API in a
    *different* session, so an in-memory instance would never see it.
    """
    await session.refresh(job)
    if job.cancel_requested:
        raise DocumentImportCancelled
    job.heartbeat_at = datetime.now(UTC)
    if counters:
        job.counters = {**(job.counters or {}), **counters}
    await session.commit()
