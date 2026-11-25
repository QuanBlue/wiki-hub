"""Whole-instance JSON and streaming full-package ZIP backup exporters."""

from __future__ import annotations

import hashlib
import json
import zipfile
from collections.abc import AsyncIterator, Mapping
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import func, select

from app.core.config import settings
from app.core.logging import get_logger
from app.models.attachment import PageAttachment
from app.models.audit import AuditAction
from app.models.backup_job import BackupJob
from app.models.comment import CommentLike, PageComment
from app.models.draft import PageDraft
from app.models.issue import Issue, IssueAttachment, IssueNote
from app.models.page import PageLike, UserPagePin, WikiPage
from app.models.page_template import PageTemplate
from app.models.permission import (
    Group,
    GroupGlobalPermission,
    GroupMember,
    GroupOwner,
    SpaceGroupPermission,
    SpaceUserPermission,
    UserGlobalPermissionOverride,
)
from app.models.restriction import PageGroupRestriction, PageUserRestriction
from app.models.revision import PageRevision
from app.models.share import PageShare
from app.models.space import Space, SpaceFavorite, SpaceMember, SpaceOwner
from app.models.user import User
from app.models.user_page_label import UserPageLabel
from app.models.user_tag import UserTag
from app.modules.backup.helpers import (
    _PROGRESS_CHECK_EVERY,
    _comment_entries,
    _HashingZipEntry,
    _PageIndexEntry,
    _share_entries,
    checkpoint_backup_job,
)
from app.modules.backup.package import (
    DOCUMENT_PATH,
    FULL_BACKUP_FORMAT,
    FULL_BACKUP_VERSION,
    MANIFEST_PATH,
)
from app.schemas.backup import (
    BACKUP_VERSION,
    BackupAttachment,
    BackupAvatar,
    BackupCover,
    BackupDocument,
    BackupGroup,
    BackupGroupGlobalPermission,
    BackupGroupMember,
    BackupIssue,
    BackupIssueAttachment,
    BackupIssueNote,
    BackupMeta,
    BackupPage,
    BackupPageDraft,
    BackupPageGroupRestriction,
    BackupPageLike,
    BackupPagePin,
    BackupPageRevision,
    BackupPageTemplate,
    BackupPageUserRestriction,
    BackupSiteSettings,
    BackupSpace,
    BackupSpaceFavorite,
    BackupSpaceGroupPermission,
    BackupSpaceMember,
    BackupSpaceOwner,
    BackupSpaceUserPermission,
    BackupUser,
    BackupUserGlobalPermissionOverride,
    BackupUserPageLabel,
    BackupUserTag,
)
from app.services.storage import ObjectStorage

if TYPE_CHECKING:
    from app.modules.backup.service import BackupService

logger = get_logger(__name__)


async def load_issue_entries(
    service: BackupService, users_by_id: Mapping[UUID, User]
) -> tuple[list[BackupIssue], dict[UUID, list[IssueAttachment]]]:
    """Every issue with its notes, ready to serialise, plus its screenshot
    rows keyed by issue (the bytes are added by the full-package export)."""
    issues = list(
        (
            await service.session.execute(select(Issue).order_by(Issue.created_at, Issue.id))
        ).scalars()
    )
    notes_by_issue: dict[UUID, list[IssueNote]] = {}
    for note in (
        await service.session.execute(
            select(IssueNote).order_by(IssueNote.created_at, IssueNote.id)
        )
    ).scalars():
        notes_by_issue.setdefault(note.issue_id, []).append(note)
    shots_by_issue: dict[UUID, list[IssueAttachment]] = {}
    for shot in (
        await service.session.execute(
            select(IssueAttachment).order_by(IssueAttachment.created_at, IssueAttachment.id)
        )
    ).scalars():
        shots_by_issue.setdefault(shot.issue_id, []).append(shot)

    def name_of(user_id: UUID | None) -> str | None:
        return (
            users_by_id[user_id].username
            if user_id is not None and user_id in users_by_id
            else None
        )

    entries = [
        BackupIssue(
            id=issue.id,
            reporter_username=users_by_id[issue.reporter_id].username,
            title=issue.title,
            description=issue.description,
            status=issue.status,
            assignee_username=name_of(issue.assignee_id),
            labels=list(issue.labels or []),
            page_url=issue.page_url,
            created_at=issue.created_at,
            updated_at=issue.updated_at,
            resolved_at=issue.resolved_at,
            notes=[
                BackupIssueNote(
                    author_username=name_of(note.author_id),
                    body=note.body,
                    public=note.public,
                    created_at=note.created_at,
                )
                for note in notes_by_issue.get(issue.id, [])
            ],
        )
        for issue in issues
        if issue.reporter_id in users_by_id
    ]
    return entries, shots_by_issue


