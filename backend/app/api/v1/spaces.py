"""Space endpoints."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.api.v1.groups import group_read
from app.models.permission import (
    GlobalPermission,
    Group,
    Permission,
    SpaceGroupPermission,
    SpaceUserPermission,
)
from app.models.user import User
from app.modules.permissions.service import PermissionService
from app.modules.spaces.service import SpaceService
from app.schemas.permission import EffectivePermissionsRead, GroupRead, SpacePermissionRead
from app.schemas.space import (
    SpaceCreate,
    SpaceMemberRead,
    SpaceMemberUpsert,
    SpaceRead,
    SpaceUpdate,
)
from app.schemas.user import UserRead

router = APIRouter(prefix="/spaces", tags=["spaces"])


def get_space_service(session: DbSession) -> SpaceService:
    return SpaceService(session)


SpaceServiceDep = Annotated[SpaceService, Depends(get_space_service)]


@router.get("", response_model=list[SpaceRead], summary="List spaces")
async def list_spaces(
    user: CurrentUser,
    service: SpaceServiceDep,
    include_archived: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[SpaceRead]:
    return await service.list_spaces(
        user, include_archived=include_archived, limit=limit, offset=offset
    )


@router.get("/recent", response_model=list[SpaceRead], summary="Recently updated spaces")
async def list_recent(
    user: CurrentUser,
    service: SpaceServiceDep,
    limit: int = Query(default=20, ge=1, le=50),
) -> list[SpaceRead]:
    return await service.list_recent(user, limit=limit)


@router.get("/favorites", response_model=list[SpaceRead], summary="Your favourite spaces")
async def list_favorites(user: CurrentUser, service: SpaceServiceDep) -> list[SpaceRead]:
    return await service.list_favorites(user)


@router.post(
    "",
    response_model=SpaceRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a space",
)
async def create_space(
    payload: SpaceCreate,
    user: CurrentUser,
    service: SpaceServiceDep,
) -> SpaceRead:
    await PermissionService(service.session).require_global(user, GlobalPermission.create_space)
    space = await service.create(payload, user)
    return await service.to_read(space, user)


# NOTE: declared after /recent and /favorites so those literal paths are not
# swallowed by the {key} parameter.
@router.get("/{key}", response_model=SpaceRead, summary="Get one space")
async def get_space(key: str, user: CurrentUser, service: SpaceServiceDep) -> SpaceRead:
    space = await service.get_by_key(key)
    await service.require_view(space, user)
    return await service.to_read(space, user)


@router.patch("/{key}", response_model=SpaceRead, summary="Update a space")
async def update_space(
    key: str,
    payload: SpaceUpdate,
    user: CurrentUser,
    service: SpaceServiceDep,
) -> SpaceRead:
    space = await service.get_by_key(key)
    await service.update(space, payload, user)
    return await service.to_read(space, user)


@router.post("/{key}/archive", response_model=SpaceRead, summary="Archive a space")
async def archive_space(key: str, user: CurrentUser, service: SpaceServiceDep) -> SpaceRead:
    space = await service.get_by_key(key)
    await service.archive(space, user)
    return await service.to_read(space, user)


@router.post("/{key}/unarchive", response_model=SpaceRead, summary="Restore an archived space")
async def unarchive_space(key: str, user: CurrentUser, service: SpaceServiceDep) -> SpaceRead:
    space = await service.get_by_key(key)
    await service.unarchive(space, user)
    return await service.to_read(space, user)


@router.delete(
    "/{key}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Permanently delete a space",
)
async def delete_space(key: str, user: CurrentUser, service: SpaceServiceDep) -> None:
    space = await service.get_by_key(key)
    await service.delete(space, user)


# -- favourites --------------------------------------------------------------
@router.put(
    "/{key}/favorite",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Add to your favourites",
)
async def add_favorite(key: str, user: CurrentUser, service: SpaceServiceDep) -> None:
    space = await service.get_by_key(key)
    await service.set_favorite(space, user, True)


@router.delete(
    "/{key}/favorite",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove from your favourites",
)
async def remove_favorite(key: str, user: CurrentUser, service: SpaceServiceDep) -> None:
    space = await service.get_by_key(key)
    await service.set_favorite(space, user, False)


# -- membership --------------------------------------------------------------
@router.get("/{key}/members", response_model=list[SpaceMemberRead], summary="List members")
async def list_members(
    key: str, user: CurrentUser, service: SpaceServiceDep
) -> list[SpaceMemberRead]:
    space = await service.get_by_key(key)
    await service.require_view(space, user)
    return await service.list_members(space)


@router.put("/{key}/members", response_model=SpaceMemberRead, summary="Add or update a member")
async def upsert_member(
    key: str,
    payload: SpaceMemberUpsert,
    user: CurrentUser,
    service: SpaceServiceDep,
) -> SpaceMemberRead:
    space = await service.get_by_key(key)
    return await service.set_member(space, user, payload.user_id, payload.role)


@router.delete(
    "/{key}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a member",
)
async def remove_member(
    key: str,
    user_id: uuid.UUID,
    user: CurrentUser,
    service: SpaceServiceDep,
) -> None:
    space = await service.get_by_key(key)
    await service.remove_member(space, user, user_id)


# -- additive permission assignments ----------------------------------------
@router.get("/{key}/permissions", response_model=list[SpacePermissionRead])
async def list_permissions(
    key: str, user: CurrentUser, session: DbSession
) -> list[SpacePermissionRead]:
    space = await SpaceService(session).get_by_key(key)
    await SpaceService(session).require_admin(space, user)
    direct = (
        await session.execute(
            select(SpaceUserPermission, User)
            .join(User, User.id == SpaceUserPermission.user_id)
            .where(SpaceUserPermission.space_id == space.id)
        )
    ).all()
    groups = (
        await session.execute(
            select(SpaceGroupPermission, Group)
            .join(Group, Group.id == SpaceGroupPermission.group_id)
            .where(SpaceGroupPermission.space_id == space.id)
        )
    ).all()
    result: list[SpacePermissionRead] = []
    for row, principal in direct:
        result.append(
            SpacePermissionRead(
                space_id=space.id,
                principal_id=principal.id,
                principal_type="user",
                principal_name=principal.username,
                permissions=[row.permission],
            )
        )
    for row, principal in groups:
        result.append(
            SpacePermissionRead(
                space_id=space.id,
                principal_id=principal.id,
                principal_type="group",
                principal_name=principal.name,
                permissions=[row.permission],
            )
        )
    return result


@router.get("/{key}/permissions/principals/users", response_model=list[UserRead])
async def list_permission_users(
    key: str, user: CurrentUser, session: DbSession
) -> list[UserRead]:
    """List active users that a Space administrator may assign permissions to."""
    space_service = SpaceService(session)
    space = await space_service.get_by_key(key)
    await space_service.require_admin(space, user)
    users = (
        await session.execute(select(User).where(User.is_active.is_(True)).order_by(User.username))
    ).scalars().all()
    return [UserRead.model_validate(item) for item in users]


@router.get("/{key}/permissions/principals/groups", response_model=list[GroupRead])
async def list_permission_groups(
    key: str, user: CurrentUser, session: DbSession
) -> list[GroupRead]:
    """List active groups that a Space administrator may assign."""
    space_service = SpaceService(session)
    space = await space_service.get_by_key(key)
    await space_service.require_admin(space, user)
    groups = (
        await session.execute(select(Group).where(Group.is_active.is_(True)).order_by(Group.name))
    ).scalars().all()
    return [await group_read(session, group) for group in groups]


@router.get("/{key}/permissions/effective/{user_id}", response_model=EffectivePermissionsRead)
async def effective_permissions(
    key: str, user_id: uuid.UUID, actor: CurrentUser, session: DbSession
) -> EffectivePermissionsRead:
    space = await SpaceService(session).get_by_key(key)
    await SpaceService(session).require_admin(space, actor)
    target = await session.get(User, user_id)
    if target is None:
        from app.core.exceptions import NotFoundError

        raise NotFoundError("User not found.")
    permissions = await PermissionService(session).effective_permissions(space, target)
    return EffectivePermissionsRead(
        space_id=space.id,
        permissions=sorted(permissions, key=lambda item: item.value),
        visibility=space.visibility,
    )


@router.put(
    "/{key}/permissions/users/{user_id}/{permission}", status_code=status.HTTP_204_NO_CONTENT
)
async def grant_user_permission(
    key: str, user_id: uuid.UUID, permission: Permission, user: CurrentUser, session: DbSession
) -> None:
    space = await SpaceService(session).get_by_key(key)
    await PermissionService(session).set_space_permission(
        space, user_id, permission, user, group=False, present=True
    )


@router.delete(
    "/{key}/permissions/users/{user_id}/{permission}", status_code=status.HTTP_204_NO_CONTENT
)
async def revoke_user_permission(
    key: str, user_id: uuid.UUID, permission: Permission, user: CurrentUser, session: DbSession
) -> None:
    space = await SpaceService(session).get_by_key(key)
    await PermissionService(session).set_space_permission(
        space, user_id, permission, user, group=False, present=False
    )


@router.put(
    "/{key}/permissions/groups/{group_id}/{permission}", status_code=status.HTTP_204_NO_CONTENT
)
async def grant_group_permission(
    key: str, group_id: uuid.UUID, permission: Permission, user: CurrentUser, session: DbSession
) -> None:
    space = await SpaceService(session).get_by_key(key)
    await PermissionService(session).set_space_permission(
        space, group_id, permission, user, group=True, present=True
    )


@router.delete(
    "/{key}/permissions/groups/{group_id}/{permission}", status_code=status.HTTP_204_NO_CONTENT
)
async def revoke_group_permission(
    key: str, group_id: uuid.UUID, permission: Permission, user: CurrentUser, session: DbSession
) -> None:
    space = await SpaceService(session).get_by_key(key)
    await PermissionService(session).set_space_permission(
        space, group_id, permission, user, group=True, present=False
    )
