"""User and authentication schemas.

SQLAlchemy models are never returned from the API; these are the only shapes the
outside world sees. ``password_hash`` deliberately has no representation here.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, EmailStr, Field, field_validator

from typing import Literal

from app.models.permission import GlobalPermission
from app.schemas.page import PageRecentItem


class GlobalPermissionOverride(BaseModel):
    """One user-level grant/deny that beats whatever this user's groups say.

    See `UserGlobalPermissionOverride` for the semantics `enabled` carries."""

    model_config = ConfigDict(from_attributes=True)

    permission: GlobalPermission
    enabled: bool


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    #: Plain ``str`` on the way out, ``EmailStr`` on the way in. The bootstrap
    #: administrator legitimately uses an internal address such as
    #: ``admin@wikihub.local``, whose special-use TLD public e-mail validation
    #: rejects - and re-validating a value the database already holds would only
    #: make the account unreadable.
    email: str
    full_name: str
    avatar_url: str | None
    bio: str
    pronouns: str
    profile_url: str
    social_links: list[str] = Field(default_factory=list)
    company: str
    is_active: bool
    is_superuser: bool
    is_protected: bool
    last_login_at: datetime | None
    created_at: datetime
    groups: list[str] = Field(default_factory=list)
    global_permissions: list[GlobalPermission] = Field(default_factory=list)
    #: This user's own overrides, each beating whatever their groups grant for
    #: that one permission - `global_permissions` above already reflects
    #: their effect and is what every authorization check actually reads;
    #: this is only so the admin UI can show *why* (inherited vs overridden)
    #: and let an administrator change just the override.
    global_permission_overrides: list[GlobalPermissionOverride] = Field(default_factory=list)


class PublicUserRead(BaseModel):
    """The collaboration-safe portion of a member profile."""

    model_config = ConfigDict(from_attributes=True)

    username: str
    full_name: str
    avatar_url: str | None
    bio: str
    pronouns: str
    profile_url: str
    social_links: list[str] = Field(default_factory=list)
    company: str
    email: str
    created_at: datetime
    last_active_at: datetime | None = None
    #: Whether this member can administer the workspace. This is safe profile
    #: metadata and avoids presenting administrators as ordinary members.
    is_workspace_admin: bool = False


class UserActivityPage(BaseModel):
    """Cursor-paginated page updates shown on a member profile."""

    items: list[PageRecentItem]
    next_cursor: str | None = None


class UserProfileStats(BaseModel):
    pages_updated: int = 0
    pages_created: int = 0
    spaces_contributed: int = 0


class UserDraftItem(BaseModel):
    id: uuid.UUID
    page_id: uuid.UUID
    title: str
    slug: str
    space_key: str
    space_name: str
    content: str
    updated_at: datetime


class UserPinnedPageItem(BaseModel):
    id: uuid.UUID
    title: str
    slug: str
    space_key: str
    space_name: str
    pinned_at: datetime


class UserPageLabelItem(BaseModel):
    id: uuid.UUID
    name: str
    page_id: uuid.UUID
    title: str
    slug: str
    space_key: str
    space_name: str


class UserTagRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class UserTagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        return value.strip()


class AdminAccountRead(UserRead):
    """One row of the Administrators tab: a `UserRead` plus *why* this account
    currently holds `system_admin` - `is_superuser` trumps everything else,
    so it is checked first even for an account that also has a group or an
    override in play."""

    admin_source: Literal["superuser", "override", "group"]
    #: Username of whoever last granted `superuser`/`override` access, read
    #: off the audit trail - `None` when that predates the audit trail (the
    #: bootstrap admin, a seed script, an import) or simply was never
    #: recorded. Always `None` for a `group` source: group membership and a
    #: group's own permission grants are not audited per member.
    granted_by: str | None = None
    #: Name(s) of the group(s) currently granting `system_admin`, only set
    #: for a `group` source - there is no individual actor to name there.
    granted_via_group: str | None = None


class MeRead(UserRead):
    """``/auth/me`` - the session, not just the account.

    ``impersonator`` is what lets the UI show "you are viewing as X" and offer
    the way back. It is derived from the signed token, so a client cannot make
    the banner disappear by editing state it holds.
    """

    impersonator: UserRead | None = None


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9._-]+$")
    email: EmailStr
    full_name: str = Field(default="", max_length=255)
    password: str = Field(min_length=8, max_length=128)
    is_superuser: bool = False


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None
    is_superuser: bool | None = None
    #: Keyed by permission; `True`/`False` sets that permission's override,
    #: `None` clears it back to "inherit from groups". Only the permissions
    #: present are touched - omit a key to leave its current override alone.
    global_permission_overrides: dict[GlobalPermission, bool | None] | None = None


class SelfProfileUpdate(BaseModel):
    """Fields an account owner may change without admin privileges."""

    # The seeded administrator may use an internal address such as
    # admin@wikihub.local. EmailStr rejects special-use TLDs, so self-service
    # profile updates use a conservative syntax check for this field.
    email: str | None = Field(default=None, max_length=320)
    full_name: str | None = Field(default=None, max_length=255)
    avatar_url: AnyHttpUrl | None = Field(default=None, max_length=2048)
    bio: str | None = Field(default=None, max_length=500)
    pronouns: str | None = Field(default=None, max_length=64)
    profile_url: AnyHttpUrl | None = Field(default=None, max_length=2048)
    social_links: list[AnyHttpUrl] | None = Field(default=None, max_length=2)
    company: str | None = Field(default=None, max_length=255)

    @field_validator("email")
    @classmethod
    def validate_profile_email(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", normalized):
            raise ValueError("Enter a valid email address.")
        return normalized


def validate_password_strength(value: str) -> str:
    if not (re.search(r"[a-z]", value) and re.search(r"[A-Z]", value)):
        raise ValueError("Include an uppercase and lowercase letter.")
    if not re.search(r"[0-9]|[^A-Za-z0-9]", value):
        raise ValueError("Include a number or special character.")
    return value


class PasswordChange(BaseModel):
    """Self-service change: proving the current password is what authorises it."""

    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def validate_new_password_strength(cls, value: str) -> str:
        return validate_password_strength(value)


class PasswordReset(BaseModel):
    """Administrative reset: authorised by the caller's superuser role instead.

    Deliberately has no ``current_password`` - the whole point is recovering an
    account whose password nobody knows.
    """

    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def validate_new_password_strength(cls, value: str) -> str:
        return validate_password_strength(value)


class ImpersonateRequest(BaseModel):
    user_id: uuid.UUID


class LoginRequest(BaseModel):
    #: Username or e-mail address - the form accepts either.
    username: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=1, max_length=128)


class LoginResponse(BaseModel):
    """The access token is also set as an httpOnly cookie.

    It is echoed in the body so non-browser clients (CLI, tests, integrations)
    can use the bearer header without parsing Set-Cookie.
    """

    access_token: str
    token_type: str = "bearer"  # noqa: S105 - a scheme name, not a credential
    expires_at: datetime
    user: UserRead


class SessionRead(BaseModel):
    id: uuid.UUID
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    ip_address: str | None
    user_agent: str | None
    is_current: bool
    is_admin_session: bool
