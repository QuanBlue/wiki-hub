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

    home: list[AppRole] = Field(default_factory=_all_app_roles)
    spaces: list[AppRole] = Field(default_factory=_all_app_roles)
    recent: list[AppRole] = Field(default_factory=_all_app_roles)
    favorites: list[AppRole] = Field(default_factory=_all_app_roles)
    # Administrative routes already enforce this on the server. Keeping their
    # policy fixed prevents a member from seeing a link that can only end in a
    # 403 and ensures an administrator can always reach Settings.
    settings: list[AppRole] = Field(default_factory=_admin_role)
    backups: list[AppRole] = Field(default_factory=_admin_role)

    @field_validator("home", "spaces", "recent", "favorites")
    @classmethod
    def _require_a_role(cls, value: list[AppRole]) -> list[AppRole]:
        unique = list(dict.fromkeys(value))
        if not unique:
            raise ValueError("At least one role must be allowed for each navigation item.")
        return unique

    @model_validator(mode="after")
    def _keep_administration_safe(self) -> SidebarPermissions:
        if self.settings != ["admin"] or self.backups != ["admin"]:
            raise ValueError("Settings and backups are available to administrators only.")
        return self


class SiteSettingsOverrides(BaseModel):
    """The stored values. ``None`` means "inherit from the environment"."""

    model_config = ConfigDict(from_attributes=True)

    site_name: str | None = None
    max_upload_size_mb: int | None = None
    allowed_attachment_types: list[str] | None = None
    sidebar_permissions: SidebarPermissions | None = None


class EffectiveSettings(BaseModel):
    """What the application actually uses: override if set, else the env default."""

    site_name: str
    max_upload_size_mb: int
    max_upload_size_bytes: int
    allowed_attachment_types: list[str]
    sidebar_permissions: SidebarPermissions


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
    max_upload_size_mb: int | None = Field(default=None, ge=1, le=10_240)
    allowed_attachment_types: list[str] | None = Field(default=None, max_length=100)
    sidebar_permissions: SidebarPermissions | None = None

    @field_validator("site_name")
    @classmethod
    def _non_blank(cls, value: str | None) -> str | None:
        # An empty string would render as a nameless instance; treat it as a
        # reset instead, which is what the user almost certainly meant.
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
            if not ext.isalnum():
                raise ValueError(f"'{raw}' is not a valid file extension.")
            if ext not in seen:
                seen.append(ext)
        return seen
