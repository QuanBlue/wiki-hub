"""The worker body for a document import.

The shape that matters here is per-file isolation. One malformed `.docx` in a
batch of twelve must cost exactly that file, so each one runs inside its own
SAVEPOINT: a half-created page with three attachments rolls back cleanly, and
the eleven that worked are already committed.

The other shape that matters is ordering. `PageAttachment.page_id` is NOT NULL,
so the page has to exist before its images can be attached, which means the
content cannot be final until after the page is created. See `_import_one`.
"""

from __future__ import annotations

import tempfile
import uuid
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from pathlib import Path

import anyio.to_thread
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import UnsupportedMediaTypeError
from app.core.logging import get_logger
from app.models.document_import import DocumentImportItem, DocumentImportJob
from app.models.revision import PageRevision
from app.models.space import Space
from app.models.user import User
from app.modules.attachments.limits import limits_for_space
from app.modules.attachments.store import (
    attachment_content_url,
    prepare_attachment,
)
from app.modules.document_import.convert import extract_document, replace_media_tokens
from app.modules.document_import.normalize import normalize_document_html
from app.modules.document_import.sanitize import sanitize_imported_html
from app.modules.document_import.service import (
    STALE_JOB_AFTER_SECONDS,
    DocumentImportCancelled,
    checkpoint_job,
    staged_job_prefix,
)
from app.modules.pages.service import PageService
from app.schemas.page import PageCreate
from app.schemas.site_settings import EffectiveSettings
from app.services.site_settings import SiteSettingsService
from app.services.storage import ObjectStorage

logger = get_logger(__name__)

#: Truncated before it goes in a `Text` column that a UI will render.
_MAX_ERROR_CHARS = 4000


async def run_document_import(
    session: AsyncSession, storage: ObjectStorage, job_id: uuid.UUID
) -> None:
    job = await session.get(DocumentImportJob, job_id)
    # Idempotent under arq retry: a job that already ran is not run again.
    if job is None or job.status != "queued":
        return

    job.status, job.phase, job.error = "running", "converting", None
    # Stamped together with the status: a "running" row with no heartbeat is
    # exactly what the reaper treats as abandoned, so one must never be
    # observable merely because the first checkpoint has not happened yet.
    job.started_at = job.heartbeat_at = datetime.now(UTC)
    await session.commit()

    try:
        space = await session.get(Space, job.space_id)
        creator = await session.get(User, job.created_by_id) if job.created_by_id else None
        if space is None or creator is None:
            await _finalize_failed(
                session, job, "The space or the user who started this import no longer exists."
            )
            return

        effective = limits_for_space(
            await SiteSettingsService(session).get_effective(), space
        )
        items = sorted(job.items, key=lambda item: item.position)

        for item in items:
            await checkpoint_job(session, job)
            await _run_one_item(
                session, storage, job=job, item=item, space=space,
                creator=creator, effective=effective,
            )

        await _finalize_complete(session, job, items)

    except DocumentImportCancelled:
        await session.rollback()
        await _finalize_cancelled(session, job_id)
    except Exception as exc:
        await session.rollback()
        await _finalize_failed(session, job, str(exc)[:_MAX_ERROR_CHARS], refetch_id=job_id)
        raise
    finally:
        await _delete_staged_uploads(storage, job_id)


async def _delete_staged_uploads(storage: ObjectStorage, job_id: uuid.UUID) -> None:
    """Staged uploads have no life beyond the job.

    Best effort throughout: failing to tidy up must never turn a finished
    import into a failed one, and leftover objects are visible (and
    deletable) in the admin storage panel.
    """
    prefix = staged_job_prefix(job_id)
    try:
        staged = await storage.list_objects(prefix)
    except Exception:  # noqa: BLE001 - housekeeping is strictly best-effort
        logger.warning("document_import_cleanup_list_failed", job_id=str(job_id))
        return
    for stored in staged:
        with suppress(Exception):
            await storage.delete(stored.key)


