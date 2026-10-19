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

import asyncio
import re
import tempfile
import time
import uuid
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from html import escape
from pathlib import Path
from typing import Any
from urllib.parse import quote

import anyio.to_thread
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import rate_limit
from app.core.config import settings
from app.core.exceptions import (
    RateLimitedError,
    ServiceUnavailableError,
    UnsupportedMediaTypeError,
)
from app.core.logging import get_logger
from app.models.document_import import DocumentImportItem, DocumentImportJob
from app.models.page import WikiPage
from app.models.revision import PageRevision
from app.models.space import Space
from app.models.user import User
from app.modules.ai.client import chat_with_usage
from app.modules.ai.config import AIConfig, load_config
from app.modules.attachments.limits import limits_for_space
from app.modules.attachments.store import (
    attachment_content_url,
    prepare_attachment,
)
from app.modules.document_import.convert import extract_document, replace_media_tokens
from app.modules.document_import.normalize import normalize_document_html
from app.modules.document_import.review import MAX_LOG_LINES, Ask, review_import
from app.modules.document_import.sanitize import sanitize_imported_html
from app.modules.document_import.service import (
    STALE_JOB_AFTER_SECONDS,
    DocumentImportCancelled,
    checkpoint_job,
    staged_job_prefix,
)
from app.modules.document_import.translate import (
    LANGUAGES as LANGUAGE_NAMES,
)
from app.modules.document_import.translate import (
    Translate,
    Translation,
    translate_import,
)
from app.modules.pages.service import PageService
from app.modules.stats.recorder import record_ai_usage
from app.schemas.page import PageCreate
from app.schemas.site_settings import EffectiveSettings
from app.services.site_settings import SiteSettingsService
from app.services.storage import ObjectStorage

logger = get_logger(__name__)

#: Truncated before it goes in a `Text` column that a UI will render.
_MAX_ERROR_CHARS = 4000
#: The longest the review of one document may take, model calls included. The import has
#: already succeeded by then: a review that runs out of time leaves the page as converted.
REVIEW_DEADLINE_SECONDS = 240.0
_REVIEW_TOKENS = 3000
#: Translating is many small calls rather than one: this bounds the whole of one document, and
#: what is translated by then is kept. A reply is about as long as what it translates.
TRANSLATE_DEADLINE_SECONDS = 3000.0
_TRANSLATE_TOKENS = 6000
#: What an item's review says while it is still running; the log grows under it.
_RUNNING: dict[str, Any] = {
    "status": "running",
    "issues_before": 0,
    "issues_after": 0,
    "fixes": 0,
    "ai_calls": 0,
    "notes": [],
}


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
    imported: _Imported | None = None
    # One temp directory per file, opened and closed here, so peak disk is one document plus
    # its media rather than the whole batch - and the file is still on disk for the review.
    with tempfile.TemporaryDirectory(prefix="wikihub-docimport-") as workdir_name:
        try:
            # The SAVEPOINT is what makes "one bad file does not break the others"
            # true at the database level rather than merely intended.
            async with session.begin_nested():
                imported = await _import_one(
                    session, storage,
                    job=job, item=item, space=space, creator=creator,
                    effective=effective, written_keys=written_keys,
                    workdir=Path(workdir_name),
                )
            item.status = "complete"
        except DocumentImportCancelled:  # pragma: no cover
            # `_import_one` never checkpoints - the batch loop above only checks
            # for a pending cancel between files (`checkpoint_job` at line 89),
            # never inside one - so nothing currently raises this from here. Kept
            # so a single large/slow file gaining its own mid-file checkpoint
            # later doesn't silently get its cancellation reclassified as a
            # plain failure by the `except Exception` right below.
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

        if imported is not None and job.ai_review:
            # After the page is made and committed, so nothing below can cost the import; and
            # every step of the review is committed as it happens, so the progress card can
            # show it live - see `_review_page`.
            await _review_page(
                session, job=job, item=item, page=imported.page, html=imported.html,
                source=imported.source, creator=creator,
            )
        if imported is not None and job.translate_to:
            # After the review, which reads the file in its own language. The page is made and
            # safe by now, and what is translated is a revision of its own. A workbook's text is
            # in its sheets' pages; its own page is only their names, which stay as they are.
            for translated in imported.children or [imported.page]:
                await _translate_page(
                    session, job=job, item=item, page=translated, creator=creator
                )


