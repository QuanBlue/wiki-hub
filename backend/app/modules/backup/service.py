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

from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import BadRequestError
from app.core.logging import get_logger
from app.models.audit import AuditAction
from app.models.space import Space, SpaceFavorite, SpaceMember, SpaceStatus
from app.models.user import User
from app.repositories.space import SpaceRepository
from app.repositories.user import UserRepository
from app.schemas.backup import (
    BACKUP_VERSION,
    MAX_REPORT_ENTRIES,
    BackupDocument,
    BackupMeta,
    BackupSiteSettings,
    BackupSpace,
    BackupSpaceFavorite,
    BackupSpaceMember,
    BackupUser,
    ImportEntry,
    ImportReport,
)
from app.services.audit import AuditService, ClientInfo
from app.services.site_settings import SiteSettingsService

logger = get_logger(__name__)


class _ReportBuilder:
    """Accumulates counts exactly, per-item entries only up to a cap."""

    def __init__(self) -> None:
        self.created: dict[str, int] = {}
        self.skipped: dict[str, int] = {}
        self.errors: dict[str, int] = {}
        self.entries: list[ImportEntry] = []
        self.truncated = False

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
    async def export_document(self, *, include_credentials: bool = False) -> BackupDocument:
        """Serialise the instance.

        ``include_credentials`` defaults to False: the result is a browser
        download that ends up in a Downloads folder, a cloud sync and possibly a
        support ticket, and a file of Argon2 hashes is an offline cracking
        target for every weak password in the instance. Migrating to new
        hardware is a real need, so the opt-in exists — as a deliberate,
        audited choice.
        """
        users = list((await self.session.execute(select(User).order_by(User.username))).scalars())
        spaces = list((await self.session.execute(select(Space).order_by(Space.key))).scalars())

        users_by_id = {u.id: u for u in users}
        spaces_by_id = {s.id: s for s in spaces}

        members = list((await self.session.execute(select(SpaceMember))).scalars())
        favorites = list((await self.session.execute(select(SpaceFavorite))).scalars())
        overrides = (await self.site_settings.read()).overrides

        doc_users = []
        for user in users:
            entry = BackupUser.model_validate(user)
            # Never emit a hash unless explicitly requested.
            entry.password_hash = user.password_hash if include_credentials else None
            doc_users.append(entry)

        doc_spaces = [
            BackupSpace(
                id=s.id,
                key=s.key,
                name=s.name,
                description=s.description,
                icon=s.icon,
                status=s.status,
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

        effective = await self.site_settings.get_effective()
        document = BackupDocument(
            wikihub_backup=BackupMeta(
                version=BACKUP_VERSION,
                exported_at=datetime.now(UTC),
                app_version=settings.project_version,
                site_name=effective.site_name,
                includes_credentials=include_credentials,
                counts={
                    "users": len(doc_users),
                    "spaces": len(doc_spaces),
                    "space_members": len(doc_members),
                    "space_favorites": len(doc_favorites),
                },
            ),
            users=doc_users,
            spaces=doc_spaces,
            space_members=doc_members,
            space_favorites=doc_favorites,
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

    # -- import ------------------------------------------------------------
    async def import_document(self, doc: BackupDocument, *, dry_run: bool = True) -> ImportReport:
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
        """
        if doc.wikihub_backup.version != BACKUP_VERSION:
            raise BadRequestError(
                f"Unsupported backup version {doc.wikihub_backup.version}; "
                f"this build reads version {BACKUP_VERSION}.",
                code="unsupported_backup_version",
            )

        report = _ReportBuilder()
        no_password: list[str] = []

        savepoint = await self.session.begin_nested()
        try:
            await self._apply(doc, report, no_password)
        finally:
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
        for entry in doc.users:
            username = entry.username.strip()
            if protected is not None and (
                username.lower() == protected.username.lower()
                or entry.email.strip().lower() == protected.email.lower()
            ):
                # Never merge into or rename the local protected admin. Without
                # this, the uq_users_single_protected index would raise and
                # abort the entire import.
                report.add("user", username, "skipped", "conflicts_with_protected_account")
                continue
            if await self.users.get_by_username(username):
                report.add("user", username, "skipped", "username_exists")
                continue
            if await self.users.get_by_email(entry.email):
                report.add("user", username, "skipped", "email_exists")
                continue

            user = User(
                username=username,
                email=entry.email.strip().lower(),
                full_name=entry.full_name.strip(),
                password_hash=entry.password_hash,
                is_active=entry.is_active,
                is_superuser=entry.is_superuser,
                # Hardcoded False - the single most important line here. A
                # backup must not be able to introduce a protected account.
                is_protected=False,
            )
            # Preserve the original id when it is free, so references elsewhere
            # in an operator's notes still line up.
            if entry.id and await self.users.get(entry.id) is None:
                user.id = entry.id
            self.session.add(user)
            await self.session.flush()

            if not entry.password_hash:
                no_password.append(username)
            report.add("user", username, "created")

        # --- spaces -------------------------------------------------------
        for space_entry in doc.spaces:
            key = space_entry.key.strip().upper()
            if await self.spaces.get_by_key(key):
                report.add("space", key, "skipped", "key_exists")
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
