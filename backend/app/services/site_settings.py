"""Runtime-editable instance settings, layered over the environment.

Resolution is always "override if not NULL, else the environment value", so
``core.config.settings`` stays exactly what it is: an immutable, import-time
snapshot of the environment. Nothing here mutates it.

**No caching, deliberately.** Each read is one primary-key lookup on a one-row
table, on the two endpoints that need it. A process-level TTL cache would go
stale differently in each uvicorn worker and in the arq worker, and fixing that
properly means Redis pub/sub invalidation — exactly the infrastructure this
phase is meant to avoid. If profiling ever justifies it, add a short TTL and
document the staleness window here.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.models.audit import AuditAction
from app.models.site_settings import DEFAULT_TRASH_RETENTION_DAYS, SINGLETON_ID, SiteSettings
from app.models.user import User
from app.schemas.site_settings import (
    AnnouncementRead,
    EffectiveSettings,
    SidebarPermissions,
    SidebarPermissionsRead,
    SiteSettingsOverrides,
    SiteSettingsRead,
    SiteSettingsUpdate,
    SystemAnnouncement,
)
from app.services.audit import AuditService, ClientInfo

logger = get_logger(__name__)

#: Fields recorded in the audit diff when settings change.
AUDITED_FIELDS = (
    "site_name",
    "theme_color",
    "default_font",
    "logo_icon",
    "custom_logo_url",
    "max_upload_size_mb",
    "max_backup_import_size_mb",
    "allowed_attachment_types",
    "sidebar_permissions",
    "announcement",
    "session_ttl_hours",
    "trash_retention_days",
    "public_shares_enabled",
)


class SiteSettingsService:
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
        self.audit = AuditService(session, actor=actor, client=client, impersonator=impersonator)

    async def _get_row(self) -> SiteSettings | None:
        """The singleton row, or ``None`` if it was never created.

        Absence is a real state, not a bug: the migration inserts the row, but
        the integration test fixture builds its schema with
        ``Base.metadata.create_all`` and never runs migrations. Every read path
        therefore has to tolerate a missing row, and the write path creates it
        lazily.
        """
        return (
            await self.session.execute(select(SiteSettings).where(SiteSettings.id == SINGLETON_ID))
        ).scalar_one_or_none()

    async def get_effective(self) -> EffectiveSettings:
        row = await self._get_row()
        return self._effective(row)

    async def read_sidebar_permissions(self) -> SidebarPermissionsRead:
        return SidebarPermissionsRead(permissions=(await self.get_effective()).sidebar_permissions)

    async def read_announcement(self) -> AnnouncementRead:
        announcement = (await self.get_effective()).announcement
        return AnnouncementRead(
            announcement=announcement if announcement.is_currently_active() else None
        )

    @classmethod
    def env_defaults(cls) -> EffectiveSettings:
        """Effective settings with no database involved.

        Used by ``/meta`` when the database is unreachable, so instance
        metadata degrades to the environment rather than failing outright.
        """
        return cls._effective(None)

    @staticmethod
    def _effective(row: SiteSettings | None) -> EffectiveSettings:
        site_name = getattr(row, "site_name", None) or settings.site_name
        theme_color = getattr(row, "theme_color", None) or "blue"
        default_font = getattr(row, "default_font", None) or "inter"
        logo_icon = getattr(row, "logo_icon", None) or "default"
        custom_logo_url = getattr(row, "custom_logo_url", None)
        max_mb = getattr(row, "max_upload_size_mb", None) or settings.max_upload_size_mb
        import_mb = getattr(row, "max_backup_import_size_mb", None) or settings.max_import_size_mb
        types = getattr(row, "allowed_attachment_types", None)
        if types is None:
            types = list(settings.attachment_allowed_types)
        sidebar_perms_raw = getattr(row, "sidebar_permissions", None)
        sidebar_permissions = (
            SidebarPermissions.model_validate(sidebar_perms_raw)
            if sidebar_perms_raw is not None
            else SidebarPermissions()
        )
        announcement_raw = getattr(row, "announcement", None)
        announcement = (
            SystemAnnouncement.model_validate(announcement_raw)
            if announcement_raw is not None
            else SystemAnnouncement()
        )
        session_ttl_hours = getattr(row, "session_ttl_hours", None) or (
            settings.access_token_ttl_seconds // 3600
        )
        return EffectiveSettings(
            site_name=site_name,
            theme_color=theme_color,
            default_font=default_font,
            logo_icon=logo_icon,
            custom_logo_url=custom_logo_url,
            max_upload_size_mb=max_mb,
            max_upload_size_bytes=max_mb * 1024 * 1024,
            max_backup_import_size_mb=import_mb,
            max_backup_import_size_bytes=import_mb * 1024 * 1024,
            allowed_attachment_types=list(types),
            sidebar_permissions=sidebar_permissions,
            announcement=announcement,
            session_ttl_hours=session_ttl_hours,
            trash_retention_days=(
                getattr(row, "trash_retention_days", None) or DEFAULT_TRASH_RETENTION_DAYS
            ),
            public_shares_enabled=(
                getattr(row, "public_shares_enabled", None)
                if getattr(row, "public_shares_enabled", None) is not None
                else getattr(settings, "public_shares_enabled", True)
            ),
        )

    async def read(self) -> SiteSettingsRead:
        row = await self._get_row()
        overrides = SiteSettingsOverrides.model_validate(row) if row else SiteSettingsOverrides()
        updated_by = None
        if row is not None and row.updated_by_id is not None:
            updated_by_user = await self.session.get(User, row.updated_by_id)
            updated_by = updated_by_user.username if updated_by_user else None

        return SiteSettingsRead(
            overrides=overrides,
            effective=self._effective(row),
            updated_at=row.updated_at if row else None,
            updated_by_username=updated_by,
        )

    async def update(self, payload: SiteSettingsUpdate) -> SiteSettingsRead:
        row = await self._get_row()
        if row is None:
            row = SiteSettings(id=SINGLETON_ID)
            self.session.add(row)
            await self.session.flush()

        before = {field: getattr(row, field, None) for field in AUDITED_FIELDS}

        # `in data` rather than `is not None`: an explicit null is meaningful
        # here - it resets the setting back to the environment default.
        data = payload.model_dump(exclude_unset=True)
        if "announcement" in data and payload.announcement is not None:
            stamped = payload.announcement.model_copy(
                update={"updated_at": datetime.now(UTC)}
            )
            data["announcement"] = stamped.model_dump(mode="json")
        for field in AUDITED_FIELDS:
            if field in data:
                setattr(row, field, data[field])

        if self.actor is not None:
            row.updated_by_id = self.actor.id

        await self.session.flush()
        await self.session.refresh(row)

        after = {field: getattr(row, field, None) for field in AUDITED_FIELDS}
        diff = AuditService.changes(before, after, AUDITED_FIELDS)
        if diff:
            logger.info("site_settings_updated", changed=sorted(diff))
            action = AuditAction.site_settings_updated
            if set(diff) == {"sidebar_permissions"}:
                action = AuditAction.sidebar_permissions_updated
            elif set(diff) == {"announcement"}:
                action = AuditAction.announcement_updated
            await self.audit.record(
                action,
                entity_type="site_settings",
                entity_label="Site settings",
                details={"changes": diff},
            )

        return await self.read()
