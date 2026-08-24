"""Group and permission API schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.permission import GlobalPermission, Permission
from app.models.restriction import PageRestrictionPermission
from app.models.space import SpaceVisibility


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=10_000)
    owner_id: uuid.UUID


class GroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=10_000)
    owner_id: uuid.UUID | None = None
    owner_ids: list[uuid.UUID] | None = None
    is_active: bool | None = None


class GroupRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    owner_id: uuid.UUID
    owner_username: str | None = None
    owner_ids: list[uuid.UUID] = Field(default_factory=list)
    is_active: bool
    member_count: int = 0
    created_at: datetime
    updated_at: datetime
    global_permissions: list[GlobalPermission] = Field(default_factory=list)


class GroupMemberRead(BaseModel):
    user_id: uuid.UUID
    username: str
    full_name: str
    email: str


class GroupMemberUpsert(BaseModel):
    user_id: uuid.UUID


class GlobalPermissionUpsert(BaseModel):
    permission: GlobalPermission


class SpacePermissionUpsert(BaseModel):
    permission: Permission


class SpacePermissionRead(BaseModel):
    space_id: uuid.UUID
    principal_id: uuid.UUID
    principal_type: str
    principal_name: str
    permissions: list[Permission]


class EffectivePermissionsRead(BaseModel):
    space_id: uuid.UUID
    permissions: list[Permission]
    visibility: SpaceVisibility


class PageRestrictionRead(BaseModel):
    page_id: uuid.UUID
    principal_id: uuid.UUID
    principal_type: str
    principal_name: str
    permission: PageRestrictionPermission


class PageRestrictionUpsert(BaseModel):
    permission: PageRestrictionPermission