@dataclass
class _Imported:
    """A page just made from a file, with what the review needs to look at it again."""

    page: WikiPage
    html: str
    source: Path
    #: The pages made from the file's sections (a workbook's sheets), if any.
    children: list[WikiPage] = field(default_factory=list)


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
    workdir: Path,
) -> _Imported:
    """Convert one staged file into a page, with its images attached.

    The caller owns ``workdir`` (one per file), so the file is still on disk afterwards.
    """
    data = await storage.get(item.object_key)

    source = workdir / item.filename
    await anyio.to_thread.run_sync(source.write_bytes, data)

    extracted = await extract_document(source, filename=item.filename, workdir=workdir)
    html, title, normalize_warnings = normalize_document_html(
        extracted.html,
        filename=item.filename,
    )
    warnings = [*extracted.warnings, *normalize_warnings]

    # `title` is already the filename's stem (see `normalize_document_html`),
    # the same name the pre-import dialog checked for conflicts against.
    # Rename mode keeps both pages with a readable numeric suffix; replace
    # mode updates the existing page.
    conflict_mode = getattr(job, "conflict_mode", None) or "rename"
    existing_page = await _find_import_conflict(
        session, space=space, parent_id=job.parent_id, title=title
    )
    replacing = existing_page is not None and conflict_mode == "replace"
    page_title = title
    if existing_page is not None and not replacing:
        page_title = await _next_available_title(
            session,
            space=space,
            parent_id=job.parent_id,
            title=_strip_copy_suffix(title),
        )

    # The page must exist before anything can be attached to it, and
    # `content=""` sidesteps the length validator entirely - the converted
    # HTML is assigned directly below, after the images resolve.
    if replacing:
        page = existing_page
        page.updated_by_id = creator.id
    else:
        page = await PageService(session).create(
            space,
            PageCreate(title=page_title, content="", parent_id=job.parent_id),
            creator,
        )

    urls, attachment_warnings = await _attach_media(
        session, storage,
        page=page, media=extracted.media, effective=effective, written_keys=written_keys,
    )
    warnings.extend(attachment_warnings)

    children: list[WikiPage] = []
    if extracted.sections:
        # A workbook with several sheets: this page, named after the file, lists
        # them, and each sheet is a child page of it.
        children, section_warnings = await _import_sections(
            session, space=space, parent=page, sections=extracted.sections,
            creator=creator, filename=item.filename,
        )
        warnings.extend(section_warnings)
        html = _sections_index_html(space, children)

    final_html = sanitize_imported_html(replace_media_tokens(html, urls))
    page.content = final_html

    if replacing:
        await PageService(session).snapshot_revision(
            page, creator, f"Replaced by import from {item.filename}"
        )
    else:
        await _fill_first_revision(session, page, final_html, filename=item.filename)

    item.page_id = page.id
    item.page_title = page.title
    item.page_slug = page.slug
    item.attachments_created = len(urls)
    item.warnings = warnings
    item.error = None
    await session.flush()

    return _Imported(page=page, html=final_html, source=source, children=children)


async def _fill_first_revision(
    session: AsyncSession, page: WikiPage, content: str, *, filename: str
) -> None:
    """Put the imported body into the revision ``PageService.create`` wrote.

    That revision v1 holds the empty body the page was created with.
    Back-filling it beats calling `update`, which would leave an empty v1 in
    the history and add a v2 that nobody made.
    """
    revision = (
        await session.execute(
            select(PageRevision).where(
                PageRevision.page_id == page.id, PageRevision.version == 1
            )
        )
    ).scalar_one_or_none()
    if revision is not None:
        revision.content = content
        revision.change_summary = f"Imported from {filename}"


async def _import_sections(
    session: AsyncSession,
    *,
    space: Space,
    parent: WikiPage,
    sections: list[tuple[str, str]],
    creator: User,
    filename: str,
) -> tuple[list[WikiPage], list[str]]:
    """One child page per section (a workbook's sheet), under ``parent``, in order.

    A child with the same title already under ``parent`` can only be there
    because the file was imported before and ``parent`` is being replaced, so
    that child is replaced too - with its old body kept in its history - rather
    than gaining a numbered twin on every refresh.
    """
    service = PageService(session)
    pages: list[WikiPage] = []
    warnings: list[str] = []
    for raw_title, raw_html in sections:
        title = (raw_title.strip() or "Sheet")[:255]
        html, _title, normalize_warnings = normalize_document_html(raw_html, filename=filename)
        warnings.extend(f"{title}: {warning}" for warning in normalize_warnings)
        content = sanitize_imported_html(html)
        existing = await _find_page_by_title(
            session, space=space, parent_id=parent.id, title=title
        )
        if existing is not None:
            existing.content = content
            existing.updated_by_id = creator.id
            await service.snapshot_revision(
                existing, creator, f"Replaced by import from {filename}"
            )
            pages.append(existing)
            continue
        child = await service.create(
            space, PageCreate(title=title, content="", parent_id=parent.id), creator
        )
        child.content = content
        await _fill_first_revision(session, child, content, filename=filename)
        pages.append(child)
    return pages, warnings


