"""The knowledge graph for readers - a page's related pages, a space's page map - and the
space's content health report for its administrators."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import CurrentUser, DbSession
from app.modules.ai.service import AIService
from app.modules.graph.health import RECENT_DAYS, STALE_DAYS, ContentHealthService
from app.modules.graph.service import GraphService
from app.modules.pages.service import PageService
from app.modules.spaces.service import SpaceService
from app.schemas.graph import (
    PageRelatedRead,
    PageReviewRead,
    SpaceGraphRead,
    SpaceHealthRead,
    StaleCheckRead,
    StaleCheckRequest,
)

router = APIRouter(prefix="/spaces/{key}", tags=["graph"])
#: Maps across spaces.
global_router = APIRouter(tags=["graph"])

#: The kinds of tie a map may be asked for, comma-separated.
KINDS_PATTERN = r"^(link|mention|similar|tree)(,(link|mention|similar|tree))*$"


def get_graph_service(session: DbSession) -> GraphService:
    return GraphService(session)


def get_page_service(session: DbSession) -> PageService:
    return PageService(session)


def get_space_service(session: DbSession) -> SpaceService:
    return SpaceService(session)


GraphServiceDep = Annotated[GraphService, Depends(get_graph_service)]
PageServiceDep = Annotated[PageService, Depends(get_page_service)]
SpaceServiceDep = Annotated[SpaceService, Depends(get_space_service)]


@router.get(
    "/pages/{slug}/related",
    response_model=PageRelatedRead,
    summary="Pages related to a page, and the pages it names",
)
async def page_related(
    key: str,
    slug: str,
    user: CurrentUser,
    graph: GraphServiceDep,
    pages: PageServiceDep,
    spaces: SpaceServiceDep,
) -> PageRelatedRead:
    space = await spaces.get_by_key(key)
    await spaces.require_view(space, user)
    page = await pages.get_by_slug(space, slug)
    await pages.require_page_view(page, user)
    return await graph.related_for_page(page, user)


@router.get("/graph", response_model=SpaceGraphRead, summary="The space's page map")
async def space_graph(
    key: str,
    user: CurrentUser,
    graph: GraphServiceDep,
    spaces: SpaceServiceDep,
    kinds: Annotated[
        str | None,
        Query(
            description="Comma-separated kinds of tie to return: link, mention, similar, tree.",
            pattern=KINDS_PATTERN,
        ),
    ] = None,
) -> SpaceGraphRead:
    space = await spaces.get_by_key(key)
    await spaces.require_view(space, user)
    return await graph.space_map(space, user, kinds=set(kinds.split(",")) if kinds else None)


@global_router.get(
    "/graph",
    response_model=SpaceGraphRead,
    summary="The page map of every space the reader may open, ties between spaces included",
)
async def all_spaces_graph(
    user: CurrentUser,
    graph: GraphServiceDep,
    spaces: SpaceServiceDep,
    space_keys: Annotated[
        str | None,
        Query(
            alias="spaces",
            max_length=2000,
            description="Comma-separated space keys to keep; all the reader may open if left out.",
        ),
    ] = None,
    kinds: Annotated[
        str | None,
        Query(
            description="Comma-separated kinds of tie to return: link, mention, similar, tree.",
            pattern=KINDS_PATTERN,
        ),
    ] = None,
) -> SpaceGraphRead:
    listed = await spaces.list_space_models(user)
    if space_keys:
        wanted = {key.strip().upper() for key in space_keys.split(",") if key.strip()}
        listed = [space for space in listed if space.key.upper() in wanted]
    return await graph.map_for(listed, user, kinds=set(kinds.split(",")) if kinds else None)


@router.get(
    "/health",
    response_model=SpaceHealthRead,
    summary="The space's content health: stale pages, broken links, orphans and duplicates",
)
async def space_health(
    key: str,
    user: CurrentUser,
    session: DbSession,
    spaces: SpaceServiceDep,
    stale_days: Annotated[int, Query(ge=30, le=3650)] = STALE_DAYS,
    recent_days: Annotated[int, Query(ge=1, le=3650)] = RECENT_DAYS,
) -> SpaceHealthRead:
    space = await spaces.get_by_key(key)
    await spaces.require_admin(space, user)
    return await ContentHealthService(session).report(
        space, user, stale_days=stale_days, recent_days=recent_days
    )


@router.post(
    "/pages/{slug}/review",
    response_model=PageReviewRead,
    summary="Mark a page still correct, so the health report stops flagging it as stale",
)
async def review_page(
    key: str,
    slug: str,
    user: CurrentUser,
    session: DbSession,
    pages: PageServiceDep,
    spaces: SpaceServiceDep,
) -> PageReviewRead:
    space = await spaces.get_by_key(key)
    await spaces.require_admin(space, user)
    page = await pages.get_by_slug(space, slug)
    await pages.require_page_view(page, user)
    reviewed_at = await ContentHealthService(session).mark_reviewed(page, user)
    return PageReviewRead(reviewed_at=reviewed_at)


@router.post(
    "/pages/{slug}/stale-check",
    response_model=StaleCheckRead,
    summary="Ask the AI what in a page the newer pages tied to it contradict or replace",
)
async def stale_check(
    key: str,
    slug: str,
    payload: StaleCheckRequest,
    user: CurrentUser,
    session: DbSession,
) -> StaleCheckRead:
    return await AIService(session, user).check_stale(key, slug, payload.locale)