async def _run_one_item(
    session: AsyncSession,
    storage: ObjectStorage,
    *,
    job: DocumentImportJob,
    item: DocumentImportItem,
    space: Space,
    creator: User,
    effective: EffectiveSettings,
) -> None:
    item.status = "running"
    await session.commit()

    written_keys: list[str] = []
    try:
        # The SAVEPOINT is what makes "one bad file does not break the others"
        # true at the database level rather than merely intended.
        async with session.begin_nested():
            await _import_one(
                session, storage,
                job=job, item=item, space=space, creator=creator,
                effective=effective, written_keys=written_keys,
            )
        item.status = "complete"
    except DocumentImportCancelled:
        raise
    except Exception as exc:  # noqa: BLE001 - per-file isolation is the whole point
        item.status = "failed"
        item.error = str(exc)[:_MAX_ERROR_CHARS]
        item.page_id = None
        # The rows rolled back with the savepoint; the blobs did not.
        for key in written_keys:
            with suppress(Exception):
                await storage.delete(key)
        logger.warning(
            "document_import_item_failed",
            job_id=str(job.id),
            filename=item.filename,
            error=str(exc)[:200],
        )
    finally:
        job.counters = _recount(job, session)
        await session.commit()


async def _import_one(
    session: AsyncSession,
    storage: ObjectStorage,
    *,
    job: DocumentImportJob,
    item: DocumentImportItem,
    space: Space,
    creator: User,
    effective: EffectiveSettings,
    written_keys: list[str],
) -> None:
    """Convert one staged file into a page, with its images attached.

    One temp directory per file, opened and closed here, so peak disk is one
    document plus its media rather than the whole batch.
    """
    data = await storage.get(item.object_key)

    with tempfile.TemporaryDirectory(prefix="wikihub-docimport-") as workdir_name:
        workdir = Path(workdir_name)
        source = workdir / item.filename
        await anyio.to_thread.run_sync(source.write_bytes, data)

        extracted = await extract_document(source, filename=item.filename, workdir=workdir)
        html, title, normalize_warnings = normalize_document_html(
            extracted.html,
            filename=item.filename,
            metadata_title=extracted.metadata_title,
        )
        warnings = [*extracted.warnings, *normalize_warnings]

        # The page must exist before anything can be attached to it, and
        # `content=""` sidesteps the length validator entirely - the converted
        # HTML is assigned directly below, after the images resolve.
        page = await PageService(session).create(
            space,
            PageCreate(title=title, content="", parent_id=job.parent_id),
            creator,
        )

        urls, attachment_warnings = await _attach_media(
            session, storage,
            page=page, media=extracted.media, effective=effective, written_keys=written_keys,
        )
        warnings.extend(attachment_warnings)

        final_html = sanitize_imported_html(replace_media_tokens(html, urls))
        page.content = final_html

        # `PageService.create` already wrote revision v1 with the empty body.
        # Back-filling it beats calling `update`, which would leave an empty v1
        # in the history and add a v2 that nobody made.
        revision = (
            await session.execute(
                select(PageRevision).where(
                    PageRevision.page_id == page.id, PageRevision.version == 1
                )
            )
        ).scalar_one_or_none()
        if revision is not None:
            revision.content = final_html
            revision.change_summary = f"Imported from {item.filename}"

        item.page_id = page.id
        item.page_title = page.title
        item.page_slug = page.slug
        item.attachments_created = len(urls)
        item.warnings = warnings
        item.error = None
        await session.flush()


async def _attach_media(
    session: AsyncSession,
    storage: ObjectStorage,
    *,
    page,
    media,
    effective: EffectiveSettings,
    written_keys: list[str],
) -> tuple[dict[str, str], list[str]]:
    """Attach every extracted image, returning token -> URL.

    Rows are added and flushed before any blob is written: a database error
    then surfaces while there is still nothing in storage to clean up. The keys
    that *are* written are recorded so the caller can delete them if the
    savepoint later rolls back.
    """
    urls: dict[str, str] = {}
    warnings: list[str] = []
    rejected_by_policy = 0
    pending: list[tuple[object, bytes]] = []

    for image in media:
        try:
            attachment = prepare_attachment(
                page=page,
                filename=image.filename,
                data=image.data,
                content_type=image.content_type,
                effective=effective,
            )
        except UnsupportedMediaTypeError:
            # The workspace allowlist has been narrowed and does not include
            # this image type. The document still imports; the user is told
            # what it cost rather than silently losing every picture.
            rejected_by_policy += 1
            continue
        session.add(attachment)
        pending.append((attachment, image.data))
        urls[image.token] = attachment_content_url(attachment)

    if pending:
        await session.flush()
        for attachment, blob in pending:
            await storage.put(
                attachment.object_key, blob, content_type=attachment.content_type
            )
            written_keys.append(attachment.object_key)

    if rejected_by_policy:
        warnings.append(
            f"{rejected_by_policy} embedded image"
            f"{'s were' if rejected_by_policy != 1 else ' was'} not attached because the "
            "file type is not allowed by this workspace's attachment settings."
        )
    return urls, warnings


