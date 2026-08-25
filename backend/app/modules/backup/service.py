"""Whole-instance backup and restore as a single JSON document.

Scope: accounts, spaces, membership, favourites and instance settings. Page
content is not included because the Pages domain does not exist yet.

**Execution model.** Both entry points are pure ``session in, value out`` — no
``Request``, no ``Response``, no ``UploadFile``. That is deliberate and is the
entire mechanism for moving this to a background job later: an arq task can call
``export_document`` / ``import_document`` unchanged and persist the report on a
job row. Keep HTTP concerns in the router.

**Audit rows are excluded** from the document: their actor foreign keys would
dangle, and restoring them would forge history in the target instance. The
import instead writes one ``backup_imported`` row into the target's own log.
"""

from __future__ import annotations

import hashlib
import html
import json
import re
import zipfile
from collections.abc import Collection, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, NamedTuple
from uuid import UUID, uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import BadRequestError
from app.core.logging import get_logger
from app.models.attachment import PageAttachment
from app.models.audit import AuditAction
from app.models.page import PageLike, WikiPage
from app.models.permission import (
    Group,
    GroupGlobalPermission,
    GroupMember,
    SpaceGroupPermission,
    SpaceUserPermission,
)
from app.models.backup_job import BackupJob
from app.models.restriction import PageGroupRestriction, PageUserRestriction
from app.models.revision import PageRevision
from app.models.space import Space, SpaceFavorite, SpaceMember, SpaceStatus
from app.models.user import User
from app.modules.backup.package import (
    DOCUMENT_PATH,
    FULL_BACKUP_FORMAT,
    FULL_BACKUP_VERSION,
    MANIFEST_PATH,
    ScannedPackage,
    scan_full_backup,
)
from app.modules.permissions.service import ROLE_PERMISSIONS
from app.repositories.space import SpaceRepository
from app.repositories.user import UserRepository
from app.schemas.backup import (
    BACKUP_VERSION,
    MAX_REPORT_ENTRIES,
    SUPPORTED_BACKUP_VERSIONS,
    BackupAttachment,
    BackupAvatar,
    BackupDocument,
    BackupGroup,
    BackupGroupGlobalPermission,
    BackupGroupMember,
    BackupMeta,
    BackupPage,
    BackupPageGroupRestriction,
    BackupPageLike,
    BackupPageRevision,
    BackupPageUserRestriction,
    BackupSiteSettings,
    BackupSpace,
    BackupSpaceFavorite,
    BackupSpaceGroupPermission,
    BackupSpaceMember,
    BackupSpaceUserPermission,
    BackupUser,
    ImportEntry,
    ImportReport,
)
from app.services.audit import AuditService, ClientInfo
from app.services.site_settings import SiteSettingsService
from app.services.storage import ObjectStorage

logger = get_logger(__name__)


class ExportCancelled(Exception):
    """Raised mid-export when an operator sets ``BackupJob.cancel_requested``."""


#: How often (in processed items) the export loops checkpoint: observe
#: `cancel_requested` and refresh the heartbeat. Fixed and small on purpose -
#: large exports must not go long stretches without observing a cancel request.
_PROGRESS_CHECK_EVERY = 25

#: A running job whose heartbeat is older than this is treated as abandoned by
#: its worker. Deliberately generous compared to the checkpoint cadence above:
#: a false positive marks a genuinely running export as failed, so the margin
#: has to absorb one unusually slow item (a very large attachment download).
STALE_JOB_AFTER = timedelta(minutes=5)


async def checkpoint_backup_job(
    session: AsyncSession,
    job: BackupJob,
    *,
    counters: Mapping[str, int] | None = None,
) -> None:
    """Prove the job is alive, honour a pending cancel, and persist progress.

    Every long-running phase of an export calls this. It is the *only* thing
    that lets an operator cancel a job that has already started, and the only
    thing that distinguishes a working job from one whose worker has died.
    """
    # Re-read from the database: `cancel_requested` is written by the API in a
    # different session, so an in-memory copy would never see it.
    await session.refresh(job)
    if job.cancel_requested:
        raise ExportCancelled("Export cancelled by administrator.")
    job.heartbeat_at = datetime.now(UTC)
    if counters:
        job.counters = {**job.counters, **counters}
    await session.commit()


class _PageIndexEntry(NamedTuple):
    """Just enough to resolve `space_key`/`slug`/`parent_slug` references.

    Deliberately not the `WikiPage` row itself, which also carries `content` -
    building this index from full rows (simplest, and what the code used to
    do) means every page's content sits in memory for the whole export just
    to answer "what space/slug does this id belong to", which does not scale.
    """

    space_id: UUID
    slug: str
    parent_id: UUID | None


class _HashingZipEntry:
    """Write UTF-8 text into an open zip entry while tracking a running
    sha256 + byte count, so a large entry's manifest checksum never requires
    holding the whole thing in memory to hash at the end."""

    def __init__(self, handle: Any) -> None:
        self._handle = handle
        self.digest = hashlib.sha256()
        self.size = 0

    def write(self, text: str) -> None:
        data = text.encode("utf-8")
        self._handle.write(data)
        self.digest.update(data)
        self.size += len(data)


#: Any tag carrying an `/api/v1/attachments/<uuid>` reference. Matched as a
#: whole tag (not just the URL) so the filename attribute sitting beside the
#: URL is available to identify what the link was *meant* to point at.
_ATTACHMENT_TAG_RE = re.compile(r"<[^>]*?/api/v1/attachments/[0-9a-fA-F-]{36}[^>]*?>")
_ATTACHMENT_ID_RE = re.compile(r"(/api/v1/attachments/)([0-9a-fA-F-]{36})")
#: In precedence order. `data-attachment` is what the editor writes on an
#: attachment link, `download` what a download anchor carries, and `alt` what
#: an embedded image keeps. Confirmed against real imported content: 346 of
#: 355 references in a production space carry one of these.
_ATTACHMENT_NAME_ATTRS = ("data-attachment", "download", "alt")


def _attachment_name_in(tag: str) -> str | None:
    for attr in _ATTACHMENT_NAME_ATTRS:
        found = re.search(rf'{attr}="([^"]*)"', tag)
        if found:
            # Attribute values are HTML-escaped; attachment filenames are not.
            return html.unescape(found.group(1))
    return None


def _relink_attachment_references(
    content: str,
    ids_by_filename: Mapping[str, UUID],
    valid_ids: Collection[UUID],
) -> str:
    """Repoint `/api/v1/attachments/<id>` links at the attachments that were
    actually restored for this page, identifying them by filename.

    Preserving attachment ids across a round trip (see ``BackupAttachment.id``)
    keeps links working when the archive is internally consistent. It cannot
    help when the archive itself is already broken - which is the normal state
    of any archive exported from an instance that was once restored by an
    older build, since that restore minted fresh ids without touching the
    content still referencing the old ones. Such an archive faithfully
    reproduces its own broken linkage no matter how correct the restore is, so
    the linkage has to be *rebuilt* rather than copied.

    Filename is the identity that survives all of it: the editor writes it into
    the tag next to the URL (`data-attachment`/`download`/`alt`), and it is the
    same string the attachment row stores.

    Deliberately conservative - a reference is only rewritten when the id it
    currently names is **not** a real attachment of this page. A link that
    already resolves is never touched, so a consistent archive restores
    byte-identical and only genuinely broken links are repaired.
    """
    if not content or not ids_by_filename:
        return content

    def rewrite(match: re.Match[str]) -> str:
        tag = match.group(0)
        current = _ATTACHMENT_ID_RE.search(tag)
        if current is None:  # pragma: no cover - guaranteed by _ATTACHMENT_TAG_RE
            return tag
        try:
            if UUID(current.group(2)) in valid_ids:
                return tag  # Already points at one of this page's attachments.
        except ValueError:  # pragma: no cover - the pattern only matches uuids
            return tag
        filename = _attachment_name_in(tag)
        replacement = ids_by_filename.get(filename) if filename else None
        if replacement is None:
            # No filename marker, or it names a file this page never had (a
            # link already dangling in the source instance). Leave it alone
            # rather than guess.
            return tag
        return _ATTACHMENT_ID_RE.sub(rf"\g<1>{replacement}", tag)

    return _ATTACHMENT_TAG_RE.sub(rewrite, content)


