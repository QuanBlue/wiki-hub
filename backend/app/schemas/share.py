"""Sharing a page with people from its Share menu."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

MAX_RECIPIENTS = 20


class ShareCreate(BaseModel):
    """Usernames to share the page with, as the share picker returns them."""

    recipients: list[str] = Field(min_length=1, max_length=MAX_RECIPIENTS)


class ShareSummary(BaseModel):
    share_count: int


class ShareResult(ShareSummary):
    """What a share did: who was told, and who was left out and why."""

    #: Told, and counted.
    shared: list[str]
    #: Cannot open the page (restricted space or page) - not told, not counted.
    no_access: list[str]
    #: Unknown, deactivated, or the sharer themselves.
    not_found: list[str]


class PublicShareCreate(BaseModel):
    """Options when creating a public read-only share link."""

    expires_in_days: int | None = Field(default=None, ge=1, le=365)
    password: str | None = Field(default=None, max_length=128)


class PublicShareUpdate(BaseModel):
    """Options when updating an existing public read-only share link."""

    expires_in_days: int | None = Field(default=None, ge=1, le=365)
    clear_expiration: bool = False
    password: str | None = Field(default=None, max_length=128)
    clear_password: bool = False


class PublicShareItem(BaseModel):
    """A public share link record returned to authorized page editors/viewers."""

    id: uuid.UUID
    token: str
    page_id: uuid.UUID
    created_at: datetime
    expires_at: datetime | None
    has_password: bool
    view_count: int
    is_active: bool
    is_expired: bool
    share_url: str | None = None


class PublicShareListResponse(BaseModel):
    """List of active public links and whether public sharing is enabled."""

    enabled: bool
    shares: list[PublicShareItem]


class PublicShareVerifyRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class PublicShareView(BaseModel):
    """Read-only view of a page accessed via a public share link."""

    title: str
    content_html: str
    space_key: str
    space_name: str
    created_at: datetime
    updated_at: datetime
    expires_at: datetime | None
    has_password: bool
    is_password_verified: bool
    view_count: int

