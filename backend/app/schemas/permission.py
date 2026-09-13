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


class PageRestrictionUserOption(BaseModel):
    """One row of the page-restriction picker's user search. Every active
    user is listed - not just ones the space already grants access to - so
    typing a name never looks like the person doesn't exist; `has_space_access`
    is what the picker uses to grey a row out and explain why, instead of
    hiding it outright."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    full_name: str
    has_space_access: bool


class PageRestrictionGroupOption(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    has_space_access: bool


class PageViewModeUpdate(BaseModel):
    restricted: bool


class PageAccessRosterUser(BaseModel):
    """One row of the Open-page access roster: a user with space access,
    their current View/Edit state on this specific page pre-reflected
    (checked, not blank), and whether each box is locked (see
    `PermissionService.list_page_access_roster_users`) - `view_locked` is
    only ever true for a space Admin, since blocking one would have no
    effect; `edit_locked` is also true for anyone whose space role simply
    doesn't include editing."""

    id: uuid.UUID
    username: str
    full_name: str
    view: bool
    edit: bool
    view_locked: bool
    edit_locked: bool


class PageAccessRosterGroup(BaseModel):
    id: uuid.UUID
    name: str
    view: bool
    edit: bool
    view_locked: bool
    edit_locked: bool
