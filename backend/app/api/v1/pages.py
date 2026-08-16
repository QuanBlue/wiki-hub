"""Page endpoints nested under spaces."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.api.v1.groups import group_read
from app.models.permission import Group, Permission
from app.models.restriction import PageRestrictionPermission
from app.models.user import User
from app.modules.pages.pdf_export import render_page_pdf
from app.modules.pages.service import PageService
from app.modules.spaces.service import SpaceService
from app.schemas.draft import PageDraftRead, PageDraftUpsert
from app.schemas.page import (
    PageCreate,
    PageLikeRead,
    PageMove,
    PageRead,
    PageRecentItem,
    PageUpdate,
)
from app.schemas.permission import GroupRead, PageRestrictionRead
from app.schemas.user import UserRead

router = APIRouter(prefix="/spaces/{key}/pages", tags=["pages"])
standalone_router = APIRouter(prefix="/pages", tags=["pages"])


def get_page_service(session: DbSession) -> PageService:
    return PageService(session)


def get_space_service(session: DbSession) -> SpaceService:
    return SpaceService(session)


PageServiceDep = Annotated[PageService, Depends(get_page_service)]
SpaceServiceDep = Annotated[SpaceService, Depends(get_space_service)]


@router.get("", response_model=list[PageRead], summary="List pages in a space")
async def list_pages(
    key: str,
    _user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
    limit: int = Query(default=10000, ge=1, le=10000),
    offset: int = Query(default=0, ge=0),
) -> list[PageRead]:
    space = await space_service.get_by_key(key)
    await space_service.require_view(space, _user)
    return await page_service.list_for_space(space, _user, limit=limit, offset=offset)


@router.post(
    "",
    response_model=PageRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a page in a space",
)
async def create_page(
    key: str,
    payload: PageCreate,
    user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> PageRead:
    space = await space_service.get_by_key(key)
    page = await page_service.create(space, payload, user)
    return await page_service.to_read_for_user(page, user)


@router.post("/{slug}/move", response_model=PageRead, summary="Move a page and its children")
async def move_page(
    key: str,
    slug: str,
    payload: PageMove,
    user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> PageRead:
    space = await space_service.get_by_key(key)
    await space_service.require_view(space, user)
    page = await page_service.get_by_slug(space, slug)
    moved = await page_service.move(space, page, payload, user)
    return await page_service.to_read_for_user(moved, user)


@router.get("/{slug}/export/pdf", response_class=Response, summary="Download a page as PDF")
async def export_page_pdf(
    key: str,
    slug: str,
    _user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> Response:
    space = await space_service.get_by_key(key)
    await space_service.require_view(space, _user)
    page = await page_service.get_by_slug(space, slug)
    await page_service.require_page_view(page, _user)
    await space_service.permissions.require(space, _user, Permission.export)
    return Response(
        content=render_page_pdf(page),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{page.slug or "page"}.pdf"'},
    )


@router.get("/{slug}", response_model=PageRead, summary="Get one page")
async def get_page(
    key: str,
    slug: str,
    _user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> PageRead:
    space = await space_service.get_by_key(key)
    await space_service.require_view(space, _user)
    page = await page_service.get_by_slug(space, slug)
    await page_service.require_page_view(page, _user)
    return await page_service.to_read_for_user(page, _user)


@router.get("/{slug}/like", response_model=PageLikeRead, summary="Get page like status")
async def get_page_like(
    key: str,
    slug: str,
    user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> PageLikeRead:
    space = await space_service.get_by_key(key)
    await space_service.require_view(space, user)
    page = await page_service.get_by_slug(space, slug)
    await page_service.require_page_view(page, user)
    return await page_service.like_status(page, user)


@router.put("/{slug}/like", response_model=PageLikeRead, summary="Like a page")
async def like_page(
    key: str,
    slug: str,
    user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> PageLikeRead:
    space = await space_service.get_by_key(key)
    await space_service.require_view(space, user)
    page = await page_service.get_by_slug(space, slug)
    await page_service.require_page_view(page, user)
    return await page_service.set_like(page, user, True)


@router.delete("/{slug}/like", response_model=PageLikeRead, summary="Remove page like")
async def unlike_page(
    key: str,
    slug: str,
    user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> PageLikeRead:
    space = await space_service.get_by_key(key)
    await space_service.require_view(space, user)
    page = await page_service.get_by_slug(space, slug)
    await page_service.require_page_view(page, user)
    return await page_service.set_like(page, user, False)


@router.patch("/{slug}", response_model=PageRead, summary="Update a page")
async def update_page(
    key: str,
    slug: str,
    payload: PageUpdate,
    user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> PageRead:
    space = await space_service.get_by_key(key)
    page = await page_service.get_by_slug(space, slug)
    updated = await page_service.update(space, page, payload, user)
    return await page_service.to_read_for_user(updated, user)


@router.get(
    "/{slug}/draft",
    response_model=PageDraftRead | None,
    summary="Get the current user's page draft",
)
async def get_page_draft(
    key: str,
    slug: str,
    user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> PageDraftRead | None:
    space = await space_service.get_by_key(key)
    page = await page_service.get_by_slug(space, slug)
    return await page_service.get_draft(page, user)


@router.put(
    "/{slug}/draft", response_model=PageDraftRead, summary="Save the current user's page draft"
)
async def save_page_draft(
    key: str,
    slug: str,
    payload: PageDraftUpsert,
    user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> PageDraftRead:
    space = await space_service.get_by_key(key)
    page = await page_service.get_by_slug(space, slug)
    return await page_service.save_draft(page, user, payload)


@router.delete(
    "/{slug}/draft",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Discard the current user's page draft",
)
async def delete_page_draft(
    key: str,
    slug: str,
    user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> None:
    space = await space_service.get_by_key(key)
    page = await page_service.get_by_slug(space, slug)
    await page_service.discard_draft(page, user)


@router.delete(
    "/{slug}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a page and move its child pages up one level",
)
async def delete_page(
    key: str,
    slug: str,
    user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> None:
    space = await space_service.get_by_key(key)
    page = await page_service.get_by_slug(space, slug)
    await page_service.delete(space, page, user)


@router.get(
    "/{slug}/restrictions",
    response_model=list[PageRestrictionRead],
    summary="List page restrictions",
)
async def list_page_restrictions(
    key: str,
    slug: str,
    user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> list[PageRestrictionRead]:
    space = await space_service.get_by_key(key)
    page = await page_service.get_by_slug(space, slug)
    rows = await space_service.permissions.list_page_restrictions(page, user)
    return [PageRestrictionRead.model_validate(row) for row in rows]


@router.get(
    "/{slug}/restrictions/principals/users",
    response_model=list[UserRead],
    summary="List users available for page restrictions",
)
async def list_page_restriction_users(
    key: str,
    slug: str,
    user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
    session: DbSession,
) -> list[UserRead]:
    space = await space_service.get_by_key(key)
    page = await page_service.get_by_slug(space, slug)
    await space_service.permissions.require_page_restriction_admin(page, user)
    users = (
        (
            await session.execute(
                select(User).where(User.is_active.is_(True)).order_by(User.username)
            )
        )
        .scalars()
        .all()
    )
    return [UserRead.model_validate(item) for item in users]


@router.get(
    "/{slug}/restrictions/principals/groups",
    response_model=list[GroupRead],
    summary="List groups available for page restrictions",
)
async def list_page_restriction_groups(
    key: str,
    slug: str,
    user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
    session: DbSession,
) -> list[GroupRead]:
    space = await space_service.get_by_key(key)
    page = await page_service.get_by_slug(space, slug)
    await space_service.permissions.require_page_restriction_admin(page, user)
    groups = (
        (await session.execute(select(Group).where(Group.is_active.is_(True)).order_by(Group.name)))
        .scalars()
        .all()
    )
    return [await group_read(session, group) for group in groups]


@router.put(
    "/{slug}/restrictions/users/{user_id}/{permission}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Grant a user a page restriction permission",
)
async def grant_user_page_restriction(
    key: str,
    slug: str,
    user_id: uuid.UUID,
    permission: PageRestrictionPermission,
    actor: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> None:
    page = await page_service.get_by_slug(await space_service.get_by_key(key), slug)
    await space_service.permissions.set_page_restriction(
        page, user_id, permission, actor, group=False, present=True
    )


@router.delete(
    "/{slug}/restrictions/users/{user_id}/{permission}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke a user page restriction permission",
)
async def revoke_user_page_restriction(
    key: str,
    slug: str,
    user_id: uuid.UUID,
    permission: PageRestrictionPermission,
    actor: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> None:
    page = await page_service.get_by_slug(await space_service.get_by_key(key), slug)
    await space_service.permissions.set_page_restriction(
        page, user_id, permission, actor, group=False, present=False
    )


@router.put(
    "/{slug}/restrictions/groups/{group_id}/{permission}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Grant a group a page restriction permission",
)
async def grant_group_page_restriction(
    key: str,
    slug: str,
    group_id: uuid.UUID,
    permission: PageRestrictionPermission,
    actor: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> None:
    page = await page_service.get_by_slug(await space_service.get_by_key(key), slug)
    await space_service.permissions.set_page_restriction(
        page, group_id, permission, actor, group=True, present=True
    )


@router.delete(
    "/{slug}/restrictions/groups/{group_id}/{permission}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke a group page restriction permission",
)
async def revoke_group_page_restriction(
    key: str,
    slug: str,
    group_id: uuid.UUID,
    permission: PageRestrictionPermission,
    actor: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> None:
    page = await page_service.get_by_slug(await space_service.get_by_key(key), slug)
    await space_service.permissions.set_page_restriction(
        page, group_id, permission, actor, group=True, present=False
    )


@standalone_router.get(
    "/recent",
    response_model=list[PageRecentItem],
    summary="Recently updated pages across all active spaces",
)
async def list_recent_pages_global(
    _user: CurrentUser,
    page_service: PageServiceDep,
    limit: int = Query(default=50, ge=1, le=100),
) -> list[PageRecentItem]:
    return await page_service.list_recent_pages(_user, limit=limit)
