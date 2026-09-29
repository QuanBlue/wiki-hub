"""Request and response shapes for in-app notifications."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    #: What happened, e.g. ``space_member_added``. The client words it.
    kind: str
    params: dict[str, str]
    link: str | None = None
    #: Who caused it (display name), when a person did.
    actor_name: str | None = None
    created_at: datetime
    read_at: datetime | None = None


class NotificationSummary(BaseModel):
    """What the shell needs on every page: how many are unread, and when the
    newest one arrived (it changes whenever a new one lands)."""

    unread_count: int = 0
    latest_at: datetime | None = None
