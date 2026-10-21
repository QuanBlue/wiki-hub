"""The knowledge graph for readers: a page's related pages and a space's page map."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import CurrentUser, DbSession
from app.modules.graph.service import GraphService
from app.modules.pages.service import PageService
from app.modules.spaces.service import SpaceService
from app.schemas.graph import PageRelatedRead, SpaceGraphRead

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
