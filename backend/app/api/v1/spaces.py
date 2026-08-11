"""Space endpoints."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import CurrentUser, DbSession
from app.modules.spaces.service import SpaceService
from app.schemas.space import (
    SpaceCreate,
    SpaceMemberRead,
    SpaceMemberUpsert,
    SpaceRead,
    SpaceUpdate,
)

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
    space = await service.create(payload, user)
    return await service.to_read(space, user)


# NOTE: declared after /recent and /favorites so those literal paths are not
# swallowed by the {key} parameter.
@router.get("/{key}", response_model=SpaceRead, summary="Get one space")
async def get_space(key: str, user: CurrentUser, service: SpaceServiceDep) -> SpaceRead:
    space = await service.get_by_key(key)
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
    key: str, _user: CurrentUser, service: SpaceServiceDep
) -> list[SpaceMemberRead]:
    space = await service.get_by_key(key)
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
