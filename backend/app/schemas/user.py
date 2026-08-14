"""User and authentication schemas.

SQLAlchemy models are never returned from the API; these are the only shapes the
outside world sees. ``password_hash`` deliberately has no representation here.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, EmailStr, Field

from app.models.permission import GlobalPermission


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
    is_active: bool
    is_superuser: bool
    is_protected: bool
    last_login_at: datetime | None
    created_at: datetime
    groups: list[str] = Field(default_factory=list)
    global_permissions: list[GlobalPermission] = Field(default_factory=list)


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


class SelfProfileUpdate(BaseModel):
    """Fields an account owner may change without admin privileges."""

    email: EmailStr | None = None
    full_name: str | None = Field(default=None, max_length=255)
    avatar_url: AnyHttpUrl | None = Field(default=None, max_length=2048)


class PasswordChange(BaseModel):
    """Self-service change: proving the current password is what authorises it."""

    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class PasswordReset(BaseModel):
    """Administrative reset: authorised by the caller's superuser role instead.

    Deliberately has no ``current_password`` - the whole point is recovering an
    account whose password nobody knows.
    """

    new_password: str = Field(min_length=8, max_length=128)


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
