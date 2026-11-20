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

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.models.audit import AuditAction
from app.models.site_settings import DEFAULT_TRASH_RETENTION_DAYS, SINGLETON_ID, SiteSettings
from app.models.user import User
from app.schemas.site_settings import (
    ActiveSeasonalTheme,
    AnnouncementRead,
    EffectiveSettings,
    LoginPanel,
    SeasonalCalendarEntry,
    SeasonalEffectPresetId,
    SeasonalThemeSettings,
    SidebarPermissions,
    SidebarPermissionsRead,
    SiteSettingsOverrides,
    SiteSettingsRead,
    SiteSettingsUpdate,
    SystemAnnouncement,
    UpcomingSeasonalReminder,
)
from app.services.audit import AuditService, ClientInfo
from app.services.seasonal_theme import (
    build_home_calendar,
    find_upcoming_reminders,
    merge_builtin_events,
    resolve_active_seasonal_theme,
)
from app.services.storage import ObjectStorage

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
    "seasonal_theme",
    "login_panel",
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

    async def read_seasonal_reminders(self) -> list[UpcomingSeasonalReminder]:
        effective = await self.get_effective()
        return find_upcoming_reminders(effective.seasonal_theme)

    async def read_seasonal_calendar(self) -> list[SeasonalCalendarEntry]:
        effective = await self.get_effective()
        return build_home_calendar(effective.seasonal_theme)

    async def activate_seasonal_preset(
        self, preset: SeasonalEffectPresetId
    ) -> ActiveSeasonalTheme:
        effective = await self.get_effective()
        updated = effective.seasonal_theme.model_copy(
            update={"mode": "manual", "manual_preset": preset}
        )
        await self.update(SiteSettingsUpdate(seasonal_theme=updated))
        return resolve_active_seasonal_theme(updated)

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
        seasonal_raw = getattr(row, "seasonal_theme", None)
        seasonal_theme = (
            SeasonalThemeSettings.model_validate(seasonal_raw)
            if seasonal_raw is not None
            else SeasonalThemeSettings()
        )
        # Older installs stored only the original built-ins; surface new ones.
        seasonal_theme = seasonal_theme.model_copy(
            update={"events": merge_builtin_events(seasonal_theme.events)}
        )
        login_panel_raw = getattr(row, "login_panel", None)
        login_panel = (
            LoginPanel.model_validate(login_panel_raw)
            if login_panel_raw is not None
            else LoginPanel()
        )
        image_updated_at = getattr(row, "login_image_updated_at", None)
        login_image_url = (
            f"{settings.api_v1_prefix}/meta/login-image?v={int(image_updated_at.timestamp())}"
            if getattr(row, "login_image_object_key", None) and image_updated_at is not None
            else None
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
            seasonal_theme=seasonal_theme,
            login_panel=login_panel,
            login_image_url=login_image_url,
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

    async def read_login_image(self, storage: ObjectStorage) -> tuple[bytes, str] | None:
        """The uploaded sign-in illustration and its content type, if any."""
        row = await self._get_row()
        key = getattr(row, "login_image_object_key", None)
        if row is None or not key:
            return None
        return await storage.get(key), row.login_image_content_type or "image/png"

    async def set_login_image(
        self, storage: ObjectStorage, *, data: bytes, content_type: str, extension: str
    ) -> SiteSettingsRead:
        row = await self._get_row()
        if row is None:
            row = SiteSettings(id=SINGLETON_ID)
            self.session.add(row)
            await self.session.flush()
        key = f"site/login/{uuid.uuid4()}.{extension}"
        await storage.put(key, data, content_type=content_type)
        old_key = row.login_image_object_key
        row.login_image_object_key = key
        row.login_image_content_type = content_type
        row.login_image_updated_at = datetime.now(UTC)
        if self.actor is not None:
            row.updated_by_id = self.actor.id
        await self.session.flush()
        if old_key and old_key != key:
            await storage.delete(old_key)
        await self._audit_login_image("uploaded")
        return await self.read()

    async def clear_login_image(self, storage: ObjectStorage) -> SiteSettingsRead:
        row = await self._get_row()
        if row is not None and row.login_image_object_key:
            await storage.delete(row.login_image_object_key)
            row.login_image_object_key = None
            row.login_image_content_type = None
            row.login_image_updated_at = None
            if self.actor is not None:
                row.updated_by_id = self.actor.id
            await self.session.flush()
            await self._audit_login_image("removed")
        return await self.read()

    async def _audit_login_image(self, what: str) -> None:
        await self.audit.record(
            AuditAction.site_settings_updated,
            entity_type="site_settings",
            entity_label="Site settings",
            details={"changes": {"login_image": what}},
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
        if "seasonal_theme" in data and payload.seasonal_theme is not None:
            # Preserve server-managed notification history when the UI saves settings.
            existing_notified = (
                (row.seasonal_theme or {}).get("notified_occurrences", {})
                if isinstance(row.seasonal_theme, dict)
                else {}
            )
            merged_notified = {**existing_notified, **payload.seasonal_theme.notified_occurrences}
            stamped_seasonal = payload.seasonal_theme.model_copy(
                update={"notified_occurrences": merged_notified}
            )
            data["seasonal_theme"] = stamped_seasonal.model_dump(mode="json")
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