def _sections_index_html(space: Space, pages: list[WikiPage]) -> str:
    """The parent page's body: a link to each child page, in the file's order."""
    links = "".join(
        f'<li><p><a href="/spaces/{quote(space.key)}/pages/{quote(page.slug)}">'
        f"{escape(page.title)}</a></p></li>"
        for page in pages
    )
    return f"<ul>{links}</ul>"


def _asker(
    config: AIConfig,
    creator: User,
    *,
    feature: str = "import_review",
    allowance: str = "aireview",
    limit: str | None = None,
    max_tokens: int = _REVIEW_TOKENS,
) -> Ask:
    """The model, for the review or a translation: its own hourly allowance, every call counted."""

    async def ask(system: str, user: str) -> str | None:
        try:
            await rate_limit.enforce(f"{allowance}:{creator.id}", limit or settings.ai_rate_limit)
            reply = await chat_with_usage(
                config,
                [{"role": "system", "content": system}, {"role": "user", "content": user}],
                max_tokens=max_tokens,
                temperature=0.0,
            )
        except (RateLimitedError, ServiceUnavailableError):
            return None
        if reply.usage is not None:
            await record_ai_usage(
                user_id=creator.id,
                feature=feature,
                model=config.model,
                prompt_tokens=reply.usage.prompt_tokens,
                completion_tokens=reply.usage.completion_tokens,
            )
        return reply.text

    return ask


