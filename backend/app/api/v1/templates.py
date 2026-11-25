"""Page template API endpoints (global, per-space, built-in, and save-page-as-template)."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import ClientInfoDep, CurrentUser, DbSession, Impersonator
from app.core.exceptions import NotFoundError
from app.models.page import WikiPage
from app.modules.spaces.service import SpaceService
from app.modules.templates.service import PageTemplateService
from app.schemas.page_template import (
    PageTemplateCreate,
    PageTemplateRead,
    PageTemplateUpdate,
    SavePageAsTemplateRequest,
    TemplateLang,
)

router = APIRouter(prefix="/templates", tags=["templates"])
space_router = APIRouter(prefix="/spaces/{space_key}/templates", tags=["templates"])
page_router = APIRouter(prefix="/spaces/{space_key}/pages", tags=["templates"])


def get_template_service(
    session: DbSession,
    client: ClientInfoDep,
    impersonator: Impersonator,
) -> PageTemplateService:
    return PageTemplateService(session, client=client, impersonator=impersonator)


def get_space_service(session: DbSession) -> SpaceService:
    return SpaceService(session)


TemplateServiceDep = Annotated[PageTemplateService, Depends(get_template_service)]
SpaceServiceDep = Annotated[SpaceService, Depends(get_space_service)]


@router.get("", response_model=list[PageTemplateRead], summary="List global and built-in templates")
async def list_global_templates(
    _user: CurrentUser,
    service: TemplateServiceDep,
    scope: Literal["all", "global", "builtin"] | None = Query(default=None),
    lang: TemplateLang = Query(default="en"),
) -> list[PageTemplateRead]:
    return await service.list_global(lang=lang, scope=scope)


@router.get("/{template_id}", response_model=PageTemplateRead, summary="Get a single template")
async def get_template(
    template_id: str,
    user: CurrentUser,
    service: TemplateServiceDep,
    lang: TemplateLang = Query(default="en"),
) -> PageTemplateRead:
    return await service.get_template(template_id, user, lang=lang)


@router.post(
    "",
    response_model=PageTemplateRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a global template",
)
async def create_global_template(
    payload: PageTemplateCreate,
    user: CurrentUser,
    service: TemplateServiceDep,
) -> PageTemplateRead:
    return await service.create_global(payload, user)


@router.patch(
    "/{template_id}",
    response_model=PageTemplateRead,
    summary="Update a global template",
)
async def update_global_template(
    template_id: uuid.UUID,
    payload: PageTemplateUpdate,
    user: CurrentUser,
    service: TemplateServiceDep,
) -> PageTemplateRead:
    return await service.update_global(template_id, payload, user)


@router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a global template",
)
async def delete_global_template(
    template_id: uuid.UUID,
    user: CurrentUser,
    service: TemplateServiceDep,
) -> None:
    await service.delete_global(template_id, user)


@space_router.get(
    "",
    response_model=list[PageTemplateRead],
    summary="List built-in, global, and space templates for a space",
)
async def list_space_templates(
    space_key: str,
    user: CurrentUser,
    service: TemplateServiceDep,
    space_service: SpaceServiceDep,
    lang: TemplateLang = Query(default="en"),
) -> list[PageTemplateRead]:
    space = await space_service.get_by_key(space_key)
    return await service.list_for_space(space, user, lang=lang)


@space_router.post(
    "",
    response_model=PageTemplateRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a space template",
)
async def create_space_template(
    space_key: str,
    payload: PageTemplateCreate,
    user: CurrentUser,
    service: TemplateServiceDep,
    space_service: SpaceServiceDep,
) -> PageTemplateRead:
    space = await space_service.get_by_key(space_key)
    return await service.create_for_space(space, payload, user)


@space_router.patch(
    "/{template_id}",
    response_model=PageTemplateRead,
    summary="Update a space template",
)
async def update_space_template(
    space_key: str,
    template_id: uuid.UUID,
    payload: PageTemplateUpdate,
    user: CurrentUser,
    service: TemplateServiceDep,
    space_service: SpaceServiceDep,
) -> PageTemplateRead:
    space = await space_service.get_by_key(space_key)
    return await service.update_for_space(space, template_id, payload, user)


@space_router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a space template",
)
async def delete_space_template(
    space_key: str,
    template_id: uuid.UUID,
    user: CurrentUser,
    service: TemplateServiceDep,
    space_service: SpaceServiceDep,
) -> None:
    space = await space_service.get_by_key(space_key)
    await service.delete_for_space(space, template_id, user)


@page_router.post(
    "/{page_id}/save-as-template",
    response_model=PageTemplateRead,
    status_code=status.HTTP_201_CREATED,
    summary="Save an existing page as a reusable template",
)
async def save_page_as_template(
    space_key: str,
    page_id: uuid.UUID,
    payload: SavePageAsTemplateRequest,
    user: CurrentUser,
    service: TemplateServiceDep,
    space_service: SpaceServiceDep,
    session: DbSession,
) -> PageTemplateRead:
    space = await space_service.get_by_key(space_key)
    page = await session.get(WikiPage, page_id)
    if page is None or page.space_id != space.id:
        raise NotFoundError("Page not found.")
    return await service.save_page_as_template(space, page, payload, user)
