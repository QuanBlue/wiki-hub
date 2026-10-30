"""Site settings schemas.

The read shape returns **both** the raw overrides and the effective values.
That is what lets the UI say "Site name: WikiHub (inherited from environment)"
and offer a Reset control — with only the effective value, an administrator
cannot tell a deliberate setting from an inherited default.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

AppRole = Literal["admin", "member"]
AnnouncementLevel = Literal["info", "warning", "danger", "success"]


def _strip_empty_html(value: str) -> str:
    """Return plain text extracted from HTML to detect visually empty editor output."""
    text = re.sub(r"<[^>]+>", "", value).replace("&nbsp;", " ").strip()
    return text


class SystemAnnouncement(BaseModel):
    """Top-of-page system announcement banner configured by an administrator."""

    enabled: bool = False
    level: AnnouncementLevel = "info"
    title: str | None = Field(default=None, max_length=255)
    content_html: str = Field(default="", max_length=50_000)
    starts_at: datetime | None = None
    expires_at: datetime | None = None
    dismissible: bool = True
    show_on_login: bool = True
    updated_at: datetime | None = None

    @field_validator("title")
    @classmethod
    def _clean_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("content_html")
    @classmethod
    def _clean_content_html(cls, value: str | None) -> str:
        if not value:
            return ""
        stripped = value.strip()
        if not _strip_empty_html(stripped) and "<img" not in stripped.lower():
            return ""
        return stripped

    @field_validator("starts_at", "expires_at", "updated_at")
    @classmethod
    def _ensure_tz_aware(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)

    @model_validator(mode="after")
    def _validate_schedule(self) -> SystemAnnouncement:
        if (
            self.starts_at is not None
            and self.expires_at is not None
            and self.expires_at <= self.starts_at
        ):
            raise ValueError("Announcement expiry time must be after the start time.")
        return self

    def has_content(self) -> bool:
        return bool(
            (self.title and self.title.strip())
            or _strip_empty_html(self.content_html)
            or "<img" in self.content_html.lower()
        )

    def is_currently_active(self, now: datetime | None = None) -> bool:
        if not self.enabled or not self.has_content():
            return False
        current = now or datetime.now(UTC)
        if current.tzinfo is None:
            current = current.replace(tzinfo=UTC)
        if self.starts_at is not None and current < self.starts_at:
            return False
        if self.expires_at is not None and current >= self.expires_at:
            return False
        return True


def _all_app_roles() -> list[AppRole]:
    return ["admin", "member"]


def _admin_role() -> list[AppRole]:
    return ["admin"]


class SidebarPermissions(BaseModel):
    """Visibility policy for the persistent application navigation.

    These roles are intentionally the instance-level roles from the user model,
    not space roles. A page inside a space remains protected by that space's
    membership rules regardless of whether its parent navigation is visible.
    """

    # Home is the one link every signed-in user must always be able to reach,
    # so its role set is fixed the same way settings/backups are fixed below.
    home: list[AppRole] = Field(default_factory=_all_app_roles)
    spaces: list[AppRole] = Field(default_factory=_all_app_roles)
    recent: list[AppRole] = Field(default_factory=_all_app_roles)
    favorites: list[AppRole] = Field(default_factory=_all_app_roles)
    pinned: list[AppRole] = Field(default_factory=_all_app_roles)
    # Administrative routes already enforce this on the server. Keeping their
    # policy fixed prevents a member from seeing a link that can only end in a
    # 403 and ensures an administrator can always reach Settings.
    settings: list[AppRole] = Field(default_factory=_admin_role)
    backups: list[AppRole] = Field(default_factory=_admin_role)

    @field_validator("spaces", "recent", "favorites", "pinned")
    @classmethod
    def _dedupe_roles(cls, value: list[AppRole]) -> list[AppRole]:
        # An empty list is a valid, deliberate state: "hidden from everyone".
        return list(dict.fromkeys(value))

    @field_validator("home")
    @classmethod
    def _keep_home_visible(cls, value: list[AppRole]) -> list[AppRole]:
        # Coerce rather than raise: this model also parses whatever is
        # already stored on the settings row, including values saved before
        # Home became a fixed, always-visible link (e.g. a legacy row with
        # `home: ["admin"]`). Rejecting that would crash every page load
        # that reads effective settings instead of just healing it.
        return ["admin", "member"]

    @model_validator(mode="after")
    def _keep_administration_safe(self) -> SidebarPermissions:
        if self.settings != ["admin"] or self.backups != ["admin"]:
            raise ValueError("Settings and backups are available to administrators only.")
        return self


class SiteSettingsOverrides(BaseModel):
    """The stored values. ``None`` means "inherit from the environment"."""

    model_config = ConfigDict(from_attributes=True)

    site_name: str | None = None
    theme_color: str | None = None
    default_font: str | None = None
    logo_icon: str | None = None
    custom_logo_url: str | None = None
    max_upload_size_mb: int | None = None
    max_backup_import_size_mb: int | None = None
    allowed_attachment_types: list[str] | None = None
    sidebar_permissions: SidebarPermissions | None = None
    announcement: SystemAnnouncement | None = None
    session_ttl_hours: int | None = None
    trash_retention_days: int | None = None


class EffectiveSettings(BaseModel):
    """What the application actually uses: override if set, else the env default."""

    site_name: str
    theme_color: str
    default_font: str
    logo_icon: str
    custom_logo_url: str | None
    max_upload_size_mb: int
    max_upload_size_bytes: int
    max_backup_import_size_mb: int
    max_backup_import_size_bytes: int
    allowed_attachment_types: list[str]
    sidebar_permissions: SidebarPermissions
    announcement: SystemAnnouncement = Field(default_factory=SystemAnnouncement)
    session_ttl_hours: int
    trash_retention_days: int


class SiteSettingsRead(BaseModel):
    overrides: SiteSettingsOverrides
    effective: EffectiveSettings
    updated_at: datetime | None = None
    updated_by_username: str | None = None


class SidebarPermissionsRead(BaseModel):
    """The effective navigation policy, safe for every signed-in user to read."""

    permissions: SidebarPermissions


class AnnouncementRead(BaseModel):
    """The currently active system announcement (if any), safe for signed-in users."""

    announcement: SystemAnnouncement | None = None


class SiteSettingsUpdate(BaseModel):
    """Partial update.

    Distinguishing *absent* from *explicit null* is essential here and is why
    the service must test ``if "field" in data`` rather than the usual
    ``data.get(...) is not None``: sending ``null`` is how the UI resets a
    setting back to the environment default.
    """

    site_name: str | None = Field(default=None, max_length=255)
    theme_color: str | None = Field(default=None, max_length=50)
    default_font: str | None = Field(default=None, max_length=50)
    logo_icon: str | None = Field(default=None, max_length=50)
    custom_logo_url: str | None = Field(default=None, max_length=1_000_000)
    max_upload_size_mb: int | None = Field(default=None, ge=1, le=10_240)
    max_backup_import_size_mb: int | None = Field(default=None, ge=1, le=102_400)
    allowed_attachment_types: list[str] | None = Field(default=None, max_length=100)
    sidebar_permissions: SidebarPermissions | None = None
    announcement: SystemAnnouncement | None = None
    session_ttl_hours: int | None = Field(default=None, ge=1, le=8760)
    trash_retention_days: int | None = Field(default=None, ge=1, le=3650)

    @field_validator("site_name")
    @classmethod
    def _non_blank_site_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("theme_color")
    @classmethod
    def _validate_theme_color(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("default_font")
    @classmethod
    def _validate_default_font(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip().lower()
        return stripped or None

    @field_validator("logo_icon")
    @classmethod
    def _validate_logo_icon(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip().lower()
        return stripped or None

    @field_validator("custom_logo_url")
    @classmethod
    def _validate_custom_logo_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("allowed_attachment_types")
    @classmethod
    def _normalise_extensions(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        seen: list[str] = []
        for raw in value:
            ext = raw.strip().lower().lstrip(".")
            if not ext:
                continue
            if ext != "*" and not ext.isalnum():
                raise ValueError(f"'{raw}' is not a valid file extension.")
            if ext not in seen:
                seen.append(ext)
        return seen
