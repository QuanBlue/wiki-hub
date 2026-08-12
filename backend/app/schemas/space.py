"""Space schemas."""

from __future__ import annotations

import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.space import SpaceRole, SpaceStatus

#: Space keys appear in URLs and must stay stable, so they are restricted to a
#: conservative character set and normalised to upper case.
KEY_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{1,31}$")


class SpaceMemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    username: str
    full_name: str
    role: SpaceRole


class SpaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    key: str
    name: str
    description: str
    icon: str
    status: SpaceStatus
    created_at: datetime
    updated_at: datetime
    created_by_username: str | None = None
    member_count: int = 0
    is_favorite: bool = False
    #: The requesting user's role, or ``None`` when they are not a member.
    my_role: SpaceRole | None = None


class SpaceCreate(BaseModel):
    key: str = Field(min_length=2, max_length=32)
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=200_000)
    icon: str = Field(default="", max_length=16)

    @field_validator("key")
    @classmethod
    def _normalise_key(cls, value: str) -> str:
        key = value.strip().upper().replace("-", "_").replace(" ", "_")
        if not KEY_PATTERN.match(key):
            raise ValueError(
                "Key must start with a letter and contain only letters, digits "
                "and underscores (2-32 characters)."
            )
        return key


class SpaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=200_000)
    icon: str | None = Field(default=None, max_length=16)
    status: SpaceStatus | None = None


class SpaceMemberUpsert(BaseModel):
    user_id: uuid.UUID
    role: SpaceRole = SpaceRole.viewer