async def load_comments(service: BackupService) -> tuple[list[PageComment], list[CommentLike]]:
    comments = list(
        (
            await service.session.execute(
                select(PageComment).order_by(PageComment.created_at, PageComment.id)
            )
        ).scalars()
    )
    likes = list((await service.session.execute(select(CommentLike))).scalars())
    return comments, likes


async def export_document(
    service: BackupService,
    *,
    include_credentials: bool = False,
    space_keys: list[str] | None = None,
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
    users = list((await service.session.execute(select(User).order_by(User.username))).scalars())
    spaces_query = select(Space).order_by(Space.key)
    if space_keys:
        spaces_query = spaces_query.where(Space.key.in_(space_keys))
    spaces = list((await service.session.execute(spaces_query)).scalars())

    users_by_id = {u.id: u for u in users}
    spaces_by_id = {s.id: s for s in spaces}

    members = list((await service.session.execute(select(SpaceMember))).scalars())
    owners = list((await service.session.execute(select(SpaceOwner))).scalars())
    favorites = list((await service.session.execute(select(SpaceFavorite))).scalars())
    groups = list((await service.session.execute(select(Group).order_by(Group.name))).scalars())
    group_members = list((await service.session.execute(select(GroupMember))).scalars())
    group_permissions = list(
        (await service.session.execute(select(GroupGlobalPermission))).scalars()
    )
    group_owner_rows = list((await service.session.execute(select(GroupOwner))).scalars())
    permission_overrides = list(
        (await service.session.execute(select(UserGlobalPermissionOverride))).scalars()
    )
    space_user_permissions = list(
        (await service.session.execute(select(SpaceUserPermission))).scalars()
    )
    space_group_permissions = list(
        (await service.session.execute(select(SpaceGroupPermission))).scalars()
    )
    pages = list((await service.session.execute(select(WikiPage))).scalars())
    revisions = list((await service.session.execute(select(PageRevision))).scalars())
    likes = list((await service.session.execute(select(PageLike))).scalars())
    comments, comment_likes = await service._load_comments()
    shares = list((await service.session.execute(select(PageShare))).scalars())
    pins = list((await service.session.execute(select(UserPagePin))).scalars())
    drafts = list((await service.session.execute(select(PageDraft))).scalars())
    user_tags = list((await service.session.execute(select(UserTag))).scalars())
    user_page_labels = list((await service.session.execute(select(UserPageLabel))).scalars())
    page_user_restrictions = list(
        (await service.session.execute(select(PageUserRestriction))).scalars()
    )
    page_group_restrictions = list(
        (await service.session.execute(select(PageGroupRestriction))).scalars()
    )
    page_templates = list(
        (
            await service.session.execute(
                select(PageTemplate).order_by(PageTemplate.scope, PageTemplate.name, PageTemplate.id)
            )
        ).scalars()
    )
    overrides = (await service.site_settings.read()).overrides
    # Issues belong to the instance, not a space, but like users and groups
    # they are exported whatever spaces the backup is scoped to - leaving
    # them out of a scoped backup silently dropped them on restore.
    doc_issues = (await service._issue_entries(users_by_id))[0]

    doc_users = []
    for user in users:
        entry = BackupUser.model_validate(user)
        # Never emit a hash or 2FA secret unless explicitly requested.
        entry.password_hash = user.password_hash if include_credentials else None
        if include_credentials:
            entry.totp_enabled = bool(getattr(user, "totp_enabled", False))
            entry.totp_enabled_at = getattr(user, "totp_enabled_at", None)
            entry.totp_secret_encrypted = getattr(user, "totp_secret_encrypted", None)
            entry.totp_recovery_codes = list(getattr(user, "totp_recovery_codes", None) or [])
        else:
            entry.totp_enabled = False
            entry.totp_enabled_at = None
            entry.totp_secret_encrypted = None
            entry.totp_recovery_codes = []
        entry.bio = user.bio
        entry.pronouns = user.pronouns
        entry.profile_url = user.profile_url
        entry.social_links = user.social_links
        entry.company = user.company
        entry.status_emoji = getattr(user, "status_emoji", "") or ""
        entry.status_text = getattr(user, "status_text", "") or ""
        entry.status_expires_at = getattr(user, "status_expires_at", None)
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
                users_by_id[s.created_by_id].username if s.created_by_id in users_by_id else None
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
    doc_owners = [
        BackupSpaceOwner(
            space_key=spaces_by_id[o.space_id].key,
            username=users_by_id[o.user_id].username,
        )
        for o in owners
        if o.space_id in spaces_by_id and o.user_id in users_by_id
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
    group_owner_names: dict[UUID, list[str]] = {}
    for row in group_owner_rows:
        if row.user_id in users_by_id:
            group_owner_names.setdefault(row.group_id, []).append(users_by_id[row.user_id].username)
    doc_groups = [
        BackupGroup(
            id=group.id,
            name=group.name,
            description=group.description,
            owner_username=users_by_id[group.owner_id].username,
            is_active=group.is_active,
            owner_usernames=sorted(group_owner_names.get(group.id, [])),
        )
        for group in groups
        if group.owner_id in users_by_id
    ]
    doc_permission_overrides = [
        BackupUserGlobalPermissionOverride(
            username=users_by_id[row.user_id].username,
            permission=row.permission,
            enabled=row.enabled,
        )
        for row in permission_overrides
        if row.user_id in users_by_id
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
            parent_slug=pages_by_id[page.parent_id].slug if page.parent_id in pages_by_id else None,
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
            created_at=page.created_at,
            updated_at=page.updated_at,
            view_restricted=bool(page.view_restricted),
            inherit_restrictions=bool(page.inherit_restrictions),
            deleted_at=page.deleted_at,
            deleted_by_username=(
                users_by_id[page.deleted_by_id].username
                if page.deleted_by_id in users_by_id
                else None
            ),
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

    def _full_page_ref(page_id: UUID) -> tuple[str, str] | None:
        if page_id in pages_by_id and pages_by_id[page_id].space_id in spaces_by_id:
            return (spaces_by_id[pages_by_id[page_id].space_id].key, pages_by_id[page_id].slug)
        return None

    doc_comments = _comment_entries(comments, comment_likes, _full_page_ref, users_by_id)
    doc_shares = _share_entries(shares, _full_page_ref, users_by_id)
    doc_pins = [
        BackupPagePin(
            page_space_key=spaces_by_id[pages_by_id[row.page_id].space_id].key,
            page_slug=pages_by_id[row.page_id].slug,
            username=users_by_id[row.user_id].username,
        )
        for row in pins
        if row.page_id in pages_by_id
        and row.user_id in users_by_id
        and pages_by_id[row.page_id].space_id in spaces_by_id
    ]
    doc_drafts = [
        BackupPageDraft(
            page_space_key=spaces_by_id[pages_by_id[row.page_id].space_id].key,
            page_slug=pages_by_id[row.page_id].slug,
            username=users_by_id[row.user_id].username,
            content=row.content,
            content_format=row.content_format,
            edit_mode=row.edit_mode,
            base_updated_at=row.base_updated_at,
        )
        for row in drafts
        if row.page_id in pages_by_id
        and row.user_id in users_by_id
        and pages_by_id[row.page_id].space_id in spaces_by_id
    ]
    doc_tags = [
        BackupUserTag(username=users_by_id[row.user_id].username, name=row.name)
        for row in user_tags
        if row.user_id in users_by_id
    ]
    doc_page_labels = [
        BackupUserPageLabel(
            page_space_key=spaces_by_id[pages_by_id[row.page_id].space_id].key,
            page_slug=pages_by_id[row.page_id].slug,
            username=users_by_id[row.user_id].username,
            name=row.name,
        )
        for row in user_page_labels
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
            denied=bool(row.denied),
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
            denied=bool(row.denied),
        )
        for row in page_group_restrictions
        if row.page_id in pages_by_id
        and row.group_id in groups_by_id
        and pages_by_id[row.page_id].space_id in spaces_by_id
    ]

    doc_page_templates = [
        BackupPageTemplate(
            id=tpl.id,
            scope="space" if tpl.scope == "space" else "global",
            space_key=spaces_by_id[tpl.space_id].key if tpl.space_id in spaces_by_id else None,
            name=tpl.name,
            description=tpl.description,
            category=tpl.category,
            icon=tpl.icon,
            content=tpl.content,
            content_format="markdown" if tpl.content_format == "markdown" else "html",
            created_by_username=(
                users_by_id[tpl.created_by_id].username
                if tpl.created_by_id in users_by_id
                else None
            ),
            updated_by_username=(
                users_by_id[tpl.updated_by_id].username
                if tpl.updated_by_id in users_by_id
                else None
            ),
            created_at=tpl.created_at,
            updated_at=tpl.updated_at,
        )
        for tpl in page_templates
        if tpl.scope == "global" or (tpl.space_id is not None and tpl.space_id in spaces_by_id)
    ]

    effective = await service.site_settings.get_effective()
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
                "space_owners": len(doc_owners),
                "space_favorites": len(doc_favorites),
                "groups": len(doc_groups),
                "user_global_permission_overrides": len(doc_permission_overrides),
                "pages": len(doc_pages),
                "page_revisions": len(doc_revisions),
                "page_likes": len(doc_likes),
                "page_comments": len(doc_comments),
                "page_shares": len(doc_shares),
                "page_pins": len(doc_pins),
                "page_drafts": len(doc_drafts),
                "user_tags": len(doc_tags),
                "user_page_labels": len(doc_page_labels),
                "page_restrictions": len(doc_page_user_restrictions)
                + len(doc_page_group_restrictions),
                "issues": len(doc_issues),
                "page_templates": len(doc_page_templates),
            },
        ),
        users=doc_users,
        spaces=doc_spaces,
        space_members=doc_members,
        space_owners=doc_owners,
        space_favorites=doc_favorites,
        groups=doc_groups,
        group_members=doc_group_members,
        group_global_permissions=doc_group_permissions,
        user_global_permission_overrides=doc_permission_overrides,
        space_user_permissions=doc_space_user_permissions,
        space_group_permissions=doc_space_group_permissions,
        pages=doc_pages,
        page_revisions=doc_revisions,
        page_likes=doc_likes,
        page_comments=doc_comments,
        page_shares=doc_shares,
        page_user_restrictions=doc_page_user_restrictions,
        page_group_restrictions=doc_page_group_restrictions,
        page_pins=doc_pins,
        page_drafts=doc_drafts,
        user_tags=doc_tags,
        user_page_labels=doc_page_labels,
        issues=doc_issues,
        page_templates=doc_page_templates,
        site_settings=BackupSiteSettings(**overrides.model_dump()),
    )

    logger.info(
        "backup_exported",
        users=len(doc_users),
        spaces=len(doc_spaces),
        credentials=include_credentials,
    )
    await service.audit.record(
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
    service: BackupService,
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
        await checkpoint_backup_job(service.session, job)

    users = list((await service.session.execute(select(User).order_by(User.username))).scalars())
    spaces_query = select(Space).order_by(Space.key)
    if space_keys:
        spaces_query = spaces_query.where(Space.key.in_(space_keys))
    spaces = list((await service.session.execute(spaces_query)).scalars())
    users_by_id = {u.id: u for u in users}
    spaces_by_id = {s.id: s for s in spaces}
    avatar_users = [(user, user.avatar_object_key) for user in users if user.avatar_object_key]
    cover_users = [
        (user, cover_key)
        for user in users
        if (cover_key := getattr(user, "cover_object_key", None))
    ]

    members = list((await service.session.execute(select(SpaceMember))).scalars())
    owners = list((await service.session.execute(select(SpaceOwner))).scalars())
    favorites = list((await service.session.execute(select(SpaceFavorite))).scalars())
    groups = list((await service.session.execute(select(Group).order_by(Group.name))).scalars())
    group_members = list((await service.session.execute(select(GroupMember))).scalars())
    group_permissions = list(
        (await service.session.execute(select(GroupGlobalPermission))).scalars()
    )
    group_owner_rows = list((await service.session.execute(select(GroupOwner))).scalars())
    permission_overrides = list(
        (await service.session.execute(select(UserGlobalPermissionOverride))).scalars()
    )
    space_user_permissions = list(
        (await service.session.execute(select(SpaceUserPermission))).scalars()
    )
    space_group_permissions = list(
        (await service.session.execute(select(SpaceGroupPermission))).scalars()
    )
    groups_by_id = {group.id: group for group in groups}

    page_index_query = select(WikiPage.id, WikiPage.space_id, WikiPage.slug, WikiPage.parent_id)
    if space_keys:
        page_index_query = page_index_query.where(WikiPage.space_id.in_(spaces_by_id.keys()))
    pages_index: dict[UUID, _PageIndexEntry] = {
        row.id: _PageIndexEntry(space_id=row.space_id, slug=row.slug, parent_id=row.parent_id)
        for row in (await service.session.execute(page_index_query)).all()
        if row.space_id in spaces_by_id
    }
    revisions_total = (
        (
            await service.session.execute(
                select(func.count())
                .select_from(PageRevision)
                .where(PageRevision.page_id.in_(pages_index.keys()))
            )
        ).scalar_one()
        if pages_index
        else 0
    )

    attachments = list((await service.session.execute(select(PageAttachment))).scalars())
    likes = list((await service.session.execute(select(PageLike))).scalars())
    comments, comment_likes = await service._load_comments()
    shares = list((await service.session.execute(select(PageShare))).scalars())
    pins = list((await service.session.execute(select(UserPagePin))).scalars())
    drafts = list((await service.session.execute(select(PageDraft))).scalars())
    user_tags = list((await service.session.execute(select(UserTag))).scalars())
    user_page_labels = list((await service.session.execute(select(UserPageLabel))).scalars())
    page_user_restrictions = list(
        (await service.session.execute(select(PageUserRestriction))).scalars()
    )
    page_group_restrictions = list(
        (await service.session.execute(select(PageGroupRestriction))).scalars()
    )
    page_templates = list(
        (
            await service.session.execute(
                select(PageTemplate).order_by(PageTemplate.scope, PageTemplate.name, PageTemplate.id)
            )
        ).scalars()
    )
    overrides = (await service.site_settings.read()).overrides
    doc_page_templates = [
        BackupPageTemplate(
            id=tpl.id,
            scope="space" if tpl.scope == "space" else "global",
            space_key=spaces_by_id[tpl.space_id].key if tpl.space_id in spaces_by_id else None,
            name=tpl.name,
            description=tpl.description,
            category=tpl.category,
            icon=tpl.icon,
            content=tpl.content,
            content_format="markdown" if tpl.content_format == "markdown" else "html",
            created_by_username=(
                users_by_id[tpl.created_by_id].username
                if tpl.created_by_id in users_by_id
                else None
            ),
            updated_by_username=(
                users_by_id[tpl.updated_by_id].username
                if tpl.updated_by_id in users_by_id
                else None
            ),
            created_at=tpl.created_at,
            updated_at=tpl.updated_at,
        )
        for tpl in page_templates
        if tpl.scope == "global" or (tpl.space_id is not None and tpl.space_id in spaces_by_id)
    ]

    effective = await service.site_settings.get_effective()
    doc_issues, issue_shots = await service._issue_entries(users_by_id)

    def _page_space_key(page_id: UUID) -> str | None:
        entry = pages_index.get(page_id)
        return (
            spaces_by_id[entry.space_id].key if entry and entry.space_id in spaces_by_id else None
        )

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
            id=s.id,
            key=s.key,
            name=s.name,
            description=s.description,
            icon=s.icon,
            status=s.status,
            visibility=s.visibility,
            created_at=s.created_at,
            updated_at=s.updated_at,
            created_by_username=users_by_id[s.created_by_id].username
            if s.created_by_id in users_by_id
            else None,
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
    doc_owners = [
        BackupSpaceOwner(
            space_key=spaces_by_id[o.space_id].key, username=users_by_id[o.user_id].username
        )
        for o in owners
        if o.space_id in spaces_by_id and o.user_id in users_by_id
    ]
    doc_favorites = [
        BackupSpaceFavorite(
            username=users_by_id[f.user_id].username, space_key=spaces_by_id[f.space_id].key
        )
        for f in favorites
        if f.space_id in spaces_by_id and f.user_id in users_by_id
    ]
    group_owner_names: dict[UUID, list[str]] = {}
    for row in group_owner_rows:
        if row.user_id in users_by_id:
            group_owner_names.setdefault(row.group_id, []).append(users_by_id[row.user_id].username)
    doc_groups = [
        BackupGroup(
            id=g.id,
            name=g.name,
            description=g.description,
            owner_username=users_by_id[g.owner_id].username,
            is_active=g.is_active,
            owner_usernames=sorted(group_owner_names.get(g.id, [])),
        )
        for g in groups
        if g.owner_id in users_by_id
    ]
    doc_permission_overrides = [
        BackupUserGlobalPermissionOverride(
            username=users_by_id[row.user_id].username,
            permission=row.permission,
            enabled=row.enabled,
        )
        for row in permission_overrides
        if row.user_id in users_by_id
    ]
    doc_group_members = [
        BackupGroupMember(
            group_name=groups_by_id[row.group_id].name, username=users_by_id[row.user_id].username
        )
        for row in group_members
        if row.group_id in groups_by_id and row.user_id in users_by_id
    ]
    doc_group_permissions = [
        BackupGroupGlobalPermission(
            group_name=groups_by_id[row.group_id].name, permission=row.permission
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
    doc_likes = [
        BackupPageLike(
            page_space_key=_page_space_key(row.page_id),
            page_slug=pages_index[row.page_id].slug,
            username=users_by_id[row.user_id].username,
        )
        for row in likes
        if row.page_id in pages_index
        and row.user_id in users_by_id
        and _page_space_key(row.page_id)
    ]

    def _comment_page_ref(page_id: UUID) -> tuple[str, str] | None:
        space_key = _page_space_key(page_id) if page_id in pages_index else None
        return (space_key, pages_index[page_id].slug) if space_key else None

    doc_comments = _comment_entries(comments, comment_likes, _comment_page_ref, users_by_id)
    doc_shares = _share_entries(shares, _comment_page_ref, users_by_id)
    doc_pins = [
        BackupPagePin(
            page_space_key=_page_space_key(row.page_id),
            page_slug=pages_index[row.page_id].slug,
            username=users_by_id[row.user_id].username,
        )
        for row in pins
        if row.page_id in pages_index
        and row.user_id in users_by_id
        and _page_space_key(row.page_id)
    ]
    doc_drafts = [
        BackupPageDraft(
            page_space_key=_page_space_key(row.page_id),
            page_slug=pages_index[row.page_id].slug,
            username=users_by_id[row.user_id].username,
            content=row.content,
            content_format=row.content_format,
            edit_mode=row.edit_mode,
            base_updated_at=row.base_updated_at,
        )
        for row in drafts
        if row.page_id in pages_index
        and row.user_id in users_by_id
        and _page_space_key(row.page_id)
    ]
    doc_tags = [
        BackupUserTag(username=users_by_id[row.user_id].username, name=row.name)
        for row in user_tags
        if row.user_id in users_by_id
    ]
    doc_page_labels = [
        BackupUserPageLabel(
            page_space_key=_page_space_key(row.page_id),
            page_slug=pages_index[row.page_id].slug,
            username=users_by_id[row.user_id].username,
            name=row.name,
        )
        for row in user_page_labels
        if row.page_id in pages_index
        and row.user_id in users_by_id
        and _page_space_key(row.page_id)
    ]
    doc_page_user_restrictions = [
        BackupPageUserRestriction(
            page_space_key=_page_space_key(row.page_id),
            page_slug=pages_index[row.page_id].slug,
            username=users_by_id[row.user_id].username,
            permission=row.permission,
            denied=bool(row.denied),
        )
        for row in page_user_restrictions
        if row.page_id in pages_index
        and row.user_id in users_by_id
        and _page_space_key(row.page_id)
    ]
    doc_page_group_restrictions = [
        BackupPageGroupRestriction(
            page_space_key=_page_space_key(row.page_id),
            page_slug=pages_index[row.page_id].slug,
            group_name=groups_by_id[row.group_id].name,
            permission=row.permission,
            denied=bool(row.denied),
        )
        for row in page_group_restrictions
        if row.page_id in pages_index
        and row.group_id in groups_by_id
        and _page_space_key(row.page_id)
    ]

    total_items = (
        len(attachments)
        + len(avatar_users)
        + len(cover_users)
        + len(pages_index)
        + revisions_total
        + sum(len(rows) for rows in issue_shots.values())
    )
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
        if processed_items % _PROGRESS_CHECK_EVERY != 0 and processed_items != total_items:
            return
        await checkpoint_backup_job(
            service.session,
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
                "space_owners": len(doc_owners),
                "space_favorites": len(doc_favorites),
                "groups": len(doc_groups),
                "user_global_permission_overrides": len(doc_permission_overrides),
                "pages": len(pages_index),
                "page_revisions": revisions_total,
                "page_likes": len(doc_likes),
                "page_comments": len(doc_comments),
                "page_shares": len(doc_shares),
                "page_pins": len(doc_pins),
                "page_drafts": len(doc_drafts),
                "user_tags": len(doc_tags),
                "user_page_labels": len(doc_page_labels),
                "page_restrictions": len(doc_page_user_restrictions)
                + len(doc_page_group_restrictions),
                "issues": len(doc_issues),
                "page_templates": len(doc_page_templates),
            },
        ),
        users=doc_users,
        spaces=doc_spaces,
        space_members=doc_members,
        space_owners=doc_owners,
        space_favorites=doc_favorites,
        groups=doc_groups,
        group_members=doc_group_members,
        group_global_permissions=doc_group_permissions,
        user_global_permission_overrides=doc_permission_overrides,
        space_user_permissions=doc_space_user_permissions,
        space_group_permissions=doc_space_group_permissions,
        pages=[],
        page_revisions=[],
        page_likes=doc_likes,
        page_comments=doc_comments,
        page_shares=doc_shares,
        page_user_restrictions=doc_page_user_restrictions,
        page_group_restrictions=doc_page_group_restrictions,
        page_pins=doc_pins,
        page_drafts=doc_drafts,
        user_tags=doc_tags,
        user_page_labels=doc_page_labels,
        issues=doc_issues,
        page_templates=doc_page_templates,
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

    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for attachment in attachments:
            page_space_key = _page_space_key(attachment.page_id)
            if page_space_key is None:
                continue
            data = await storage.get(attachment.object_key)
            digest = hashlib.sha256(data).hexdigest()
            object_path = f"objects/attachments/{digest}"
            document.attachments.append(
                BackupAttachment(
                    id=attachment.id,
                    page_space_key=page_space_key,
                    page_slug=pages_index[attachment.page_id].slug,
                    filename=attachment.filename,
                    content_type=attachment.content_type,
                    object_path=object_path,
                    sha256=digest,
                    size_bytes=len(data),
                )
            )
            _write_once(archive, object_path, digest, data)
            del data
            await _report_progress()
        for user, avatar_key in avatar_users:
            data = await storage.get(avatar_key)
            digest = hashlib.sha256(data).hexdigest()
            content_type = user.avatar_content_type or "application/octet-stream"
            object_path = f"objects/avatars/{digest}"
            document.avatars.append(
                BackupAvatar(
                    username=user.username,
                    content_type=content_type,
                    object_path=object_path,
                    sha256=digest,
                    size_bytes=len(data),
                )
            )
            _write_once(archive, object_path, digest, data)
            del data
            await _report_progress()
        for user, cover_key in cover_users:
            data = await storage.get(cover_key)
            digest = hashlib.sha256(data).hexdigest()
            content_type = user.cover_content_type or "application/octet-stream"
            object_path = f"objects/covers/{digest}"
            document.covers.append(
                BackupCover(
                    username=user.username,
                    content_type=content_type,
                    object_path=object_path,
                    sha256=digest,
                    size_bytes=len(data),
                )
            )
            _write_once(archive, object_path, digest, data)
            del data
            await _report_progress()

        issue_screenshots = 0
        for issue_entry in document.issues:
            for shot in issue_shots.get(issue_entry.id, []):
                data = await storage.get(shot.object_key)
                digest = hashlib.sha256(data).hexdigest()
                object_path = f"objects/issue-attachments/{digest}"
                issue_entry.attachments.append(
                    BackupIssueAttachment(
                        id=shot.id,
                        filename=shot.filename,
                        content_type=shot.content_type,
                        object_path=object_path,
                        sha256=digest,
                        size_bytes=len(data),
                    )
                )
                _write_once(archive, object_path, digest, data)
                issue_screenshots += 1
                del data
                await _report_progress()

        document.wikihub_backup.counts.update(
            {
                "attachments": len(document.attachments),
                "avatars": len(document.avatars),
                "covers": len(document.covers),
                "issue_attachments": issue_screenshots,
            }
        )

        # `document.pages`/`.page_revisions` are still `[]` here - splice
        # their streamed content into this "shell" rather than building
        # the whole thing (page/revision content included) as one string.
        shell = document.model_dump_json(indent=None)
        pages_marker, revisions_marker = '"pages":[]', '"page_revisions":[]'
        pages_at = shell.index(pages_marker)
        before_pages = shell[:pages_at] + '"pages":['
        after_pages = shell[pages_at + len(pages_marker) - 1 :]  # keeps the leading "]"
        revisions_at = after_pages.index(revisions_marker)
        between = after_pages[:revisions_at] + '"page_revisions":['
        after_revisions = after_pages[
            revisions_at + len(revisions_marker) - 1 :
        ]  # keeps the leading "]"

        with archive.open(DOCUMENT_PATH, "w") as handle:
            writer = _HashingZipEntry(handle)
            writer.write(before_pages)

            async def _page_batches() -> AsyncIterator[Any]:
                page_ids = list(pages_index.keys())
                for offset in range(0, len(page_ids), PAGE_BATCH):
                    batch_ids = page_ids[offset : offset + PAGE_BATCH]
                    rows = (
                        await service.session.execute(
                            select(
                                WikiPage.id,
                                WikiPage.slug,
                                WikiPage.title,
                                WikiPage.content,
                                WikiPage.content_format,
                                WikiPage.parent_id,
                                WikiPage.created_by_id,
                                WikiPage.updated_by_id,
                                WikiPage.created_by_label,
                                WikiPage.updated_by_label,
                                WikiPage.created_at,
                                WikiPage.updated_at,
                                WikiPage.view_restricted,
                                WikiPage.inherit_restrictions,
                                WikiPage.deleted_at,
                                WikiPage.deleted_by_id,
                            ).where(WikiPage.id.in_(batch_ids))
                        )
                    ).all()
                    yield rows

            first = True
            async for batch in _page_batches():
                for row in batch:
                    parent = pages_index.get(row.parent_id) if row.parent_id else None
                    page_model = BackupPage(
                        id=row.id,
                        space_key=spaces_by_id[pages_index[row.id].space_id].key,
                        slug=row.slug,
                        title=row.title,
                        content=row.content,
                        content_format=row.content_format,
                        parent_slug=parent.slug if parent else None,
                        created_by_username=users_by_id[row.created_by_id].username
                        if row.created_by_id in users_by_id
                        else None,
                        updated_by_username=users_by_id[row.updated_by_id].username
                        if row.updated_by_id in users_by_id
                        else None,
                        created_by_label=row.created_by_label,
                        updated_by_label=row.updated_by_label,
                        created_at=row.created_at,
                        updated_at=row.updated_at,
                        view_restricted=bool(row.view_restricted),
                        inherit_restrictions=bool(row.inherit_restrictions),
                        deleted_at=row.deleted_at,
                        deleted_by_username=(
                            users_by_id[row.deleted_by_id].username
                            if row.deleted_by_id in users_by_id
                            else None
                        ),
                    )
                    if not first:
                        writer.write(",")
                    first = False
                    writer.write(page_model.model_dump_json())
                    del page_model
                    await _report_progress()
                if job is not None:
                    await checkpoint_backup_job(service.session, job)

            writer.write(between)

            first = True
            page_ids = list(pages_index.keys())
            for offset in range(0, revisions_total, PAGE_BATCH):
                rows = (
                    await service.session.execute(
                        select(
                            PageRevision.page_id,
                            PageRevision.version,
                            PageRevision.title,
                            PageRevision.content,
                            PageRevision.content_format,
                            PageRevision.created_by_id,
                            PageRevision.change_summary,
                        )
                        .where(PageRevision.page_id.in_(page_ids))
                        .order_by(PageRevision.id)
                        .limit(PAGE_BATCH)
                        .offset(offset)
                    )
                ).all()
                for rev_row in rows:
                    rev_entry = pages_index.get(rev_row.page_id)
                    # `page_ids` is drawn from `pages_index`, whose own
                    # dict comprehension above already filters out any
                    # page not currently in `spaces_by_id` - a foreign
                    # key guarantees `row.page_id` cannot resolve to a
                    # page outside that set. Guarded defensively anyway,
                    # the same way the id-parsing branches above are.
                    if (
                        rev_entry is None or rev_entry.space_id not in spaces_by_id
                    ):  # pragma: no cover
                        continue
                    revision_model = BackupPageRevision(
                        page_space_key=spaces_by_id[rev_entry.space_id].key,
                        page_slug=rev_entry.slug,
                        version=rev_row.version,
                        title=rev_row.title,
                        content=rev_row.content,
                        content_format=rev_row.content_format,
                        created_by_username=(
                            users_by_id[rev_row.created_by_id].username
                            if rev_row.created_by_id in users_by_id
                            else None
                        ),
                        change_summary=rev_row.change_summary,
                    )
                    if not first:
                        writer.write(",")
                    first = False
                    writer.write(revision_model.model_dump_json())
                    del revision_model
                    await _report_progress()
                if job is not None:
                    await checkpoint_backup_job(service.session, job)

            writer.write(after_revisions)

        entry_checksums.insert(
            0,
            {"path": DOCUMENT_PATH, "sha256": writer.digest.hexdigest(), "size_bytes": writer.size},
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