def _without_handled_conflicts(result: ImportReport, overwritten: set[str]) -> ImportReport:
    """Drop spaces the caller already chose to overwrite from the conflict list.

    `conflicting_space_keys` exists to ask the admin one question: "these
    spaces already exist - replace them?". An overwrite restore deletes the
    conflicting spaces' *pages* but deliberately keeps the `Space` rows
    themselves, so membership and permissions survive - which means `_apply`
    still reports every one of them as `key_exists`. Left unfiltered, the
    answer to that question comes back as the very same question, and the
    admin is stuck confirming "replace and restore" forever.

    A space named in `overwrite_space_keys` has already been dealt with in
    this run, so it is no longer an open decision.
    """
    if not overwritten:
        return result
    remaining = [key for key in result.conflicting_space_keys if key not in overwritten]
    if len(remaining) == len(result.conflicting_space_keys):
        return result
    return result.model_copy(update={"conflicting_space_keys": remaining})


class _ReportBuilder:
    """Accumulates counts exactly, per-item entries only up to a cap."""

    def __init__(self) -> None:
        self.created: dict[str, int] = {}
        self.skipped: dict[str, int] = {}
        self.errors: dict[str, int] = {}
        self.entries: list[ImportEntry] = []
        self.truncated = False
        #: Not capped like `entries` - the caller needs the exact set of
        #: conflicting space keys to offer a follow-up overwrite restore.
        self.conflicting_space_keys: list[str] = []

    def add(
        self,
        kind: str,
        label: str,
        outcome: Literal["created", "skipped", "error"],
        reason: str = "",
    ) -> None:
        bucket = {"created": self.created, "skipped": self.skipped, "error": self.errors}[outcome]
        bucket[kind] = bucket.get(kind, 0) + 1
        if len(self.entries) < MAX_REPORT_ENTRIES:
            self.entries.append(ImportEntry(kind=kind, label=label, outcome=outcome, reason=reason))
        else:
            self.truncated = True


