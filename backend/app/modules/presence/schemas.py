from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class PresenceUser(BaseModel):
    user_id: uuid.UUID
    username: str
    full_name: str
    avatar_url: str | None = None
    state: Literal["viewing", "editing"] = "viewing"
    last_seen: datetime


class PresenceHeartbeatRequest(BaseModel):
    editing: bool = False


class PresenceHeartbeatResponse(BaseModel):
    users: list[PresenceUser]
    page_updated_at: datetime
