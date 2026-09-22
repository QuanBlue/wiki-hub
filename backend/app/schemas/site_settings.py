"""Site settings schemas.

The read shape returns **both** the raw overrides and the effective values.
That is what lets the UI say "Site name: WikiHub (inherited from environment)"
and offer a Reset control — with only the effective value, an administrator
cannot tell a deliberate setting from an inherited default.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

AppRole = Literal["admin", "member"]


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
    session_ttl_hours: int | None = None


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
    session_ttl_hours: int


class SiteSettingsRead(BaseModel):
    overrides: SiteSettingsOverrides
    effective: EffectiveSettings
    updated_at: datetime | None = None
    updated_by_username: str | None = None


class SidebarPermissionsRead(BaseModel):
    """The effective navigation policy, safe for every signed-in user to read."""

    permissions: SidebarPermissions


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
    session_ttl_hours: int | None = Field(default=None, ge=1, le=8760)

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
