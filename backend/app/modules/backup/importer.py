"""JSON backup document import and entity application inside a SAVEPOINT."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import func, select
from sqlalchemy.orm.attributes import flag_modified

from app.core.exceptions import BadRequestError
from app.core.logging import get_logger
from app.models.audit import AuditAction
from app.models.backup_job import BackupJob
from app.models.comment import CommentLike, PageComment
from app.models.draft import PageDraft
from app.models.issue import Issue, IssueNote, IssueStatus
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
from app.models.space import Space, SpaceFavorite, SpaceMember, SpaceOwner, SpaceStatus
from app.models.user import User
from app.models.user_page_label import UserPageLabel
from app.models.user_tag import UserTag
from app.modules.backup.helpers import (
    _PROGRESS_CHECK_EVERY,
    _parents_first,
    _ReportBuilder,
    observe_backup_cancellation,
)
from app.modules.issues.labels import ISSUE_LABELS
from app.modules.permissions.service import ROLE_PERMISSIONS
from app.modules.templates.service import sanitize_template_content
from app.schemas.backup import (
    BACKUP_VERSION,
    SUPPORTED_BACKUP_VERSIONS,
    BackupDocument,
    BackupIssue,
    ImportReport,
)

if TYPE_CHECKING:
    from app.modules.backup.service import BackupService

logger = get_logger(__name__)


async def import_document(
    service: BackupService,
    doc: BackupDocument,
    *,
    dry_run: bool = True,
    space_keys: set[str] | None = None,
    job: BackupJob | None = None,
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
    ``service.spaces.get_by_key(...)`` rather than iterating ``doc.spaces``
    again, so a page/member/permission belonging to an excluded space
    naturally reports "missing_space" once that space is never created.
    Users, groups and their global permissions are never scoped, same as
    on export.

    ``job`` is optional and used only to observe a cancel request while
    the pages are written. This is the longest silent stretch of a
    restore - every space, page and revision in the archive - and it used
    to run with nothing watching the flag, so a Cancel click during it
    did nothing at all until the attachment loop began, which on a
    page-heavy backup is minutes later.
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
                "spaces": [space for space in doc.spaces if space.key.strip().upper() in allowed]
            }
        )

    report = _ReportBuilder()
    no_password: list[str] = []

    savepoint = await service.session.begin_nested()
    try:
        await service._apply(doc, report, no_password, job)
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
    await service.audit.record(
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


async def find_issue(service: BackupService, entry: BackupIssue) -> Issue | None:
    """The local issue this backup entry already is, if any: the same id, or
    the same reporter, title and creation time (the id may have been taken
    by something else when it was first restored)."""
    found = await service.session.get(Issue, entry.id)
    if found is not None:
        return found
    reporter = await service.users.get_by_username(entry.reporter_username)
    if reporter is None or entry.created_at is None:
        return None
    return (
        await service.session.execute(
            select(Issue).where(
                Issue.reporter_id == reporter.id,
                Issue.title == entry.title.strip()[:200],
                Issue.created_at == entry.created_at,
            )
        )
    ).scalar_one_or_none()


async def apply_document(
    service: BackupService,
    doc: BackupDocument,
    report: _ReportBuilder,
    no_password: list[str],
    job: BackupJob | None = None,
) -> None:
    protected = await service.users.get_protected()

    # Keys of spaces this import itself creates, as opposed to ones that
    # already existed locally and were left alone below ("key_exists").
    # The ownership loop further down needs this distinction: a space
    # that already has its own local owners must not have backup owners
    # piled on top of them (see the comment there).
    created_space_keys: set[str] = set()

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
        if await service.users.get_by_username(username):
            report.add("user", username, "skipped", "username_exists")
            continue
        if await service.users.get_by_email(user_entry.email):
            report.add("user", username, "skipped", "email_exists")
            continue

        has_totp = bool(user_entry.totp_enabled and user_entry.totp_secret_encrypted)
        user = User(
            username=username,
            email=user_entry.email.strip().lower(),
            full_name=user_entry.full_name.strip(),
            password_hash=user_entry.password_hash,
            totp_enabled=has_totp,
            totp_enabled_at=user_entry.totp_enabled_at if has_totp else None,
            totp_secret_encrypted=user_entry.totp_secret_encrypted if has_totp else None,
            totp_recovery_codes=list(user_entry.totp_recovery_codes) if has_totp else [],
            bio=user_entry.bio.strip(),
            pronouns=user_entry.pronouns.strip(),
            profile_url=user_entry.profile_url.strip(),
            social_links=[str(link).strip() for link in user_entry.social_links],
            company=user_entry.company.strip(),
            status_emoji=user_entry.status_emoji.strip(),
            status_text=user_entry.status_text.strip(),
            status_expires_at=user_entry.status_expires_at,
            avatar_url=user_entry.avatar_url,
            avatar_updated_at=user_entry.avatar_updated_at,
            cover_updated_at=user_entry.cover_updated_at,
            privacy_accepted_at=user_entry.privacy_accepted_at,
            is_active=user_entry.is_active,
            is_superuser=user_entry.is_superuser,
            # Hardcoded False - the single most important line here. A
            # backup must not be able to introduce a protected account.
            is_protected=False,
        )
        # Preserve the original id when it is free, so references elsewhere
        # in an operator's notes still line up.
        if user_entry.id and await service.users.get(user_entry.id) is None:
            user.id = user_entry.id
        service.session.add(user)
        await service.session.flush()

        if not user_entry.password_hash:
            no_password.append(username)
        report.add("user", username, "created")

    # --- issues -------------------------------------------------------
    for issue_entry in doc.issues:
        issue_label = issue_entry.title
        issue_reporter = await service.users.get_by_username(issue_entry.reporter_username)
        if issue_reporter is None:
            report.add("issue", issue_label, "skipped", "missing_reporter")
            continue
        if await service._find_issue(issue_entry) is not None:
            report.add("issue", issue_label, "skipped", "already_exists")
            continue
        issue_assignee = (
            await service.users.get_by_username(issue_entry.assignee_username)
            if issue_entry.assignee_username
            else None
        )
        issue_status = (
            issue_entry.status
            if issue_entry.status in {state.value for state in IssueStatus}
            else IssueStatus.open.value
        )
        restored_issue = Issue(
            reporter_id=issue_reporter.id,
            title=issue_entry.title.strip()[:200] or "(untitled)",
            description=issue_entry.description,
            status=issue_status,
            assignee_id=issue_assignee.id if issue_assignee else None,
            labels=[label for label in ISSUE_LABELS if label in issue_entry.labels],
            page_url=issue_entry.page_url,
            resolved_at=issue_entry.resolved_at,
        )
        # Same idiom as spaces: keep the original timestamps and, when it is
        # free, the original id, so links and notifications still line up.
        if issue_entry.created_at:
            restored_issue.created_at = issue_entry.created_at
        if issue_entry.updated_at:
            restored_issue.updated_at = issue_entry.updated_at
        if await service.session.get(Issue, issue_entry.id) is None:
            restored_issue.id = issue_entry.id
        service.session.add(restored_issue)
        await service.session.flush()
        for note_entry in issue_entry.notes:
            note_author = (
                await service.users.get_by_username(note_entry.author_username)
                if note_entry.author_username
                else None
            )
            restored_note = IssueNote(
                issue_id=restored_issue.id,
                author_id=note_author.id if note_author else None,
                body=note_entry.body,
                public=note_entry.public,
            )
            if note_entry.created_at:
                restored_note.created_at = note_entry.created_at
            service.session.add(restored_note)
            report.created["issue_note"] = report.created.get("issue_note", 0) + 1
        await service.session.flush()
        report.add("issue", issue_label, "created")

    # --- spaces -------------------------------------------------------
    for space_entry in doc.spaces:
        key = space_entry.key.strip().upper()
        if await service.spaces.get_by_key(key):
            report.add("space", key, "skipped", "key_exists")
            report.conflicting_space_keys.append(key)
            continue

        creator = (
            await service.users.get_by_username(space_entry.created_by_username)
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
        # The row's own created_at/updated_at otherwise default to "now"
        # on insert (see TimestampMixin), crediting the restore with
        # having just created every space in the backup.
        if space_entry.created_at:
            space.created_at = space_entry.created_at
        if space_entry.updated_at:
            space.updated_at = space_entry.updated_at
        if space_entry.id and await service.spaces.get(space_entry.id) is None:
            space.id = space_entry.id
        service.session.add(space)
        await service.session.flush()
        created_space_keys.add(key)
        report.add("space", key, "created")

    # --- membership ---------------------------------------------------
    # Distinct variable names per loop: reusing `space`/`user` from the
    # blocks above shadows non-optional locals with optional ones.
    for member in doc.space_members:
        member_label = f"{member.space_key}/{member.username}"
        member_space = await service.spaces.get_by_key(member.space_key)
        member_user = await service.users.get_by_username(member.username)
        if member_space is None:
            report.add("space_member", member_label, "skipped", "missing_space")
            continue
        if member_user is None:
            report.add("space_member", member_label, "skipped", "missing_user")
            continue
        if await service.spaces.get_member(member_space.id, member_user.id):
            report.add("space_member", member_label, "skipped", "already_member")
            continue
        service.session.add(
            SpaceMember(space_id=member_space.id, user_id=member_user.id, role=member.role)
        )
        await service.session.flush()
        # Authorization now reads additive permission assignments. Keep
        # the legacy membership row for rollback/backup compatibility,
        # but restore its effective permissions as well.
        for permission in ROLE_PERMISSIONS[member.role]:
            service.session.add(
                SpaceUserPermission(
                    space_id=member_space.id,
                    user_id=member_user.id,
                    permission=permission,
                )
            )
        await service.session.flush()
        report.add("space_member", member_label, "created")

    # --- ownership ------------------------------------------------
    # See `SpaceOwner` - independent of the legacy membership rows just
    # restored above. A space with no matching entry here (an archive
    # exported before this table existed, or one that genuinely had no
    # explicit Owner) is not left unmanageable: `is_space_owner` and
    # `list_space_owners` already fall back to every system
    # administrator by default for exactly this case.
    for owner_entry in doc.space_owners:
        owner_label = f"{owner_entry.space_key}/{owner_entry.username}"
        owner_key = owner_entry.space_key.strip().upper()
        # Only restore ownership onto spaces THIS import created. A space
        # that already existed locally (key_exists, above) already has
        # its own local owner(s) - piling the backup's owner on top of
        # them instead of replacing them just leaves two "Owner" chips
        # for what looks like one admin account (e.g. re-importing a
        # backup taken from this same instance, or from a near-duplicate
        # one, onto itself).
        if owner_key not in created_space_keys:
            report.add("space_owner", owner_label, "skipped", "space_preexisting")
            continue
        owner_space = await service.spaces.get_by_key(owner_entry.space_key)
        owner_user = await service.users.get_by_username(owner_entry.username)
        if owner_space is None:
            report.add("space_owner", owner_label, "skipped", "missing_space")
            continue
        if owner_user is None:
            report.add("space_owner", owner_label, "skipped", "missing_user")
            continue
        if await service.session.get(
            SpaceOwner, {"space_id": owner_space.id, "user_id": owner_user.id}
        ):
            report.add("space_owner", owner_label, "skipped", "already_owner")
            continue
        service.session.add(SpaceOwner(space_id=owner_space.id, user_id=owner_user.id))
        await service.session.flush()
        report.add("space_owner", owner_label, "created")

    # --- favourites ---------------------------------------------------
    for favorite in doc.space_favorites:
        fav_label = f"{favorite.space_key}/{favorite.username}"
        fav_space = await service.spaces.get_by_key(favorite.space_key)
        fav_user = await service.users.get_by_username(favorite.username)
        if fav_space is None or fav_user is None:
            report.add("space_favorite", fav_label, "skipped", "missing_reference")
            continue
        if await service.spaces.is_favorite(fav_space.id, fav_user.id):
            report.add("space_favorite", fav_label, "skipped", "already_favorite")
            continue
        service.session.add(SpaceFavorite(space_id=fav_space.id, user_id=fav_user.id))
        await service.session.flush()
        report.add("space_favorite", fav_label, "created")

    async def group_by_name(name: str) -> Group | None:
        return (
            await service.session.execute(
                select(Group).where(func.lower(Group.name) == name.strip().lower())
            )
        ).scalar_one_or_none()

    async def page_by_reference(space_key: str, slug: str) -> WikiPage | None:
        page_space = await service.spaces.get_by_key(space_key)
        if page_space is None:
            return None
        return (
            await service.session.execute(
                select(WikiPage).where(WikiPage.space_id == page_space.id, WikiPage.slug == slug)
            )
        ).scalar_one_or_none()

    # --- groups and permissions -------------------------------------
    for group_entry in doc.groups:
        label = group_entry.name.strip()
        if await group_by_name(label):
            report.add("group", label, "skipped", "name_exists")
            continue
        owner = await service.users.get_by_username(group_entry.owner_username)
        if owner is None:
            report.add("group", label, "skipped", "missing_owner")
            continue
        group = Group(
            name=label,
            description=group_entry.description.strip(),
            owner_id=owner.id,
            is_active=group_entry.is_active,
        )
        if await service.session.get(Group, group_entry.id) is None:
            group.id = group_entry.id
        service.session.add(group)
        await service.session.flush()
        # `GroupOwner` is what the app lists and manages owners by (the
        # API falls back to `owner_id` only when it is empty), so a
        # restored group gets a row for its primary owner and each extra
        # owner the archive names - same as creating one in the app.
        owner_ids = [owner.id]
        for extra_name in group_entry.owner_usernames:
            extra_owner = await service.users.get_by_username(extra_name)
            if extra_owner is not None and extra_owner.id not in owner_ids:
                owner_ids.append(extra_owner.id)
        service.session.add_all(
            GroupOwner(group_id=group.id, user_id=owner_id) for owner_id in owner_ids
        )
        await service.session.flush()
        report.add("group", label, "created")

    for group_member_entry in doc.group_members:
        label = f"{group_member_entry.group_name}/{group_member_entry.username}"
        member_group = await group_by_name(group_member_entry.group_name)
        member_user = await service.users.get_by_username(group_member_entry.username)
        if member_group is None or member_user is None:
            report.add("group_member", label, "skipped", "missing_reference")
            continue
        group_member_exists = (
            await service.session.execute(
                select(GroupMember).where(
                    GroupMember.group_id == member_group.id,
                    GroupMember.user_id == member_user.id,
                )
            )
        ).scalar_one_or_none()
        if group_member_exists:
            report.add("group_member", label, "skipped", "already_member")
            continue
        service.session.add(GroupMember(group_id=member_group.id, user_id=member_user.id))
        await service.session.flush()
        report.add("group_member", label, "created")

    for group_permission_entry in doc.group_global_permissions:
        label = f"{group_permission_entry.group_name}/{group_permission_entry.permission.value}"
        permission_group = await group_by_name(group_permission_entry.group_name)
        if permission_group is None:
            report.add("group_global_permission", label, "skipped", "missing_group")
            continue
        group_permission_exists = (
            await service.session.execute(
                select(GroupGlobalPermission).where(
                    GroupGlobalPermission.group_id == permission_group.id,
                    GroupGlobalPermission.permission == group_permission_entry.permission,
                )
            )
        ).scalar_one_or_none()
        if group_permission_exists:
            report.add("group_global_permission", label, "skipped", "already_assigned")
            continue
        service.session.add(
            GroupGlobalPermission(
                group_id=permission_group.id, permission=group_permission_entry.permission
            )
        )
        await service.session.flush()
        report.add("group_global_permission", label, "created")

    for override_entry in doc.user_global_permission_overrides:
        label = f"{override_entry.username}/{override_entry.permission.value}"
        override_user = await service.users.get_by_username(override_entry.username)
        if override_user is None:
            report.add("user_global_permission_override", label, "skipped", "missing_user")
            continue
        if (
            await service.session.get(
                UserGlobalPermissionOverride, (override_user.id, override_entry.permission)
            )
            is not None
        ):
            # The target's own setting wins - same "skip, never
            # overwrite" rule as every other row here.
            report.add("user_global_permission_override", label, "skipped", "already_set")
            continue
        service.session.add(
            UserGlobalPermissionOverride(
                user_id=override_user.id,
                permission=override_entry.permission,
                enabled=override_entry.enabled,
            )
        )
        await service.session.flush()
        report.add("user_global_permission_override", label, "created")

    for space_user_permission_entry in doc.space_user_permissions:
        label = "/".join(
            (
                space_user_permission_entry.space_key,
                space_user_permission_entry.username,
                space_user_permission_entry.permission.value,
            )
        )
        permission_space = await service.spaces.get_by_key(space_user_permission_entry.space_key)
        permission_user = await service.users.get_by_username(space_user_permission_entry.username)
        if permission_space is None or permission_user is None:
            report.add("space_user_permission", label, "skipped", "missing_reference")
            continue
        space_user_permission_exists = (
            await service.session.execute(
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
        service.session.add(
            SpaceUserPermission(
                space_id=permission_space.id,
                user_id=permission_user.id,
                permission=space_user_permission_entry.permission,
            )
        )
        await service.session.flush()
        report.add("space_user_permission", label, "created")

    for space_group_permission_entry in doc.space_group_permissions:
        label = "/".join(
            (
                space_group_permission_entry.space_key,
                space_group_permission_entry.group_name,
                space_group_permission_entry.permission.value,
            )
        )
        permission_space = await service.spaces.get_by_key(space_group_permission_entry.space_key)
        permission_group = await group_by_name(space_group_permission_entry.group_name)
        if permission_space is None or permission_group is None:
            report.add("space_group_permission", label, "skipped", "missing_reference")
            continue
        space_group_permission_exists = (
            await service.session.execute(
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
        service.session.add(
            SpaceGroupPermission(
                space_id=permission_space.id,
                group_id=permission_group.id,
                permission=space_group_permission_entry.permission,
            )
        )
        await service.session.flush()
        report.add("space_group_permission", label, "created")

    # --- pages and page-level access --------------------------------
    created_page_refs: set[tuple[str, str]] = set()
    for index, page_entry in enumerate(doc.pages):
        # Read-only: `_apply` runs inside `import_document`'s SAVEPOINT,
        # where a commit would release it early.
        if index % _PROGRESS_CHECK_EVERY == 0:
            await observe_backup_cancellation(service.session, job)
        label = f"{page_entry.space_key}/{page_entry.slug}"
        page_space = await service.spaces.get_by_key(page_entry.space_key)
        if page_space is None:
            report.add("page", label, "skipped", "missing_space")
            continue
        if await page_by_reference(page_entry.space_key, page_entry.slug):
            report.add("page", label, "skipped", "slug_exists")
            continue
        creator = (
            await service.users.get_by_username(page_entry.created_by_username)
            if page_entry.created_by_username
            else None
        )
        updater = (
            await service.users.get_by_username(page_entry.updated_by_username)
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
            view_restricted=bool(page_entry.view_restricted),
            inherit_restrictions=page_entry.inherit_restrictions,
            deleted_at=page_entry.deleted_at,
        )
        if page_entry.deleted_by_username:
            remover = await service.users.get_by_username(page_entry.deleted_by_username)
            page.deleted_by_id = remover.id if remover else None
        # Otherwise the row's created_at/updated_at default to "now" and
        # every restored page reads as edited at restore time instead of
        # when it actually last changed - mirrors the Confluence importer.
        if page_entry.created_at:
            page.created_at = page_entry.created_at
        if page_entry.updated_at:
            page.updated_at = page_entry.updated_at
        elif page_entry.created_at:
            page.updated_at = page_entry.created_at
        if await service.session.get(WikiPage, page_entry.id) is None:
            page.id = page_entry.id
        service.session.add(page)
        await service.session.flush()
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
        # Re-apply: `updated_at` has `onupdate=func.now()`, so without
        # this an UPDATE that only touches parent_id would silently
        # re-stamp every nested page back to restore time.
        if page_entry.updated_at:
            child_page.updated_at = page_entry.updated_at
            # Reassigning to the value it may already hold leaves the
            # attribute out of SQLAlchemy's change-history, so the
            # UPDATE's SET clause would omit it and the server-side
            # `onupdate` would win anyway - force it in.
            flag_modified(child_page, "updated_at")
        elif page_entry.created_at:
            child_page.updated_at = page_entry.created_at
            flag_modified(child_page, "updated_at")
        await service.session.flush()

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
            await service.session.execute(
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
            await service.users.get_by_username(revision_entry.created_by_username)
            if revision_entry.created_by_username
            else None
        )
        service.session.add(
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
        await service.session.flush()
        report.add("page_revision", label, "created")

    for like_entry in doc.page_likes:
        label = f"{like_entry.page_space_key}/{like_entry.page_slug}/{like_entry.username}"
        liked_page = await page_by_reference(like_entry.page_space_key, like_entry.page_slug)
        liked_user = await service.users.get_by_username(like_entry.username)
        if liked_page is None or liked_user is None:
            report.add("page_like", label, "skipped", "missing_reference")
            continue
        like_exists = (
            await service.session.execute(
                select(PageLike).where(
                    PageLike.page_id == liked_page.id, PageLike.user_id == liked_user.id
                )
            )
        ).scalar_one_or_none()
        if like_exists:
            report.add("page_like", label, "skipped", "already_liked")
            continue
        service.session.add(PageLike(page_id=liked_page.id, user_id=liked_user.id))
        await service.session.flush()
        report.add("page_like", label, "created")

    # Comments: parents before replies (the backup lists them oldest first),
    # keeping their ids so a re-run is a no-op and replies stay attached.
    for comment_entry in _parents_first(
        doc.page_comments, lambda entry: entry.id, lambda entry: entry.parent_id
    ):
        label = f"{comment_entry.page_space_key}/{comment_entry.page_slug}/{comment_entry.id}"
        comment_page = await page_by_reference(
            comment_entry.page_space_key, comment_entry.page_slug
        )
        if comment_page is None:
            report.add("page_comment", label, "skipped", "missing_reference")
            continue
        if (
            comment_entry.parent_id is not None
            and (await service.session.get(PageComment, comment_entry.parent_id)) is None
        ):
            report.add("page_comment", label, "skipped", "missing_parent")
            continue
        comment_row = await service.session.get(PageComment, comment_entry.id)
        if comment_row is None:
            comment_author = (
                await service.users.get_by_username(comment_entry.author_username)
                if comment_entry.author_username
                else None
            )
            values: dict[str, object] = {
                "id": comment_entry.id,
                "page_id": comment_page.id,
                "parent_id": comment_entry.parent_id,
                "author_id": comment_author.id if comment_author else None,
                "body": comment_entry.body,
                "edited_at": comment_entry.edited_at,
                "mentions": list(comment_entry.mentions),
            }
            if comment_entry.created_at is not None:
                values["created_at"] = comment_entry.created_at
            comment_row = PageComment(**values)
            service.session.add(comment_row)
            await service.session.flush()
            report.add("page_comment", label, "created")
        else:
            report.add("page_comment", label, "skipped", "already_exists")
        for liker_name in comment_entry.liked_by:
            liker = await service.users.get_by_username(liker_name)
            if liker is None:
                continue
            if await service.session.get(CommentLike, (comment_row.id, liker.id)) is None:
                service.session.add(CommentLike(comment_id=comment_row.id, user_id=liker.id))
        await service.session.flush()

    # Shares keep their ids, so restoring the same backup twice does not
    # double the share count.
    for share_entry in doc.page_shares:
        label = f"{share_entry.page_space_key}/{share_entry.page_slug}/{share_entry.id}"
        shared_page = await page_by_reference(share_entry.page_space_key, share_entry.page_slug)
        recipient = await service.users.get_by_username(share_entry.recipient_username)
        if shared_page is None or recipient is None:
            report.add("page_share", label, "skipped", "missing_reference")
            continue
        if await service.session.get(PageShare, share_entry.id) is not None:
            report.add("page_share", label, "skipped", "already_exists")
            continue
        sharer = (
            await service.users.get_by_username(share_entry.shared_by_username)
            if share_entry.shared_by_username
            else None
        )
        share_values: dict[str, object] = {
            "id": share_entry.id,
            "page_id": shared_page.id,
            "recipient_id": recipient.id,
            "shared_by_id": sharer.id if sharer else None,
        }
        if share_entry.created_at is not None:
            share_values["created_at"] = share_entry.created_at
        service.session.add(PageShare(**share_values))
        await service.session.flush()
        report.add("page_share", label, "created")

    for pin_entry in doc.page_pins:
        pin_page = await page_by_reference(pin_entry.page_space_key, pin_entry.page_slug)
        pin_user = await service.users.get_by_username(pin_entry.username)
        label = f"{pin_entry.page_space_key}/{pin_entry.page_slug}/{pin_entry.username}"
        if pin_page is None or pin_user is None:
            report.add("page_pin", label, "skipped", "missing_reference")
        elif (
            await service.session.get(UserPagePin, {"page_id": pin_page.id, "user_id": pin_user.id})
        ) is not None:
            report.add("page_pin", label, "skipped", "already_pinned")
        else:
            service.session.add(UserPagePin(page_id=pin_page.id, user_id=pin_user.id))
            await service.session.flush()
            report.add("page_pin", label, "created")

    for draft_entry in doc.page_drafts:
        draft_page = await page_by_reference(draft_entry.page_space_key, draft_entry.page_slug)
        draft_user = await service.users.get_by_username(draft_entry.username)
        label = f"{draft_entry.page_space_key}/{draft_entry.page_slug}/{draft_entry.username}"
        if draft_page is None or draft_user is None:
            report.add("page_draft", label, "skipped", "missing_reference")
            continue
        existing_draft = await service.session.execute(
            select(PageDraft).where(
                PageDraft.page_id == draft_page.id,
                PageDraft.user_id == draft_user.id,
            )
        )
        if existing_draft.scalar_one_or_none() is not None:
            report.add("page_draft", label, "skipped", "already_exists")
        else:
            service.session.add(
                PageDraft(
                    page_id=draft_page.id,
                    user_id=draft_user.id,
                    content=draft_entry.content,
                    content_format=draft_entry.content_format,
                    edit_mode=draft_entry.edit_mode,
                    base_updated_at=draft_entry.base_updated_at,
                )
            )
            await service.session.flush()
            report.add("page_draft", label, "created")

    for tag_entry in doc.user_tags:
        tag_user = await service.users.get_by_username(tag_entry.username)
        tag_label = f"{tag_entry.username}/{tag_entry.name}"
        if tag_user is None:
            report.add("user_tag", tag_label, "skipped", "missing_user")
            continue
        existing_tag = await service.session.execute(
            select(UserTag).where(
                UserTag.user_id == tag_user.id,
                UserTag.name == tag_entry.name,
            )
        )
        if existing_tag.scalar_one_or_none() is not None:
            report.add("user_tag", tag_label, "skipped", "already_exists")
        else:
            service.session.add(UserTag(user_id=tag_user.id, name=tag_entry.name))
            await service.session.flush()
            report.add("user_tag", tag_label, "created")

    for label_entry in doc.user_page_labels:
        label_page = await page_by_reference(label_entry.page_space_key, label_entry.page_slug)
        label_user = await service.users.get_by_username(label_entry.username)
        label = (
            f"{label_entry.page_space_key}/{label_entry.page_slug}"
            f"/{label_entry.username}/{label_entry.name}"
        )
        if label_page is None or label_user is None:
            report.add("user_page_label", label, "skipped", "missing_reference")
            continue
        existing_label = await service.session.execute(
            select(UserPageLabel).where(
                UserPageLabel.page_id == label_page.id,
                UserPageLabel.user_id == label_user.id,
                UserPageLabel.name == label_entry.name,
            )
        )
        if existing_label.scalar_one_or_none() is not None:
            report.add("user_page_label", label, "skipped", "already_exists")
        else:
            service.session.add(
                UserPageLabel(
                    page_id=label_page.id,
                    user_id=label_user.id,
                    name=label_entry.name,
                )
            )
            await service.session.flush()
            report.add("user_page_label", label, "created")

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
        restricted_user = await service.users.get_by_username(user_restriction_entry.username)
        if restricted_page is None or restricted_user is None:
            report.add("page_user_restriction", label, "skipped", "missing_reference")
            continue
        user_restriction_exists = (
            await service.session.execute(
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
        service.session.add(
            PageUserRestriction(
                page_id=restricted_page.id,
                user_id=restricted_user.id,
                permission=user_restriction_entry.permission,
                denied=user_restriction_entry.denied,
            )
        )
        await service.session.flush()
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
            await service.session.execute(
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
        service.session.add(
            PageGroupRestriction(
                page_id=restricted_page.id,
                group_id=restricted_group.id,
                permission=group_restriction_entry.permission,
                denied=group_restriction_entry.denied,
            )
        )
        await service.session.flush()
        report.add("page_group_restriction", label, "created")

    # Archives written before `view_restricted` was exported carry the
    # allow-list rows but not the switch that makes them count, so a page
    # restored from one would come back Open to everyone. Infer Restricted
    # from the rows for exactly those pages (an explicit flag is never
    # overridden).
    legacy_refs = {
        (entry.space_key.strip().upper(), entry.slug.strip())
        for entry in doc.pages
        if entry.view_restricted is None
    } & created_page_refs
    if legacy_refs:
        allow_rows = [
            (r.page_space_key, r.page_slug) for r in doc.page_user_restrictions if not r.denied
        ] + [(r.page_space_key, r.page_slug) for r in doc.page_group_restrictions if not r.denied]
        for space_key, slug in dict.fromkeys(allow_rows):
            if (space_key.strip().upper(), slug.strip()) not in legacy_refs:
                continue
            legacy_page = await page_by_reference(space_key, slug)
            if legacy_page is not None and not legacy_page.view_restricted:
                legacy_page.view_restricted = True
        await service.session.flush()

    # --- page templates -----------------------------------------------
    for tpl_entry in doc.page_templates:
        tpl_name = tpl_entry.name.strip()[:200]
        if not tpl_name:
            report.add("page_template", "(blank)", "skipped", "invalid_name")
            continue
        tpl_label = (
            f"{tpl_entry.space_key}/{tpl_name}"
            if tpl_entry.scope == "space" and tpl_entry.space_key
            else f"global/{tpl_name}"
        )
        target_space_id = None
        if tpl_entry.scope == "space":
            if not tpl_entry.space_key:
                report.add("page_template", tpl_label, "skipped", "missing_space")
                continue
            tpl_space = await service.spaces.get_by_key(tpl_entry.space_key)
            if tpl_space is None:
                report.add("page_template", tpl_label, "skipped", "missing_space")
                continue
            target_space_id = tpl_space.id

        if await service.session.get(PageTemplate, tpl_entry.id) is not None:
            report.add("page_template", tpl_label, "skipped", "already_exists")
            continue

        dup_query = select(PageTemplate).where(
            PageTemplate.scope == tpl_entry.scope,
            PageTemplate.name == tpl_name,
        )
        if target_space_id is None:
            dup_query = dup_query.where(PageTemplate.space_id.is_(None))
        else:
            dup_query = dup_query.where(PageTemplate.space_id == target_space_id)
        if (await service.session.execute(dup_query)).scalar_one_or_none() is not None:
            report.add("page_template", tpl_label, "skipped", "already_exists")
            continue

        tpl_creator = (
            await service.users.get_by_username(tpl_entry.created_by_username)
            if tpl_entry.created_by_username
            else None
        )
        tpl_updater = (
            await service.users.get_by_username(tpl_entry.updated_by_username)
            if tpl_entry.updated_by_username
            else None
        )
        tpl_format = "markdown" if tpl_entry.content_format == "markdown" else "html"
        restored_tpl = PageTemplate(
            id=tpl_entry.id,
            scope=tpl_entry.scope,
            space_id=target_space_id,
            name=tpl_name,
            description=tpl_entry.description.strip()[:500],
            category=tpl_entry.category.strip()[:64] or "general",
            icon=tpl_entry.icon.strip()[:32],
            content=sanitize_template_content(tpl_entry.content, tpl_format),
            content_format=tpl_format,
            created_by_id=tpl_creator.id if tpl_creator else None,
            updated_by_id=tpl_updater.id if tpl_updater else None,
        )
        if tpl_entry.created_at:
            restored_tpl.created_at = tpl_entry.created_at
        if tpl_entry.updated_at:
            restored_tpl.updated_at = tpl_entry.updated_at
        service.session.add(restored_tpl)
        await service.session.flush()
        report.add("page_template", tpl_label, "created")

    # --- settings -----------------------------------------------------
    if doc.site_settings is not None:
        incoming: dict[str, Any] = doc.site_settings.model_dump(exclude_none=True)
        current = (await service.site_settings.read()).overrides
        if any(value is not None for value in current.model_dump().values()):
            # Never clobber an instance that has already been configured.
            report.add("site_settings", "site settings", "skipped", "already_configured")
        elif incoming:
            from app.schemas.site_settings import SiteSettingsUpdate

            await service.site_settings.update(SiteSettingsUpdate(**incoming))
            report.add("site_settings", "site settings", "created")
