"""Page endpoints nested under spaces."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import CurrentUser, DbSession
from app.modules.pages.service import PageService
from app.modules.pages.pdf_export import render_page_pdf
from app.modules.spaces.service import SpaceService
from app.schemas.page import PageCreate, PageLikeRead, PageMove, PageRead, PageUpdate

router = APIRouter(prefix="/spaces/{key}/pages", tags=["pages"])


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
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[PageRead]:
    space = await space_service.get_by_key(key)
    return await page_service.list_for_space(space, limit=limit, offset=offset)


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
    return page_service.to_read(page)


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
    page = await page_service.get_by_slug(space, slug)
    moved = await page_service.move(space, page, payload, user)
    return page_service.to_read(moved)


@router.get("/{slug}/export/pdf", response_class=Response, summary="Download a page as PDF")
async def export_page_pdf(
    key: str,
    slug: str,
    _user: CurrentUser,
    page_service: PageServiceDep,
    space_service: SpaceServiceDep,
) -> Response:
    space = await space_service.get_by_key(key)
    page = await page_service.get_by_slug(space, slug)
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
    page = await page_service.get_by_slug(space, slug)
    return page_service.to_read(page)


@router.get("/{slug}/like", response_model=PageLikeRead, summary="Get page like status")
async def get_page_like(
    key: str, slug: str, user: CurrentUser, page_service: PageServiceDep, space_service: SpaceServiceDep
) -> PageLikeRead:
    space = await space_service.get_by_key(key)
    page = await page_service.get_by_slug(space, slug)
    return await page_service.like_status(page, user)


@router.put("/{slug}/like", response_model=PageLikeRead, summary="Like a page")
async def like_page(
    key: str, slug: str, user: CurrentUser, page_service: PageServiceDep, space_service: SpaceServiceDep
) -> PageLikeRead:
    space = await space_service.get_by_key(key)
    page = await page_service.get_by_slug(space, slug)
    return await page_service.set_like(page, user, True)


@router.delete("/{slug}/like", response_model=PageLikeRead, summary="Remove page like")
async def unlike_page(
    key: str, slug: str, user: CurrentUser, page_service: PageServiceDep, space_service: SpaceServiceDep
) -> PageLikeRead:
    space = await space_service.get_by_key(key)
    page = await page_service.get_by_slug(space, slug)
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
    return page_service.to_read(updated)


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
