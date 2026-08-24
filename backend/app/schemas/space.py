"""Space schemas."""

from __future__ import annotations

import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.space import SpaceRole, SpaceStatus, SpaceVisibility

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
    font_family: str | None = None
    status: SpaceStatus
    visibility: SpaceVisibility
    created_at: datetime
    updated_at: datetime
    created_by_username: str | None = None
    member_count: int = 0
    #: Distinct groups holding an additive permission on this space.
    group_permission_count: int = 0
    #: Distinct non-superuser users holding a direct additive permission on
    #: this space. System administrators are excluded: they already have
    #: full access to every space by default, so listing them here would
    #: make every space look explicitly "licensed" to them.
    direct_user_permission_count: int = 0
    is_favorite: bool = False
    #: The requesting user's role, or ``None`` when they are not a member.
    my_role: SpaceRole | None = None
    my_permissions: list[str] = Field(default_factory=list)


class SpaceCreate(BaseModel):
    key: str = Field(min_length=2, max_length=32)
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=200_000)
    icon: str = Field(default="", max_length=16)
    font_family: str | None = Field(default=None, max_length=50)
    visibility: SpaceVisibility = SpaceVisibility.open

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
    font_family: str | None = Field(default=None, max_length=50)
    status: SpaceStatus | None = None
    visibility: SpaceVisibility | None = None


class SpaceMemberUpsert(BaseModel):
    user_id: uuid.UUID
    role: SpaceRole = SpaceRole.viewer