def _recount(job: DocumentImportJob, session: AsyncSession) -> dict[str, int]:
    """Progress counters recomputed from the item rows, not incremented.

    Recomputing is what keeps the counters honest across a retry or a partial
    rollback; an incrementing counter drifts the first time something reruns.
    """
    items = job.items
    processed = sum(1 for i in items if i.status in {"complete", "failed"})
    failed = sum(1 for i in items if i.status == "failed")
    created = sum(1 for i in items if i.status == "complete" and i.page_id is not None)
    attachments = sum(i.attachments_created or 0 for i in items)
    return {
        **(job.counters or {}),
        "items_total": len(items),
        "items_processed": processed,
        "items_failed": failed,
        "pages_created": created,
        "attachments_created": attachments,
    }


async def _finalize_complete(
    session: AsyncSession, job: DocumentImportJob, items: list[DocumentImportItem]
) -> None:
    succeeded = sum(1 for item in items if item.status == "complete")
    if succeeded == 0 and items:
        job.status, job.phase = "failed", "failed"
        # An honest terminal state: a green "Complete" over a list of red rows
        # is worse than useless.
        job.error = "No document could be imported."
    else:
        job.status, job.phase = "complete", "complete"
    job.counters = _recount(job, session)
    job.heartbeat_at = datetime.now(UTC)
    await session.commit()
    logger.info(
        "document_import_finished",
        job_id=str(job.id),
        status=job.status,
        pages=job.counters.get("pages_created", 0),
        failed=job.counters.get("items_failed", 0),
    )


async def _finalize_cancelled(session: AsyncSession, job_id: uuid.UUID) -> None:
    job = await session.get(DocumentImportJob, job_id)
    if job is None:
        return
    job.status, job.phase = "cancelled", "cancelled"
    # Files that never started must not sit in the UI as though they still might.
    for item in job.items:
        if item.status in {"queued", "running"}:
            item.status = "cancelled"
    job.counters = _recount(job, session)
    await session.commit()
    logger.info("document_import_cancelled", job_id=str(job_id))


async def _finalize_failed(
    session: AsyncSession,
    job: DocumentImportJob,
    message: str,
    *,
    refetch_id: uuid.UUID | None = None,
) -> None:
    """Write the closing "failed" status, optionally re-reading the row first.

    `refetch_id` is a plain UUID rather than `job.id` on purpose: the only
    caller that needs a refetch is the one that just rolled back, and a
    rollback expires every ORM attribute in the session. Reading `job.id`
    there fires the expired-attribute loader synchronously, which raises
    MissingGreenlet on an async session and kills the finaliser - leaving the
    row stuck on "running" for the reaper to clean up minutes later. Same
    trap, same fix as `_run_restore_job` in `app/modules/backup/jobs.py`.
    """
    if refetch_id is not None:
        refreshed = await session.get(DocumentImportJob, refetch_id)
        if refreshed is None:
            return
        job = refreshed
    job.status, job.phase = "failed", "failed"
    job.error = message
    await session.commit()


async def reap_abandoned_document_imports(
    session: AsyncSession, *, every_running_job: bool = False
) -> int:
    """Finalise "running" jobs whose worker died, and report how many.

    Same contract as `reap_abandoned_export_jobs`, and called from the same
    scheduled sweep rather than adding a second cron entry: without it, a job
    outlives the worker that owned it and leaves a progress bar spinning with
    nothing left to advance it or to observe a Cancel.
    """
    query = select(DocumentImportJob).where(DocumentImportJob.status == "running")
    if not every_running_job:
        cutoff = datetime.now(UTC) - timedelta(seconds=STALE_JOB_AFTER_SECONDS)
        query = query.where(
            or_(
                DocumentImportJob.heartbeat_at.is_(None),
                DocumentImportJob.heartbeat_at < cutoff,
            )
        )
    abandoned = (await session.execute(query)).scalars().all()
    for job in abandoned:
        # Cancellation still wins: a job the user cancelled is reported as
        # cancelled, not as a failure they did not cause.
        if job.cancel_requested:
            job.status, job.phase = "cancelled", "cancelled"
        else:
            job.status, job.phase = "failed", "failed"
            job.error = "The import worker stopped before this job finished."
        for item in job.items:
            if item.status in {"queued", "running"}:
                item.status = job.status
    if abandoned:
        await session.commit()
    return len(abandoned)
