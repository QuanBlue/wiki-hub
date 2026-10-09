"""Sharing a page with people from its Share menu."""

from __future__ import annotations

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
