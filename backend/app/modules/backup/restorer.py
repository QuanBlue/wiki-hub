"""Full-package ZIP backup restoration and binary media copy/relink."""

from __future__ import annotations

import re
import zipfile
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import delete, func, select

from app.core.exceptions import BadRequestError
from app.core.logging import get_logger
from app.models.attachment import PageAttachment
from app.models.backup_job import BackupJob
from app.models.issue import Issue, IssueAttachment
from app.models.page import WikiPage
from app.models.space import Space
from app.models.user import User
from app.modules.backup.helpers import (
    _PROGRESS_CHECK_EVERY,
    _relink_attachment_references,
    _without_handled_conflicts,
    checkpoint_backup_job,
    log_backup_event,
    observe_backup_cancellation,
)
from app.schemas.backup import ImportReport
from app.services.storage import ObjectStorage

if TYPE_CHECKING:
    from app.modules.backup.service import BackupService

logger = get_logger(__name__)


async def restore_full_package(
    service: BackupService,
    path: str,
    storage: ObjectStorage,
    *,
    dry_run: bool = True,
    overwrite_space_keys: set[str] | None = None,
    space_keys: set[str] | None = None,
    job: BackupJob | None = None,
) -> ImportReport:
    """Restore a checksum-verified full ZIP and its owned binaries.

    ZIP entries are verified before any database or object-store mutation.
    Existing identities/spaces retain the legacy safe ``skip`` behaviour;
    only files belonging to pages/users created by this restore are added.

    ``job`` is optional so the legacy synchronous `/backup/import-zip`
    endpoint can keep calling this with no job to check in with - the
    same shape `export_full_package`'s `job` parameter already uses.
    """
    # The admin-editable site setting (up to 100GB) is what the frontend's
    # own pre-flight check and the Confluence importer already enforce -
    # `settings.max_import_size_bytes` is a separate, env-only, 1GB-by-
    # default fallback that previously silently overrode it here.
    effective = await service.site_settings.get_effective()
    from app.modules.backup import service as _service

    scanned = _service.scan_full_backup(path, max_size_bytes=effective.max_backup_import_size_bytes)
    if job is not None:
        # Scanning a multi-GB archive is itself a long silent stretch (full
        # checksum verification of every entry) - this is the first chance
        # to observe a cancel requested before scanning even finished, and
        # gives the frontend a real total to show a percentage against.
        await log_backup_event(
            service.session,
            job,
            "info",
            "restoring",
            "Archive verified: "
            + ", ".join(
                f"{count} {noun if count == 1 else noun + 's'}"
                for count, noun in (
                    (len(scanned.document.spaces), "space"),
                    (len(scanned.document.pages), "page"),
                    (len(scanned.document.attachments), "attachment"),
                    (len(scanned.document.avatars), "avatar"),
                    (len(scanned.document.covers), "cover"),
                    (len(scanned.document.issues), "issue"),
                )
            )
            + ".",
        )
        await checkpoint_backup_job(
            service.session,
            job,
            counters={
                "items_processed": 0,
                "items_total": len(scanned.document.attachments)
                + len(scanned.document.avatars)
                + len(getattr(scanned.document, "covers", []) or [])
                + sum(len(issue.attachments) for issue in scanned.document.issues),
            },
        )
    requested_overwrites = {
        key.strip().upper() for key in overwrite_space_keys or set() if key.strip()
    }
    incoming_spaces = {space.key.strip().upper() for space in scanned.document.spaces}
    existing_spaces = {
        key.upper(): space_id
        for space_id, key in (await service.session.execute(select(Space.id, Space.key))).all()
    }
    invalid_overwrites = requested_overwrites - incoming_spaces.intersection(existing_spaces)
    if invalid_overwrites:
        raise BadRequestError(
            "Only conflicting spaces in this backup can be overwritten.",
            code="invalid_backup_overwrite",
        )
    old_object_keys: list[str] = []
    restore_savepoint = None
    if requested_overwrites:
        if job is not None:
            await log_backup_event(
                service.session,
                job,
                "warning",
                "restoring",
                f"Replacing {len(requested_overwrites)} existing "
                f"{'space' if len(requested_overwrites) == 1 else 'spaces'}: "
                f"{', '.join(sorted(requested_overwrites))}. Their current pages and "
                "attachments are removed first.",
            )
        restore_savepoint = await service.session.begin_nested()
        page_ids = list(
            (
                await service.session.execute(
                    select(WikiPage.id).where(
                        WikiPage.space_id.in_(
                            [existing_spaces[key] for key in requested_overwrites]
                        )
                    )
                )
            ).scalars()
        )
        if page_ids:
            old_object_keys = list(
                (
                    await service.session.execute(
                        select(PageAttachment.object_key).where(
                            PageAttachment.page_id.in_(page_ids)
                        )
                    )
                ).scalars()
            )
            await service.session.execute(delete(WikiPage).where(WikiPage.id.in_(page_ids)))
            await service.session.flush()
    existing_users = set((await service.session.execute(select(User.username))).scalars())
    # Issues that were here before this restore: their screenshots are left
    # alone, only those of issues the restore creates are copied in.
    existing_issue_ids = set((await service.session.execute(select(Issue.id))).scalars())
    # Normalized the same way `_apply` creates spaces (key.strip().upper())
    # and `SpaceRepository.get_by_key` looks them up - the archive's
    # `page_space_key` carries whatever case the source space had, which
    # can differ from the restored space's canonicalised key.
    existing_page_refs = {
        f"{space_key.upper()}/{slug}"
        for space_key, slug in (
            await service.session.execute(
                select(Space.key, WikiPage.slug)
                .select_from(WikiPage)
                .join(Space, WikiPage.space_id == Space.id)
            )
        ).all()
    }
    try:
        result = await service.import_document(
            scanned.document, dry_run=dry_run, space_keys=space_keys, job=job
        )
    except Exception:
        if restore_savepoint is not None and restore_savepoint.is_active:
            await restore_savepoint.rollback()
        raise
    if dry_run:
        if restore_savepoint is not None and restore_savepoint.is_active:
            await restore_savepoint.rollback()
        result = result.model_copy(update={"dry_run": True})
        return _without_handled_conflicts(result, requested_overwrites)

    if job is not None:
        applied = ", ".join(
            f"{count} {kind.replace('_', ' ')}{'' if count == 1 else 's'}"
            for kind, count in sorted(result.created.items())
            if count
        )
        await log_backup_event(
            service.session,
            job,
            "info",
            "restoring",
            f"Spaces, pages and revisions applied. Created {applied}."
            if applied
            else "Spaces, pages and revisions applied. Nothing new to create.",
        )

    created_object_keys: list[str] = []
    # Every page this restore attached files to, with the ids those files
    # actually landed on - the input to the relink pass below.
    restored_pages: dict[UUID, WikiPage] = {}
    attachment_ids_by_page: dict[UUID, dict[str, UUID]] = {}
    total_items = (
        len(scanned.document.attachments)
        + len(scanned.document.avatars)
        + len(getattr(scanned.document, "covers", []) or [])
        + sum(len(issue.attachments) for issue in scanned.document.issues)
    )
    processed_items = 0
    # One line for the whole file-copying phase, rewritten as it advances.
    # A line per attachment would be the honest per-item log, and would
    # also bury every other phase under a hundred thousand rows on a real
    # backup - the count is what an operator is actually reading for.
    files_log = (
        await log_backup_event(
            service.session,
            job,
            "info",
            "restoring",
            f"Copying 0/{total_items} attachments and profile images into storage.",
        )
        if job is not None and total_items
        else None
    )

    async def _report_progress() -> None:
        nonlocal processed_items
        processed_items += 1
        if job is None or total_items == 0:
            return
        if files_log is not None:
            files_log.message = (
                f"Copying {processed_items}/{total_items} attachments and profile images "
                "into storage."
            )
        # `checkpoint_backup_job` commits - and this loop can be running
        # inside `restore_savepoint`, a still-open SAVEPOINT that must
        # stay uncommitted until the loop finishes so a later failure can
        # roll the destructive overwrite-delete back atomically. A commit
        # here would release that SAVEPOINT early, and the eventual
        # `restore_savepoint.commit()`/`.rollback()` calls below would
        # then be operating on nothing.
        #
        # Progress therefore cannot be reported for the rest of an
        # overwrite restore. Cancellation still can: observing it is a
        # read, and a read is safe inside the savepoint. It used to be
        # skipped along with the commit, which meant an overwrite restore
        # could not be cancelled at all once it got this far - the
        # operator waited on a checkpoint that was never coming.
        if restore_savepoint is not None and restore_savepoint.is_active:
            await observe_backup_cancellation(service.session, job)
            return
        # Same fixed cadence as export's `_report_progress` - never gated
        # on the reported percent changing, so cancellation is still
        # observed after `percent` plateaus at its 99% cap.
        if processed_items % _PROGRESS_CHECK_EVERY != 0 and processed_items != total_items:
            return
        await checkpoint_backup_job(
            service.session,
            job,
            counters={"items_processed": processed_items, "items_total": total_items},
        )

    try:
        with zipfile.ZipFile(path) as archive:
            for attachment in scanned.document.attachments:
                await _report_progress()
                page_label = f"{attachment.page_space_key.upper()}/{attachment.page_slug}"
                if page_label in existing_page_refs:
                    continue
                page = (
                    await service.session.execute(
                        select(WikiPage)
                        .join(Space, WikiPage.space_id == Space.id)
                        .where(
                            func.upper(Space.key) == attachment.page_space_key.upper(),
                            WikiPage.slug == attachment.page_slug,
                        )
                    )
                ).scalar_one_or_none()
                if page is None:
                    continue
                safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", attachment.filename)[:200]
                key = f"attachments/{page.id}/{uuid4()}-{safe_name}"
                # Stream the entry straight into storage rather than
                # `archive.read()`-ing the whole attachment into RAM first -
                # the same fix already applied to export's upload path, for
                # the same reason (a multi-GB attachment must not double its
                # own size in memory just to be restored).
                with archive.open(attachment.object_path) as source:
                    await storage.put(key, source, content_type=attachment.content_type)
                created_object_keys.append(key)
                new_attachment = PageAttachment(
                    page_id=page.id,
                    filename=attachment.filename,
                    content_type=attachment.content_type,
                    object_key=key,
                    size_bytes=attachment.size_bytes,
                )
                # Preserve the original id (same idiom as WikiPage above)
                # so `/api/v1/attachments/<id>` links already baked into
                # this page's restored content keep resolving, unless
                # that id is somehow already taken. Assigned explicitly
                # either way - the column default only fires at flush, and
                # the relink pass below needs the id now.
                if await service.session.get(PageAttachment, attachment.id) is None:
                    new_attachment.id = attachment.id
                else:
                    new_attachment.id = uuid4()
                service.session.add(new_attachment)
                restored_pages[page.id] = page
                attachment_ids_by_page.setdefault(page.id, {}).setdefault(
                    attachment.filename, new_attachment.id
                )
                result.created["attachment"] = result.created.get("attachment", 0) + 1
            for avatar in scanned.document.avatars:
                await _report_progress()
                if avatar.username in existing_users:
                    continue
                user = await service.users.get_by_username(avatar.username)
                if user is None:
                    continue
                key = f"avatars/{user.id}/{uuid4()}"
                with archive.open(avatar.object_path) as source:
                    await storage.put(key, source, content_type=avatar.content_type)
                created_object_keys.append(key)
                user.avatar_object_key = key
                user.avatar_content_type = avatar.content_type
                user.avatar_url = f"/api/v1/users/{user.id}/avatar"
                result.created["avatar"] = result.created.get("avatar", 0) + 1
            for cover in scanned.document.covers:
                await _report_progress()
                if cover.username in existing_users:
                    continue
                user = await service.users.get_by_username(cover.username)
                if user is None:
                    continue
                key = f"covers/{user.id}/{uuid4()}"
                with archive.open(cover.object_path) as source:
                    await storage.put(key, source, content_type=cover.content_type)
                created_object_keys.append(key)
                user.cover_object_key = key
                user.cover_content_type = cover.content_type
                user.cover_url = f"/api/v1/users/{user.id}/cover"
                result.created["cover"] = result.created.get("cover", 0) + 1
            for issue_entry in scanned.document.issues:
                restored_issue = (
                    await service._find_issue(issue_entry) if issue_entry.attachments else None
                )
                for shot in issue_entry.attachments:
                    await _report_progress()
                    if restored_issue is None or restored_issue.id in existing_issue_ids:
                        continue
                    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", shot.filename)[:200]
                    shot_id = (
                        shot.id
                        if await service.session.get(IssueAttachment, shot.id) is None
                        else uuid4()
                    )
                    key = f"issues/{restored_issue.id}/{shot_id}/{safe_name}"
                    with archive.open(shot.object_path) as source:
                        await storage.put(key, source, content_type=shot.content_type)
                    created_object_keys.append(key)
                    service.session.add(
                        IssueAttachment(
                            id=shot_id,
                            issue_id=restored_issue.id,
                            filename=shot.filename[:255],
                            content_type=shot.content_type,
                            object_key=key,
                            size_bytes=shot.size_bytes,
                        )
                    )
                    result.created["issue_attachment"] = (
                        result.created.get("issue_attachment", 0) + 1
                    )

        # Repair attachment links in the content just restored. Runs after
        # every attachment exists so a page's links can be resolved
        # against the full set, and only rewrites references that do not
        # already resolve - see _relink_attachment_references.
        relinked = 0
        for page_id, ids_by_filename in attachment_ids_by_page.items():
            page = restored_pages[page_id]
            repaired = _relink_attachment_references(
                page.content, ids_by_filename, set(ids_by_filename.values())
            )
            if repaired != page.content:
                page.content = repaired
                relinked += 1
        if relinked:
            result.created["relinked_page"] = relinked
            logger.info("backup_restore_relinked_attachments", pages=relinked)

        await service.session.flush()
    except Exception:
        await service.session.rollback()
        for key in created_object_keys:
            try:
                await storage.delete(key)
            except Exception:  # pragma: no cover - best effort after a failed restore
                logger.exception("backup_restore_object_cleanup_failed", object_key=key)
        raise
    if restore_savepoint is not None and restore_savepoint.is_active:
        await restore_savepoint.commit()
        # Object deletion follows a committed database replacement. A failed
        # delete leaves an orphan, never a broken restored attachment.
        await service.session.commit()
        for key in old_object_keys:
            try:
                await storage.delete(key)
            except Exception:  # pragma: no cover - provider outage after commit
                logger.exception("backup_restore_old_object_cleanup_failed", object_key=key)
    return _without_handled_conflicts(result, requested_overwrites)