class BackupService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        actor: User | None = None,
        client: ClientInfo | None = None,
        impersonator: User | None = None,
    ) -> None:
        self.session = session
        self.actor = actor
        self.users = UserRepository(session)
        self.spaces = SpaceRepository(session)
        self.audit = AuditService(session, actor=actor, client=client, impersonator=impersonator)
        self.site_settings = SiteSettingsService(
            session, actor=actor, client=client, impersonator=impersonator
        )

    # -- export ------------------------------------------------------------
    async def export_document(
        self, *, include_credentials: bool = False, space_keys: list[str] | None = None
    ) -> BackupDocument:
        """Serialise the instance.

        ``include_credentials`` defaults to False: the result is a browser
        download that ends up in a Downloads folder, a cloud sync and possibly a
        support ticket, and a file of Argon2 hashes is an offline cracking
        target for every weak password in the instance. Migrating to new
        hardware is a real need, so the opt-in exists — as a deliberate,
        audited choice.

        ``space_keys`` scopes the export to those spaces (empty/None exports
        every space, the default). Users, groups and their memberships/global
        permissions stay unscoped regardless - a restore into a fresh instance
        still needs the full identity graph for the included spaces'
        permissions to resolve. Every space-linked table below already gates
        on its row's space being present in ``spaces_by_id``, so filtering the
        spaces query here is the only change this scoping needs.
        """
        users = list((await self.session.execute(select(User).order_by(User.username))).scalars())
        spaces_query = select(Space).order_by(Space.key)
        if space_keys:
            spaces_query = spaces_query.where(Space.key.in_(space_keys))
        spaces = list((await self.session.execute(spaces_query)).scalars())

        users_by_id = {u.id: u for u in users}
        spaces_by_id = {s.id: s for s in spaces}

        members = list((await self.session.execute(select(SpaceMember))).scalars())
        favorites = list((await self.session.execute(select(SpaceFavorite))).scalars())
        groups = list((await self.session.execute(select(Group).order_by(Group.name))).scalars())
        group_members = list((await self.session.execute(select(GroupMember))).scalars())
        group_permissions = list(
            (await self.session.execute(select(GroupGlobalPermission))).scalars()
        )
        space_user_permissions = list(
            (await self.session.execute(select(SpaceUserPermission))).scalars()
        )
        space_group_permissions = list(
            (await self.session.execute(select(SpaceGroupPermission))).scalars()
        )
        pages = list((await self.session.execute(select(WikiPage))).scalars())
        revisions = list((await self.session.execute(select(PageRevision))).scalars())
        likes = list((await self.session.execute(select(PageLike))).scalars())
        page_user_restrictions = list(
            (await self.session.execute(select(PageUserRestriction))).scalars()
        )
        page_group_restrictions = list(
            (await self.session.execute(select(PageGroupRestriction))).scalars()
        )
        overrides = (await self.site_settings.read()).overrides

        doc_users = []
        for user in users:
            entry = BackupUser.model_validate(user)
            # Never emit a hash unless explicitly requested.
            entry.password_hash = user.password_hash if include_credentials else None
            entry.bio = user.bio
            entry.pronouns = user.pronouns
            entry.profile_url = user.profile_url
            entry.social_links = user.social_links
            entry.company = user.company
            # Never retain internal avatar endpoints without their object data.
            entry.avatar_url = (
                user.avatar_url if user.avatar_url and not user.avatar_object_key else None
            )
            doc_users.append(entry)

        doc_spaces = [
            BackupSpace(
                id=s.id,
                key=s.key,
                name=s.name,
                description=s.description,
                icon=s.icon,
                status=s.status,
                visibility=s.visibility,
                created_at=s.created_at,
                updated_at=s.updated_at,
                created_by_username=(
                    users_by_id[s.created_by_id].username
                    if s.created_by_id in users_by_id
                    else None
                ),
            )
            for s in spaces
        ]

        doc_members = [
            BackupSpaceMember(
                space_key=spaces_by_id[m.space_id].key,
                username=users_by_id[m.user_id].username,
                role=m.role,
            )
            for m in members
            if m.space_id in spaces_by_id and m.user_id in users_by_id
        ]
        doc_favorites = [
            BackupSpaceFavorite(
                username=users_by_id[f.user_id].username,
                space_key=spaces_by_id[f.space_id].key,
            )
            for f in favorites
            if f.space_id in spaces_by_id and f.user_id in users_by_id
        ]
        groups_by_id = {group.id: group for group in groups}
        pages_by_id = {page.id: page for page in pages}
        doc_groups = [
            BackupGroup(
                id=group.id,
                name=group.name,
                description=group.description,
                owner_username=users_by_id[group.owner_id].username,
                is_active=group.is_active,
            )
            for group in groups
            if group.owner_id in users_by_id
        ]
        doc_group_members = [
            BackupGroupMember(
                group_name=groups_by_id[row.group_id].name,
                username=users_by_id[row.user_id].username,
            )
            for row in group_members
            if row.group_id in groups_by_id and row.user_id in users_by_id
        ]
        doc_group_permissions = [
            BackupGroupGlobalPermission(
                group_name=groups_by_id[row.group_id].name,
                permission=row.permission,
            )
            for row in group_permissions
            if row.group_id in groups_by_id
        ]
        doc_space_user_permissions = [
            BackupSpaceUserPermission(
                space_key=spaces_by_id[row.space_id].key,
                username=users_by_id[row.user_id].username,
                permission=row.permission,
            )
            for row in space_user_permissions
            if row.space_id in spaces_by_id and row.user_id in users_by_id
        ]
        doc_space_group_permissions = [
            BackupSpaceGroupPermission(
                space_key=spaces_by_id[row.space_id].key,
                group_name=groups_by_id[row.group_id].name,
                permission=row.permission,
            )
            for row in space_group_permissions
            if row.space_id in spaces_by_id and row.group_id in groups_by_id
        ]
        doc_pages = [
            BackupPage(
                id=page.id,
                space_key=spaces_by_id[page.space_id].key,
                slug=page.slug,
                title=page.title,
                content=page.content,
                content_format=page.content_format,
                parent_slug=pages_by_id[page.parent_id].slug
                if page.parent_id in pages_by_id
                else None,
                created_by_username=(
                    users_by_id[page.created_by_id].username
                    if page.created_by_id in users_by_id
                    else None
                ),
                updated_by_username=(
                    users_by_id[page.updated_by_id].username
                    if page.updated_by_id in users_by_id
                    else None
                ),
                created_by_label=page.created_by_label,
                updated_by_label=page.updated_by_label,
            )
            for page in pages
            if page.space_id in spaces_by_id
        ]
        doc_revisions = [
            BackupPageRevision(
                page_space_key=spaces_by_id[pages_by_id[row.page_id].space_id].key,
                page_slug=pages_by_id[row.page_id].slug,
                version=row.version,
                title=row.title,
                content=row.content,
                content_format=row.content_format,
                created_by_username=(
                    users_by_id[row.created_by_id].username
                    if row.created_by_id in users_by_id
                    else None
                ),
                change_summary=row.change_summary,
            )
            for row in revisions
            if row.page_id in pages_by_id and pages_by_id[row.page_id].space_id in spaces_by_id
        ]
        doc_likes = [
            BackupPageLike(
                page_space_key=spaces_by_id[pages_by_id[row.page_id].space_id].key,
                page_slug=pages_by_id[row.page_id].slug,
                username=users_by_id[row.user_id].username,
            )
            for row in likes
            if row.page_id in pages_by_id
            and row.user_id in users_by_id
            and pages_by_id[row.page_id].space_id in spaces_by_id
        ]
        doc_page_user_restrictions = [
            BackupPageUserRestriction(
                page_space_key=spaces_by_id[pages_by_id[row.page_id].space_id].key,
                page_slug=pages_by_id[row.page_id].slug,
                username=users_by_id[row.user_id].username,
                permission=row.permission,
            )
            for row in page_user_restrictions
            if row.page_id in pages_by_id
            and row.user_id in users_by_id
            and pages_by_id[row.page_id].space_id in spaces_by_id
        ]
        doc_page_group_restrictions = [
            BackupPageGroupRestriction(
                page_space_key=spaces_by_id[pages_by_id[row.page_id].space_id].key,
                page_slug=pages_by_id[row.page_id].slug,
                group_name=groups_by_id[row.group_id].name,
                permission=row.permission,
            )
            for row in page_group_restrictions
            if row.page_id in pages_by_id
            and row.group_id in groups_by_id
            and pages_by_id[row.page_id].space_id in spaces_by_id
        ]

        effective = await self.site_settings.get_effective()
        document = BackupDocument(
            wikihub_backup=BackupMeta(
                version=BACKUP_VERSION,
                exported_at=datetime.now(UTC),
                app_version=settings.project_version,
                site_name=effective.site_name,
                includes_credentials=include_credentials,
                space_keys=space_keys or [],
                counts={
                    "users": len(doc_users),
                    "spaces": len(doc_spaces),
                    "space_members": len(doc_members),
                    "space_favorites": len(doc_favorites),
                    "groups": len(doc_groups),
                    "pages": len(doc_pages),
                    "page_revisions": len(doc_revisions),
                    "page_likes": len(doc_likes),
                    "page_restrictions": len(doc_page_user_restrictions)
                    + len(doc_page_group_restrictions),
                },
            ),
            users=doc_users,
            spaces=doc_spaces,
            space_members=doc_members,
            space_favorites=doc_favorites,
            groups=doc_groups,
            group_members=doc_group_members,
            group_global_permissions=doc_group_permissions,
            space_user_permissions=doc_space_user_permissions,
            space_group_permissions=doc_space_group_permissions,
            pages=doc_pages,
            page_revisions=doc_revisions,
            page_likes=doc_likes,
            page_user_restrictions=doc_page_user_restrictions,
            page_group_restrictions=doc_page_group_restrictions,
            site_settings=BackupSiteSettings(**overrides.model_dump()),
        )

        logger.info(
            "backup_exported",
            users=len(doc_users),
            spaces=len(doc_spaces),
            credentials=include_credentials,
        )
        await self.audit.record(
            AuditAction.backup_exported,
            entity_type="instance",
            entity_label=effective.site_name,
            details={
                "include_credentials": include_credentials,
                "counts": document.wikihub_backup.counts,
            },
        )
        return document

    async def export_full_package(
        self,
        path: str,
        storage: ObjectStorage,
        *,
        include_credentials: bool = False,
        space_keys: list[str] | None = None,
        job: BackupJob | None = None,
    ) -> dict[str, Any]:
        """Create the portable ZIP artifact, including every referenced binary.

        The document deliberately records archive paths rather than source
        object keys; storage layouts are implementation details and must never
        leak into a restore target.

        Deliberately does **not** build on :meth:`export_document`: that
        method holds every page and every page revision's full content in
        memory at once as one Pydantic tree, which is fine for a small
        instance but is what OOM-killed the export worker on a real
        ~5000-attachment, many-revision instance in practice (fixed
        2026-08-25). This method instead streams attachments, avatars, pages
        and page revisions - the things that scale with instance size rather
        than with schema size - straight into the archive one batch at a
        time, so peak memory stays bounded regardless of how large the
        instance is. Small, schema-sized tables (users, spaces, memberships,
        permissions, ...) are still built as ordinary Python objects; nothing
        in the whole instance except its content is proportionally large.

        ``job`` is optional and only used to report incremental progress /
        observe cancellation while the potentially slow, memory-sensitive
        work happens - passing it is what lets the admin UI show a real
        percent/ETA and a working Cancel button instead of an indeterminate
        spinner.
        """
        PAGE_BATCH = 500

        if job is not None:
            await checkpoint_backup_job(self.session, job)

        users = list((await self.session.execute(select(User).order_by(User.username))).scalars())
        spaces_query = select(Space).order_by(Space.key)
        if space_keys:
            spaces_query = spaces_query.where(Space.key.in_(space_keys))
        spaces = list((await self.session.execute(spaces_query)).scalars())
        users_by_id = {u.id: u for u in users}
        spaces_by_id = {s.id: s for s in spaces}
        avatar_users = [user for user in users if user.avatar_object_key]

        members = list((await self.session.execute(select(SpaceMember))).scalars())
        favorites = list((await self.session.execute(select(SpaceFavorite))).scalars())
        groups = list((await self.session.execute(select(Group).order_by(Group.name))).scalars())
        group_members = list((await self.session.execute(select(GroupMember))).scalars())
        group_permissions = list(
            (await self.session.execute(select(GroupGlobalPermission))).scalars()
        )
        space_user_permissions = list(
            (await self.session.execute(select(SpaceUserPermission))).scalars()
        )
        space_group_permissions = list(
            (await self.session.execute(select(SpaceGroupPermission))).scalars()
        )
        groups_by_id = {group.id: group for group in groups}

        page_index_query = select(
            WikiPage.id, WikiPage.space_id, WikiPage.slug, WikiPage.parent_id
        )
        if space_keys:
            page_index_query = page_index_query.where(WikiPage.space_id.in_(spaces_by_id.keys()))
        pages_index: dict[UUID, _PageIndexEntry] = {
            row.id: _PageIndexEntry(space_id=row.space_id, slug=row.slug, parent_id=row.parent_id)
            for row in (await self.session.execute(page_index_query)).all()
            if row.space_id in spaces_by_id
        }
        revisions_total = (
            await self.session.execute(
                select(func.count())
                .select_from(PageRevision)
                .where(PageRevision.page_id.in_(pages_index.keys()))
            )
        ).scalar_one() if pages_index else 0

        attachments = list((await self.session.execute(select(PageAttachment))).scalars())
        likes = list((await self.session.execute(select(PageLike))).scalars())
        page_user_restrictions = list(
            (await self.session.execute(select(PageUserRestriction))).scalars()
        )
        page_group_restrictions = list(
            (await self.session.execute(select(PageGroupRestriction))).scalars()
        )
        overrides = (await self.site_settings.read()).overrides
        effective = await self.site_settings.get_effective()

        def _page_space_key(page_id: UUID) -> str | None:
            entry = pages_index.get(page_id)
            return spaces_by_id[entry.space_id].key if entry and entry.space_id in spaces_by_id else None

        doc_users = []
        for user in users:
            entry = BackupUser.model_validate(user)
            entry.password_hash = user.password_hash if include_credentials else None
            entry.avatar_url = (
                user.avatar_url if user.avatar_url and not user.avatar_object_key else None
            )
            doc_users.append(entry)
        doc_spaces = [
            BackupSpace(
                id=s.id, key=s.key, name=s.name, description=s.description, icon=s.icon,
                status=s.status, visibility=s.visibility, created_at=s.created_at, updated_at=s.updated_at,
                created_by_username=users_by_id[s.created_by_id].username if s.created_by_id in users_by_id else None,
            )
            for s in spaces
        ]
        doc_members = [
            BackupSpaceMember(space_key=spaces_by_id[m.space_id].key, username=users_by_id[m.user_id].username, role=m.role)
            for m in members if m.space_id in spaces_by_id and m.user_id in users_by_id
        ]
        doc_favorites = [
            BackupSpaceFavorite(username=users_by_id[f.user_id].username, space_key=spaces_by_id[f.space_id].key)
            for f in favorites if f.space_id in spaces_by_id and f.user_id in users_by_id
        ]
        doc_groups = [
            BackupGroup(id=g.id, name=g.name, description=g.description, owner_username=users_by_id[g.owner_id].username, is_active=g.is_active)
            for g in groups if g.owner_id in users_by_id
        ]
        doc_group_members = [
            BackupGroupMember(group_name=groups_by_id[row.group_id].name, username=users_by_id[row.user_id].username)
            for row in group_members if row.group_id in groups_by_id and row.user_id in users_by_id
        ]
        doc_group_permissions = [
            BackupGroupGlobalPermission(group_name=groups_by_id[row.group_id].name, permission=row.permission)
            for row in group_permissions if row.group_id in groups_by_id
        ]
        doc_space_user_permissions = [
            BackupSpaceUserPermission(space_key=spaces_by_id[row.space_id].key, username=users_by_id[row.user_id].username, permission=row.permission)
            for row in space_user_permissions if row.space_id in spaces_by_id and row.user_id in users_by_id
        ]
        doc_space_group_permissions = [
            BackupSpaceGroupPermission(space_key=spaces_by_id[row.space_id].key, group_name=groups_by_id[row.group_id].name, permission=row.permission)
            for row in space_group_permissions if row.space_id in spaces_by_id and row.group_id in groups_by_id
        ]
        doc_likes = [
            BackupPageLike(page_space_key=_page_space_key(row.page_id), page_slug=pages_index[row.page_id].slug, username=users_by_id[row.user_id].username)
            for row in likes if row.page_id in pages_index and row.user_id in users_by_id and _page_space_key(row.page_id)
        ]
        doc_page_user_restrictions = [
            BackupPageUserRestriction(page_space_key=_page_space_key(row.page_id), page_slug=pages_index[row.page_id].slug, username=users_by_id[row.user_id].username, permission=row.permission)
            for row in page_user_restrictions if row.page_id in pages_index and row.user_id in users_by_id and _page_space_key(row.page_id)
        ]
        doc_page_group_restrictions = [
            BackupPageGroupRestriction(page_space_key=_page_space_key(row.page_id), page_slug=pages_index[row.page_id].slug, group_name=groups_by_id[row.group_id].name, permission=row.permission)
            for row in page_group_restrictions if row.page_id in pages_index and row.group_id in groups_by_id and _page_space_key(row.page_id)
        ]

        total_items = len(attachments) + len(avatar_users) + len(pages_index) + revisions_total
        processed_items = 0

        async def _report_progress() -> None:
            nonlocal processed_items
            processed_items += 1
            if job is None or total_items == 0:
                return
            # Checked on a fixed item cadence - NOT gated on the reported percent
            # changing. `percent` below is capped at 99 (`min(99, ...)`), so once
            # the count crosses that cap every later item reports the same
            # percent forever; gating the check on "percent changed" would stop
            # observing `cancel_requested` for the remainder of a large export.
            # The last item always checks too, so a short (<PROGRESS_CHECK_EVERY)
            # export still gets one cancellation check at its very end.
            if (
                processed_items % _PROGRESS_CHECK_EVERY != 0
                and processed_items != total_items
            ):
                return
            await checkpoint_backup_job(
                self.session,
                job,
                counters={"items_processed": processed_items, "items_total": total_items},
            )

        document = BackupDocument(
            wikihub_backup=BackupMeta(
                version=BACKUP_VERSION,
                exported_at=datetime.now(UTC),
                app_version=settings.project_version,
                site_name=effective.site_name,
                includes_credentials=include_credentials,
                space_keys=space_keys or [],
                counts={
                    "users": len(doc_users),
                    "spaces": len(doc_spaces),
                    "space_members": len(doc_members),
                    "space_favorites": len(doc_favorites),
                    "groups": len(doc_groups),
                    "pages": len(pages_index),
                    "page_revisions": revisions_total,
                    "page_likes": len(doc_likes),
                    "page_restrictions": len(doc_page_user_restrictions) + len(doc_page_group_restrictions),
                },
            ),
            users=doc_users, spaces=doc_spaces, space_members=doc_members, space_favorites=doc_favorites,
            groups=doc_groups, group_members=doc_group_members, group_global_permissions=doc_group_permissions,
            space_user_permissions=doc_space_user_permissions, space_group_permissions=doc_space_group_permissions,
            pages=[], page_revisions=[],
            page_likes=doc_likes, page_user_restrictions=doc_page_user_restrictions, page_group_restrictions=doc_page_group_restrictions,
            site_settings=BackupSiteSettings(**overrides.model_dump()),
        )

        # Attachment/avatar bytes, and page/revision content, are streamed
        # straight into the archive rather than collected into a list first -
        # only the small per-item metadata (digest, size) needs to outlive
        # each fetch. See the docstring above for why.
        entry_checksums: list[dict[str, Any]] = []
        written_paths: set[str] = set()

        def _write_once(archive: zipfile.ZipFile, object_path: str, digest: str, data: bytes) -> None:
            # Identical bytes may belong to multiple records. Archive paths
            # are content-addressed, so write each distinct object only once.
            if object_path in written_paths:
                return
            written_paths.add(object_path)
            archive.writestr(object_path, data)
            entry_checksums.append({"path": object_path, "sha256": digest, "size_bytes": len(data)})

        with zipfile.ZipFile(
            path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6
        ) as archive:
            for attachment in attachments:
                page_space_key = _page_space_key(attachment.page_id)
                if page_space_key is None:
                    continue
                data = await storage.get(attachment.object_key)
                digest = hashlib.sha256(data).hexdigest()
                object_path = f"objects/attachments/{digest}"
                document.attachments.append(
                    BackupAttachment(
                        id=attachment.id, page_space_key=page_space_key, page_slug=pages_index[attachment.page_id].slug,
                        filename=attachment.filename, content_type=attachment.content_type,
                        object_path=object_path, sha256=digest, size_bytes=len(data),
                    )
                )
                _write_once(archive, object_path, digest, data)
                del data
                await _report_progress()
            for user in avatar_users:
                data = await storage.get(user.avatar_object_key)
                digest = hashlib.sha256(data).hexdigest()
                content_type = user.avatar_content_type or "application/octet-stream"
                object_path = f"objects/avatars/{digest}"
                document.avatars.append(
                    BackupAvatar(username=user.username, content_type=content_type, object_path=object_path, sha256=digest, size_bytes=len(data))
                )
                _write_once(archive, object_path, digest, data)
                del data
                await _report_progress()

            document.wikihub_backup.counts.update(
                {"attachments": len(document.attachments), "avatars": len(document.avatars)}
            )

            # `document.pages`/`.page_revisions` are still `[]` here - splice
            # their streamed content into this "shell" rather than building
            # the whole thing (page/revision content included) as one string.
            shell = document.model_dump_json(indent=None)
            pages_marker, revisions_marker = '"pages":[]', '"page_revisions":[]'
            pages_at = shell.index(pages_marker)
            before_pages = shell[:pages_at] + '"pages":['
            after_pages = shell[pages_at + len(pages_marker) - 1:]  # keeps the leading "]"
            revisions_at = after_pages.index(revisions_marker)
            between = after_pages[:revisions_at] + '"page_revisions":['
            after_revisions = after_pages[revisions_at + len(revisions_marker) - 1:]  # keeps the leading "]"

            with archive.open(DOCUMENT_PATH, "w") as handle:
                writer = _HashingZipEntry(handle)
                writer.write(before_pages)

                async def _page_batches():
                    page_ids = list(pages_index.keys())
                    for offset in range(0, len(page_ids), PAGE_BATCH):
                        batch_ids = page_ids[offset : offset + PAGE_BATCH]
                        rows = (
                            await self.session.execute(
                                select(
                                    WikiPage.id, WikiPage.slug, WikiPage.title, WikiPage.content,
                                    WikiPage.content_format, WikiPage.parent_id, WikiPage.created_by_id,
                                    WikiPage.updated_by_id, WikiPage.created_by_label, WikiPage.updated_by_label,
                                ).where(WikiPage.id.in_(batch_ids))
                            )
                        ).all()
                        yield rows

                first = True
                async for batch in _page_batches():
                    for row in batch:
                        parent = pages_index.get(row.parent_id) if row.parent_id else None
                        page_model = BackupPage(
                            id=row.id, space_key=spaces_by_id[pages_index[row.id].space_id].key,
                            slug=row.slug, title=row.title, content=row.content, content_format=row.content_format,
                            parent_slug=parent.slug if parent else None,
                            created_by_username=users_by_id[row.created_by_id].username if row.created_by_id in users_by_id else None,
                            updated_by_username=users_by_id[row.updated_by_id].username if row.updated_by_id in users_by_id else None,
                            created_by_label=row.created_by_label, updated_by_label=row.updated_by_label,
                        )
                        if not first:
                            writer.write(",")
                        first = False
                        writer.write(page_model.model_dump_json())
                        del page_model
                        await _report_progress()
                    if job is not None:
                        await checkpoint_backup_job(self.session, job)

                writer.write(between)

                first = True
                page_ids = list(pages_index.keys())
                for offset in range(0, revisions_total, PAGE_BATCH):
                    rows = (
                        await self.session.execute(
                            select(
                                PageRevision.page_id, PageRevision.version, PageRevision.title,
                                PageRevision.content, PageRevision.content_format,
                                PageRevision.created_by_id, PageRevision.change_summary,
                            )
                            .where(PageRevision.page_id.in_(page_ids))
                            .order_by(PageRevision.id)
                            .limit(PAGE_BATCH)
                            .offset(offset)
                        )
                    ).all()
                    for row in rows:
                        entry = pages_index.get(row.page_id)
                        if entry is None or entry.space_id not in spaces_by_id:
                            continue
                        revision_model = BackupPageRevision(
                            page_space_key=spaces_by_id[entry.space_id].key, page_slug=entry.slug, version=row.version,
                            title=row.title, content=row.content, content_format=row.content_format,
                            created_by_username=users_by_id[row.created_by_id].username if row.created_by_id in users_by_id else None,
                            change_summary=row.change_summary,
                        )
                        if not first:
                            writer.write(",")
                        first = False
                        writer.write(revision_model.model_dump_json())
                        del revision_model
                        await _report_progress()
                    if job is not None:
                        await checkpoint_backup_job(self.session, job)

                writer.write(after_revisions)

            entry_checksums.insert(
                0, {"path": DOCUMENT_PATH, "sha256": writer.digest.hexdigest(), "size_bytes": writer.size}
            )
            entry_checksums.sort(key=lambda entry: entry["path"])
            manifest = {
                "format": FULL_BACKUP_FORMAT,
                "version": FULL_BACKUP_VERSION,
                "created_at": datetime.now(UTC).isoformat(),
                "includes_credentials": include_credentials,
                "counts": document.wikihub_backup.counts,
                "entries": entry_checksums,
            }
            archive.writestr(MANIFEST_PATH, json.dumps(manifest, separators=(",", ":")))
        return manifest

    @staticmethod
    def scan_full_package(path: str, *, max_size_bytes: int | None = None) -> ScannedPackage:
        return scan_full_backup(path, max_size_bytes=max_size_bytes)

    async def restore_full_package(
        self,
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
        effective = await self.site_settings.get_effective()
        scanned = scan_full_backup(path, max_size_bytes=effective.max_backup_import_size_bytes)
        if job is not None:
            # Scanning a multi-GB archive is itself a long silent stretch (full
            # checksum verification of every entry) - this is the first chance
            # to observe a cancel requested before scanning even finished, and
            # gives the frontend a real total to show a percentage against.
            await checkpoint_backup_job(
                self.session,
                job,
                counters={
                    "items_processed": 0,
                    "items_total": len(scanned.document.attachments)
                    + len(scanned.document.avatars),
                },
            )
        requested_overwrites = {
            key.strip().upper() for key in overwrite_space_keys or set() if key.strip()
        }
        incoming_spaces = {space.key.strip().upper() for space in scanned.document.spaces}
        existing_spaces = {
            key.upper(): space_id
            for space_id, key in (await self.session.execute(select(Space.id, Space.key))).all()
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
            restore_savepoint = await self.session.begin_nested()
            page_ids = list(
                (
                    await self.session.execute(
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
                        await self.session.execute(
                            select(PageAttachment.object_key).where(
                                PageAttachment.page_id.in_(page_ids)
                            )
                        )
                    ).scalars()
                )
                await self.session.execute(delete(WikiPage).where(WikiPage.id.in_(page_ids)))
                await self.session.flush()
        existing_users = set((await self.session.execute(select(User.username))).scalars())
        # Normalized the same way `_apply` creates spaces (key.strip().upper())
        # and `SpaceRepository.get_by_key` looks them up - the archive's
        # `page_space_key` carries whatever case the source space had, which
        # can differ from the restored space's canonicalised key.
        existing_page_refs = {
            f"{space_key.upper()}/{slug}"
            for space_key, slug in (
                await self.session.execute(
                    select(Space.key, WikiPage.slug)
                    .select_from(WikiPage)
                    .join(Space, WikiPage.space_id == Space.id)
                )
            ).all()
        }
        try:
            result = await self.import_document(
                scanned.document, dry_run=dry_run, space_keys=space_keys
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

        created_object_keys: list[str] = []
        # Every page this restore attached files to, with the ids those files
        # actually landed on - the input to the relink pass below.
        restored_pages: dict[UUID, WikiPage] = {}
        attachment_ids_by_page: dict[UUID, dict[str, UUID]] = {}
        total_items = len(scanned.document.attachments) + len(scanned.document.avatars)
        processed_items = 0

        async def _report_progress() -> None:
            nonlocal processed_items
            processed_items += 1
            if job is None or total_items == 0:
                return
            # `checkpoint_backup_job` commits - and this loop can be running
            # inside `restore_savepoint`, a still-open SAVEPOINT that must
            # stay uncommitted until the loop finishes so a later failure can
            # roll the destructive overwrite-delete back atomically. A commit
            # here would release that SAVEPOINT early, and the eventual
            # `restore_savepoint.commit()`/`.rollback()` calls below would
            # then be operating on nothing. Skip checkpointing (progress and
            # cancellation both) for the rest of an overwrite restore rather
            # than risk that; the scan-time checkpoint above still gives the
            # operator one chance to cancel before this savepoint even opens.
            if restore_savepoint is not None and restore_savepoint.is_active:
                return
            # Same fixed cadence as export's `_report_progress` - never gated
            # on the reported percent changing, so cancellation is still
            # observed after `percent` plateaus at its 99% cap.
            if (
                processed_items % _PROGRESS_CHECK_EVERY != 0
                and processed_items != total_items
            ):
                return
            await checkpoint_backup_job(
                self.session,
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
                        await self.session.execute(
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
                    if await self.session.get(PageAttachment, attachment.id) is None:
                        new_attachment.id = attachment.id
                    else:
                        new_attachment.id = uuid4()
                    self.session.add(new_attachment)
                    restored_pages[page.id] = page
                    attachment_ids_by_page.setdefault(page.id, {}).setdefault(
                        attachment.filename, new_attachment.id
                    )
                    result.created["attachment"] = result.created.get("attachment", 0) + 1
                for avatar in scanned.document.avatars:
                    await _report_progress()
                    if avatar.username in existing_users:
                        continue
                    user = await self.users.get_by_username(avatar.username)
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

            await self.session.flush()
        except Exception:
            await self.session.rollback()
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
            await self.session.commit()
            for key in old_object_keys:
                try:
                    await storage.delete(key)
                except Exception:  # pragma: no cover - provider outage after commit
                    logger.exception("backup_restore_old_object_cleanup_failed", object_key=key)
        return _without_handled_conflicts(result, requested_overwrites)

    # -- import ------------------------------------------------------------
    async def import_document(
        self,
        doc: BackupDocument,
        *,
        dry_run: bool = True,
        space_keys: set[str] | None = None,
    ) -> ImportReport:
        """Restore a document. Conflicts are **skipped and reported**, never
        overwritten.

        Overwriting on a restore is destructive with no undo and no diff to
        review, while "skip and tell me" composes with the dry run into
        something an operator can reason about. The genuine use case — restoring
        into an empty instance — never hits a conflict at all.

        The dry run executes the *identical* code path inside a SAVEPOINT that
        is then rolled back. A separate validation routine would inevitably
        drift from the real one, which is the classic bug in this feature; this
        way even database-level conflicts are exercised for real.

        ``space_keys`` (empty/None means "every space in the archive", mirroring
        the export side's convention) only needs to filter ``doc.spaces`` -
        every other loop in ``_apply`` resolves its space by key through
        ``self.spaces.get_by_key(...)`` rather than iterating ``doc.spaces``
        again, so a page/member/permission belonging to an excluded space
        naturally reports "missing_space" once that space is never created.
        Users, groups and their global permissions are never scoped, same as
        on export.
        """
        if doc.wikihub_backup.version not in SUPPORTED_BACKUP_VERSIONS:
            raise BadRequestError(
                f"Unsupported backup version {doc.wikihub_backup.version}; "
                f"this build reads version {BACKUP_VERSION}.",
                code="unsupported_backup_version",
            )
        if space_keys:
            allowed = {key.strip().upper() for key in space_keys if key.strip()}
            doc = doc.model_copy(
                update={
                    "spaces": [
                        space for space in doc.spaces if space.key.strip().upper() in allowed
                    ]
                }
            )

        report = _ReportBuilder()
        no_password: list[str] = []

        savepoint = await self.session.begin_nested()
        try:
            await self._apply(doc, report, no_password)
        except Exception:
            # A restore is all-or-nothing. In particular, never commit rows
            # already flushed before a later relationship/constraint failure.
            if savepoint.is_active:
                await savepoint.rollback()
            raise
        else:
            if dry_run:
                await savepoint.rollback()
            elif savepoint.is_active:
                await savepoint.commit()

        result = ImportReport(
            dry_run=dry_run,
            version=doc.wikihub_backup.version,
            includes_credentials=doc.wikihub_backup.includes_credentials,
            created=report.created,
            skipped=report.skipped,
            errors=report.errors,
            users_without_password=sorted(no_password),
            entries=report.entries,
            entries_truncated=report.truncated,
            conflicting_space_keys=sorted(report.conflicting_space_keys),
        )

        # Written outside the savepoint so it survives a dry run: an attempted
        # restore is itself an event worth recording.
        logger.info("backup_imported", dry_run=dry_run, created=result.created)
        await self.audit.record(
            AuditAction.backup_imported,
            entity_type="instance",
            entity_label=doc.wikihub_backup.site_name,
            details={
                "dry_run": dry_run,
                "created": result.created,
                "skipped": result.skipped,
                "errors": result.errors,
            },
        )
        return result

    async def _apply(
        self, doc: BackupDocument, report: _ReportBuilder, no_password: list[str]
    ) -> None:
        protected = await self.users.get_protected()

        # --- users --------------------------------------------------------
        for user_entry in doc.users:
            username = user_entry.username.strip()
            if protected is not None and (
                username.lower() == protected.username.lower()
                or user_entry.email.strip().lower() == protected.email.lower()
            ):
                # Never merge into or rename the local protected admin. Without
                # this, the uq_users_single_protected index would raise and
                # abort the entire import.
                report.add("user", username, "skipped", "conflicts_with_protected_account")
                continue
            if await self.users.get_by_username(username):
                report.add("user", username, "skipped", "username_exists")
                continue
            if await self.users.get_by_email(user_entry.email):
                report.add("user", username, "skipped", "email_exists")
                continue

            user = User(
                username=username,
                email=user_entry.email.strip().lower(),
                full_name=user_entry.full_name.strip(),
                password_hash=user_entry.password_hash,
                bio=user_entry.bio.strip(),
                pronouns=user_entry.pronouns.strip(),
                profile_url=user_entry.profile_url.strip(),
                social_links=[str(link).strip() for link in user_entry.social_links],
                company=user_entry.company.strip(),
                avatar_url=user_entry.avatar_url,
                is_active=user_entry.is_active,
                is_superuser=user_entry.is_superuser,
                # Hardcoded False - the single most important line here. A
                # backup must not be able to introduce a protected account.
                is_protected=False,
            )
            # Preserve the original id when it is free, so references elsewhere
            # in an operator's notes still line up.
            if user_entry.id and await self.users.get(user_entry.id) is None:
                user.id = user_entry.id
            self.session.add(user)
            await self.session.flush()

            if not user_entry.password_hash:
                no_password.append(username)
            report.add("user", username, "created")

        # --- spaces -------------------------------------------------------
        for space_entry in doc.spaces:
            key = space_entry.key.strip().upper()
            if await self.spaces.get_by_key(key):
                report.add("space", key, "skipped", "key_exists")
                report.conflicting_space_keys.append(key)
                continue

            creator = (
                await self.users.get_by_username(space_entry.created_by_username)
                if space_entry.created_by_username
                else None
            )
            space = Space(
                key=key,
                name=space_entry.name.strip(),
                description=space_entry.description.strip(),
                icon=space_entry.icon.strip(),
                status=space_entry.status or SpaceStatus.active,
                visibility=space_entry.visibility,
                created_by_id=creator.id if creator else None,
            )
            if space_entry.id and await self.spaces.get(space_entry.id) is None:
                space.id = space_entry.id
            self.session.add(space)
            await self.session.flush()
            report.add("space", key, "created")

        # --- membership ---------------------------------------------------
        # Distinct variable names per loop: reusing `space`/`user` from the
        # blocks above shadows non-optional locals with optional ones.
        for member in doc.space_members:
            member_label = f"{member.space_key}/{member.username}"
            member_space = await self.spaces.get_by_key(member.space_key)
            member_user = await self.users.get_by_username(member.username)
            if member_space is None:
                report.add("space_member", member_label, "skipped", "missing_space")
                continue
            if member_user is None:
                report.add("space_member", member_label, "skipped", "missing_user")
                continue
            if await self.spaces.get_member(member_space.id, member_user.id):
                report.add("space_member", member_label, "skipped", "already_member")
                continue
            self.session.add(
                SpaceMember(space_id=member_space.id, user_id=member_user.id, role=member.role)
            )
            await self.session.flush()
            # Authorization now reads additive permission assignments. Keep
            # the legacy membership row for rollback/backup compatibility,
            # but restore its effective permissions as well.
            for permission in ROLE_PERMISSIONS[member.role]:
                self.session.add(
                    SpaceUserPermission(
                        space_id=member_space.id,
                        user_id=member_user.id,
                        permission=permission,
                    )
                )
            await self.session.flush()
            report.add("space_member", member_label, "created")

        # --- favourites ---------------------------------------------------
        for favorite in doc.space_favorites:
            fav_label = f"{favorite.space_key}/{favorite.username}"
            fav_space = await self.spaces.get_by_key(favorite.space_key)
            fav_user = await self.users.get_by_username(favorite.username)
            if fav_space is None or fav_user is None:
                report.add("space_favorite", fav_label, "skipped", "missing_reference")
                continue
            if await self.spaces.is_favorite(fav_space.id, fav_user.id):
                report.add("space_favorite", fav_label, "skipped", "already_favorite")
                continue
            self.session.add(SpaceFavorite(space_id=fav_space.id, user_id=fav_user.id))
            await self.session.flush()
            report.add("space_favorite", fav_label, "created")

        async def group_by_name(name: str) -> Group | None:
            return (
                await self.session.execute(
                    select(Group).where(func.lower(Group.name) == name.strip().lower())
                )
            ).scalar_one_or_none()

        async def page_by_reference(space_key: str, slug: str) -> WikiPage | None:
            page_space = await self.spaces.get_by_key(space_key)
            if page_space is None:
                return None
            return (
                await self.session.execute(
                    select(WikiPage).where(
                        WikiPage.space_id == page_space.id, WikiPage.slug == slug
                    )
                )
            ).scalar_one_or_none()

        # --- groups and permissions -------------------------------------
        for group_entry in doc.groups:
            label = group_entry.name.strip()
            if await group_by_name(label):
                report.add("group", label, "skipped", "name_exists")
                continue
            owner = await self.users.get_by_username(group_entry.owner_username)
            if owner is None:
                report.add("group", label, "skipped", "missing_owner")
                continue
            group = Group(
                name=label,
                description=group_entry.description.strip(),
                owner_id=owner.id,
                is_active=group_entry.is_active,
            )
            if await self.session.get(Group, group_entry.id) is None:
                group.id = group_entry.id
            self.session.add(group)
            await self.session.flush()
            report.add("group", label, "created")

        for group_member_entry in doc.group_members:
            label = f"{group_member_entry.group_name}/{group_member_entry.username}"
            member_group = await group_by_name(group_member_entry.group_name)
            member_user = await self.users.get_by_username(group_member_entry.username)
            if member_group is None or member_user is None:
                report.add("group_member", label, "skipped", "missing_reference")
                continue
            group_member_exists = (
                await self.session.execute(
                    select(GroupMember).where(
                        GroupMember.group_id == member_group.id,
                        GroupMember.user_id == member_user.id,
                    )
                )
            ).scalar_one_or_none()
            if group_member_exists:
                report.add("group_member", label, "skipped", "already_member")
                continue
            self.session.add(GroupMember(group_id=member_group.id, user_id=member_user.id))
            await self.session.flush()
            report.add("group_member", label, "created")

        for group_permission_entry in doc.group_global_permissions:
            label = f"{group_permission_entry.group_name}/{group_permission_entry.permission.value}"
            permission_group = await group_by_name(group_permission_entry.group_name)
            if permission_group is None:
                report.add("group_global_permission", label, "skipped", "missing_group")
                continue
            group_permission_exists = (
                await self.session.execute(
                    select(GroupGlobalPermission).where(
                        GroupGlobalPermission.group_id == permission_group.id,
                        GroupGlobalPermission.permission == group_permission_entry.permission,
                    )
                )
            ).scalar_one_or_none()
            if group_permission_exists:
                report.add("group_global_permission", label, "skipped", "already_assigned")
                continue
            self.session.add(
                GroupGlobalPermission(
                    group_id=permission_group.id, permission=group_permission_entry.permission
                )
            )
            await self.session.flush()
            report.add("group_global_permission", label, "created")

        for space_user_permission_entry in doc.space_user_permissions:
            label = "/".join(
                (
                    space_user_permission_entry.space_key,
                    space_user_permission_entry.username,
                    space_user_permission_entry.permission.value,
                )
            )
            permission_space = await self.spaces.get_by_key(space_user_permission_entry.space_key)
            permission_user = await self.users.get_by_username(space_user_permission_entry.username)
            if permission_space is None or permission_user is None:
                report.add("space_user_permission", label, "skipped", "missing_reference")
                continue
            space_user_permission_exists = (
                await self.session.execute(
                    select(SpaceUserPermission).where(
                        SpaceUserPermission.space_id == permission_space.id,
                        SpaceUserPermission.user_id == permission_user.id,
                        SpaceUserPermission.permission == space_user_permission_entry.permission,
                    )
                )
            ).scalar_one_or_none()
            if space_user_permission_exists:
                report.add("space_user_permission", label, "skipped", "already_assigned")
                continue
            self.session.add(
                SpaceUserPermission(
                    space_id=permission_space.id,
                    user_id=permission_user.id,
                    permission=space_user_permission_entry.permission,
                )
            )
            await self.session.flush()
            report.add("space_user_permission", label, "created")

        for space_group_permission_entry in doc.space_group_permissions:
            label = "/".join(
                (
                    space_group_permission_entry.space_key,
                    space_group_permission_entry.group_name,
                    space_group_permission_entry.permission.value,
                )
            )
            permission_space = await self.spaces.get_by_key(space_group_permission_entry.space_key)
            permission_group = await group_by_name(space_group_permission_entry.group_name)
            if permission_space is None or permission_group is None:
                report.add("space_group_permission", label, "skipped", "missing_reference")
                continue
            space_group_permission_exists = (
                await self.session.execute(
                    select(SpaceGroupPermission).where(
                        SpaceGroupPermission.space_id == permission_space.id,
                        SpaceGroupPermission.group_id == permission_group.id,
                        SpaceGroupPermission.permission == space_group_permission_entry.permission,
                    )
                )
            ).scalar_one_or_none()
            if space_group_permission_exists:
                report.add("space_group_permission", label, "skipped", "already_assigned")
                continue
            self.session.add(
                SpaceGroupPermission(
                    space_id=permission_space.id,
                    group_id=permission_group.id,
                    permission=space_group_permission_entry.permission,
                )
            )
            await self.session.flush()
            report.add("space_group_permission", label, "created")

        # --- pages and page-level access --------------------------------
        created_page_refs: set[tuple[str, str]] = set()
        for page_entry in doc.pages:
            label = f"{page_entry.space_key}/{page_entry.slug}"
            page_space = await self.spaces.get_by_key(page_entry.space_key)
            if page_space is None:
                report.add("page", label, "skipped", "missing_space")
                continue
            if await page_by_reference(page_entry.space_key, page_entry.slug):
                report.add("page", label, "skipped", "slug_exists")
                continue
            creator = (
                await self.users.get_by_username(page_entry.created_by_username)
                if page_entry.created_by_username
                else None
            )
            updater = (
                await self.users.get_by_username(page_entry.updated_by_username)
                if page_entry.updated_by_username
                else None
            )
            page = WikiPage(
                space_id=page_space.id,
                title=page_entry.title.strip(),
                slug=page_entry.slug.strip(),
                content=page_entry.content,
                content_format=page_entry.content_format,
                created_by_id=creator.id if creator else None,
                updated_by_id=updater.id if updater else None,
                created_by_label=page_entry.created_by_label,
                updated_by_label=page_entry.updated_by_label,
            )
            if await self.session.get(WikiPage, page_entry.id) is None:
                page.id = page_entry.id
            self.session.add(page)
            await self.session.flush()
            created_page_refs.add((page_entry.space_key.strip().upper(), page_entry.slug.strip()))
            report.add("page", label, "created")

        for page_entry in doc.pages:
            if (
                not page_entry.parent_slug
                or (page_entry.space_key.strip().upper(), page_entry.slug.strip())
                not in created_page_refs
            ):
                continue
            child_page = await page_by_reference(page_entry.space_key, page_entry.slug)
            parent_page = await page_by_reference(page_entry.space_key, page_entry.parent_slug)
            if child_page is None or parent_page is None:
                report.add(
                    "page_parent",
                    f"{page_entry.space_key}/{page_entry.slug}",
                    "skipped",
                    "missing_parent",
                )
                continue
            child_page.parent_id = parent_page.id
            await self.session.flush()

        for revision_entry in doc.page_revisions:
            label = "/".join(
                (
                    revision_entry.page_space_key,
                    revision_entry.page_slug,
                    f"v{revision_entry.version}",
                )
            )
            revision_page = await page_by_reference(
                revision_entry.page_space_key, revision_entry.page_slug
            )
            if revision_page is None:
                report.add("page_revision", label, "skipped", "missing_page")
                continue
            revision_exists = (
                await self.session.execute(
                    select(PageRevision).where(
                        PageRevision.page_id == revision_page.id,
                        PageRevision.version == revision_entry.version,
                    )
                )
            ).scalar_one_or_none()
            if revision_exists:
                report.add("page_revision", label, "skipped", "version_exists")
                continue
            author = (
                await self.users.get_by_username(revision_entry.created_by_username)
                if revision_entry.created_by_username
                else None
            )
            self.session.add(
                PageRevision(
                    page_id=revision_page.id,
                    version=revision_entry.version,
                    title=revision_entry.title,
                    content=revision_entry.content,
                    content_format=revision_entry.content_format,
                    created_by_id=author.id if author else None,
                    change_summary=revision_entry.change_summary,
                )
            )
            await self.session.flush()
            report.add("page_revision", label, "created")

        for like_entry in doc.page_likes:
            label = f"{like_entry.page_space_key}/{like_entry.page_slug}/{like_entry.username}"
            liked_page = await page_by_reference(like_entry.page_space_key, like_entry.page_slug)
            liked_user = await self.users.get_by_username(like_entry.username)
            if liked_page is None or liked_user is None:
                report.add("page_like", label, "skipped", "missing_reference")
                continue
            like_exists = (
                await self.session.execute(
                    select(PageLike).where(
                        PageLike.page_id == liked_page.id, PageLike.user_id == liked_user.id
                    )
                )
            ).scalar_one_or_none()
            if like_exists:
                report.add("page_like", label, "skipped", "already_liked")
                continue
            self.session.add(PageLike(page_id=liked_page.id, user_id=liked_user.id))
            await self.session.flush()
            report.add("page_like", label, "created")

        for user_restriction_entry in doc.page_user_restrictions:
            label = "/".join(
                (
                    user_restriction_entry.page_space_key,
                    user_restriction_entry.page_slug,
                    user_restriction_entry.username,
                    user_restriction_entry.permission.value,
                )
            )
            restricted_page = await page_by_reference(
                user_restriction_entry.page_space_key, user_restriction_entry.page_slug
            )
            restricted_user = await self.users.get_by_username(user_restriction_entry.username)
            if restricted_page is None or restricted_user is None:
                report.add("page_user_restriction", label, "skipped", "missing_reference")
                continue
            user_restriction_exists = (
                await self.session.execute(
                    select(PageUserRestriction).where(
                        PageUserRestriction.page_id == restricted_page.id,
                        PageUserRestriction.user_id == restricted_user.id,
                        PageUserRestriction.permission == user_restriction_entry.permission,
                    )
                )
            ).scalar_one_or_none()
            if user_restriction_exists:
                report.add("page_user_restriction", label, "skipped", "already_assigned")
                continue
            self.session.add(
                PageUserRestriction(
                    page_id=restricted_page.id,
                    user_id=restricted_user.id,
                    permission=user_restriction_entry.permission,
                )
            )
            await self.session.flush()
            report.add("page_user_restriction", label, "created")

        for group_restriction_entry in doc.page_group_restrictions:
            label = "/".join(
                (
                    group_restriction_entry.page_space_key,
                    group_restriction_entry.page_slug,
                    group_restriction_entry.group_name,
                    group_restriction_entry.permission.value,
                )
            )
            restricted_page = await page_by_reference(
                group_restriction_entry.page_space_key, group_restriction_entry.page_slug
            )
            restricted_group = await group_by_name(group_restriction_entry.group_name)
            if restricted_page is None or restricted_group is None:
                report.add("page_group_restriction", label, "skipped", "missing_reference")
                continue
            group_restriction_exists = (
                await self.session.execute(
                    select(PageGroupRestriction).where(
                        PageGroupRestriction.page_id == restricted_page.id,
                        PageGroupRestriction.group_id == restricted_group.id,
                        PageGroupRestriction.permission == group_restriction_entry.permission,
                    )
                )
            ).scalar_one_or_none()
            if group_restriction_exists:
                report.add("page_group_restriction", label, "skipped", "already_assigned")
                continue
            self.session.add(
                PageGroupRestriction(
                    page_id=restricted_page.id,
                    group_id=restricted_group.id,
                    permission=group_restriction_entry.permission,
                )
            )
            await self.session.flush()
            report.add("page_group_restriction", label, "created")

        # --- settings -----------------------------------------------------
        if doc.site_settings is not None:
            incoming: dict[str, Any] = doc.site_settings.model_dump(exclude_none=True)
            current = (await self.site_settings.read()).overrides
            if any(value is not None for value in current.model_dump().values()):
                # Never clobber an instance that has already been configured.
                report.add("site_settings", "site settings", "skipped", "already_configured")
            elif incoming:
                from app.schemas.site_settings import SiteSettingsUpdate

                await self.site_settings.update(SiteSettingsUpdate(**incoming))
                report.add("site_settings", "site settings", "created")
