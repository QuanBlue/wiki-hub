"""Page revision API endpoints for history tracking, visual diff, and version restoration."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import CurrentUser, DbSession
from app.modules.pages.service import PageService
from app.modules.spaces.service import SpaceService
from app.schemas.page import PageRead
from app.schemas.revision import PageRevisionDiffRead, PageRevisionRead

router = APIRouter(prefix="/spaces/{key}/pages/{slug}/revisions", tags=["revisions"])


def get_page_service(session: DbSession) -> PageService:
    return PageService(session)


def get_space_service(session: DbSession) -> SpaceService:
    return SpaceService(session)


PageServiceDep = Annotated[PageService, Depends(get_page_service)]
SpaceServiceDep = Annotated[SpaceService, Depends(get_space_service)]


@router.get("", response_model=list[PageRevisionRead], summary="List revision history for a page")
async def list_revisions(
    key: str,
    slug: str,
    _user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> list[PageRevisionRead]:
    space = await space_service.get_by_key(key)
    await space_service.require_view(space, _user)
    page = await page_service.get_by_slug(space, slug)
    await page_service.require_page_view(page, _user)
    return await page_service.list_revisions(page)


@router.get(
    "/diff", response_model=PageRevisionDiffRead, summary="Calculate visual diff between revisions"
)
async def get_revision_diff(
    key: str,
    slug: str,
    _user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
    from_version: int | None = Query(default=None, ge=1),
    to_version: int | None = Query(default=None, ge=1),
) -> PageRevisionDiffRead:
    space = await space_service.get_by_key(key)
    await space_service.require_view(space, _user)
    page = await page_service.get_by_slug(space, slug)
    await page_service.require_page_view(page, _user)
    return await page_service.calculate_diff(page, from_version=from_version, to_version=to_version)


@router.get("/{version}", response_model=PageRevisionRead, summary="Get a specific page revision")
async def get_revision(
    key: str,
    slug: str,
    version: int,
    _user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> PageRevisionRead:
    space = await space_service.get_by_key(key)
    await space_service.require_view(space, _user)
    page = await page_service.get_by_slug(space, slug)
    await page_service.require_page_view(page, _user)
    return await page_service.get_revision(page, version)


@router.post(
    "/{version}/restore",
    response_model=PageRead,
    summary="Restore page content to a specific version",
)
async def restore_revision(
    key: str,
    slug: str,
    version: int,
    user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> PageRead:
    space = await space_service.get_by_key(key)
    page = await page_service.get_by_slug(space, slug)
    restored = await page_service.restore_revision(space, page, version, user)
    return await page_service.to_read_for_user(restored, user)