async def _review_page(
    session: AsyncSession,
    *,
    job: DocumentImportJob,
    item: DocumentImportItem,
    page: WikiPage,
    html: str,
    source: Path,
    creator: User,
) -> None:
    """Compare the page with its file and mend it; keep the page as converted when in doubt.

    Every step is committed as it happens (the page itself is already safe), so the progress
    card shows the log while the review runs. The mended page is saved as a revision of its
    own ("Review of the import"), so the page as converted stays one click away in the
    history. Whatever goes wrong here - an unreadable file, the model down, a deadline - is
    recorded on the item and nothing else.
    """
    log: list[str] = []

    async def show(lines: list[str]) -> None:
        log[:] = lines
        item.review = {**_RUNNING, "log": lines[-MAX_LOG_LINES:]}
        await session.commit()

    try:
        config = await load_config(session)
        ask = _asker(config, creator) if config.ready else None
        await show(["Starting the review of the page against its file."])
        review = await asyncio.wait_for(
            review_import(html, source, item.source_format, ask=ask, report=show),
            timeout=REVIEW_DEADLINE_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001 - a review must never cost an import
        logger.warning("document_review_failed", error=type(exc).__name__)
        note = "the review could not finish; the page is as it was converted"
        item.review = {
            "status": "failed",
            "issues_before": 0,
            "issues_after": 0,
            "fixes": 0,
            "ai_calls": 0,
            "notes": [note],
            "log": [*log, "The review could not finish; the page is left as it was converted."][
                -MAX_LOG_LINES:
            ],
        }
    else:
        record = review.as_record()
        if ask is None and review.status not in {"clean", "skipped"}:
            record["notes"] = [
                *record["notes"],
                "the AI assistant is not set up: only certain fixes were made",
            ][:8]
        item.review = record
        if review.html != html:
            page.content = review.html
            await PageService(session).snapshot_revision(
                page, creator, f"Review of the import from {item.filename}: {review.fixes} fixes"
            )
    job.counters = _recount(job, session)
    await session.commit()


_TRANSLATE_FAILED = {
    "status": "failed",
    "language": "",
    "units_total": 0,
    "units_done": 0,
    "units_left": 0,
    "ai_calls": 0,
    "notes": ["the translation could not finish; the page is in its own language"],
}


async def _translate_page(
    session: AsyncSession,
    *,
    job: DocumentImportJob,
    item: DocumentImportItem,
    page: WikiPage,
    creator: User,
) -> None:
    """Translate the page with the AI assistant; the page as it was stays in its history.

    Every step is committed as it happens, like the review, so the card shows the log live. A
    translation that fails or runs out of time leaves the page in its own language and says so;
    what was translated by the deadline is kept. It never costs the import.
    """
    target = job.translate_to or ""
    log: list[str] = []
    # Several calls to the model are in flight at once and each reports as it finishes, but a
    # session does one thing at a time: the saves queue up here.
    saving = asyncio.Lock()

    async def show(progress: Translation) -> None:
        async with saving:
            log[:] = progress.log
            item.translation = progress.as_record()
            await session.commit()

    try:
        config = await load_config(session)
        ask: Translate | None = (
            _asker(
                config,
                creator,
                feature="import_translate",
                allowance="aitranslate",
                limit=settings.ai_translate_rate_limit,
                max_tokens=_TRANSLATE_TOKENS,
            )
            if config.ready
            else None
        )
        result = await translate_import(
            page.content,
            target,
            ask=ask,
            report=show,
            deadline=time.monotonic() + TRANSLATE_DEADLINE_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001 - a translation must never cost an import
        logger.warning("document_translation_failed", error=type(exc).__name__)
        item.translation = {
            **_TRANSLATE_FAILED,
            "language": target,
            "log": [*log, "The translation could not finish; the page is left as it was."][-40:],
        }
    else:
        item.translation = result.as_record()
        if result.status in {"done", "partial"}:
            page.content = sanitize_imported_html(result.html)
            await PageService(session).snapshot_revision(
                page,
                creator,
                f"Translated into {LANGUAGE_NAMES.get(target, target)} by AI "
                f"from {item.filename}",
            )
    job.counters = _recount(job, session)
    await session.commit()


async def _find_page_by_title(
    session: AsyncSession,
    *,
    space: Space,
    parent_id: uuid.UUID | None,
    title: str,
) -> WikiPage | None:
    """Case-insensitive title lookup among one page's siblings.

    Deliberately does not filter by title in SQL. This database's cluster
    locale is `C` (see `POSTGRES_INITDB_ARGS` in docker-compose), under which
    Postgres's own `lower()` leaves accented uppercase letters untouched -
    `lower('TẬP')` returns `'tẬp'`, not `'tập'`. Comparing that against
    Python's locale-independent `.casefold()` would never match a Vietnamese
    title differing only in case, which is exactly how importing the same
    document twice created two pages with the identical title instead of the
    second one getting a numbered suffix. One title's sibling set - the pages
    sharing its `(space, parent)` - is small enough that folding case in
    Python instead costs nothing that matters.
    """
    query = select(WikiPage).where(WikiPage.space_id == space.id)
    if parent_id is None:
        query = query.where(WikiPage.parent_id.is_(None))
    else:
        query = query.where(WikiPage.parent_id == parent_id)
    target = title.strip().casefold()
    siblings = (await session.execute(query)).scalars().all()
    for sibling in siblings:
        if sibling.title.strip().casefold() == target:
            return sibling
    return None


def _strip_copy_suffix(title: str) -> str:
    return re.sub(r"\s*\(\d+\)$", "", title.strip()).strip() or title.strip()


async def _find_import_conflict(
    session: AsyncSession,
    *,
    space: Space,
    parent_id: uuid.UUID | None,
    title: str,
) -> WikiPage | None:
    exact = await _find_page_by_title(
        session, space=space, parent_id=parent_id, title=title
    )
    if exact is not None:
        return exact
    base_title = _strip_copy_suffix(title)
    if base_title == title.strip():
        return None
    return await _find_page_by_title(
        session, space=space, parent_id=parent_id, title=base_title
    )


async def _next_available_title(
    session: AsyncSession,
    *,
    space: Space,
    parent_id: uuid.UUID | None,
    title: str,
) -> str:
    suffix = 1
    while True:
        suffix_text = f" ({suffix})"
        base = title[: 255 - len(suffix_text)].rstrip() or "Imported page"
        candidate = f"{base}{suffix_text}"
        if await _find_page_by_title(
            session, space=space, parent_id=parent_id, title=candidate
        ) is None:
            return candidate
        suffix += 1


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
    reviews = [i.review for i in items if i.review]
    return {
        **(job.counters or {}),
        "items_total": len(items),
        "items_processed": processed,
        "items_failed": failed,
        "pages_created": created,
        "attachments_created": attachments,
        "pages_reviewed": sum(
            1 for r in reviews if r.get("status") not in {"running", "skipped", "failed"}
        ),
        "review_fixes": sum(int(r.get("fixes") or 0) for r in reviews),
        "pages_translated": sum(
            1 for i in items if (i.translation or {}).get("status") in {"done", "partial"}
        ),
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
