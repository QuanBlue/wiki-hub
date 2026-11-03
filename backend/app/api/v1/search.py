"""Search endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict

from app.api.deps import CurrentUser, DbSession
from app.modules.search.filters import parse_date_spec, parse_search_query
from app.modules.search.service import SearchResults, SearchService

router = APIRouter(prefix="/search", tags=["search"])


def get_search_service(session: DbSession) -> SearchService:
    return SearchService(session)


SearchServiceDep = Annotated[SearchService, Depends(get_search_service)]


class SearchResultPageSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    slug: str
    space_key: str
    space_name: str
    snippet: str
    updated_at: datetime | None = None
    #: When the words are in a file attached to the page rather than on the page itself.
    file_id: uuid.UUID | None = None
    file_name: str | None = None


class SearchResultSpaceSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    key: str
    name: str
    description: str


class SearchResponseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    query: str
    pages: list[SearchResultPageSchema]
    spaces: list[SearchResultSpaceSchema]
    #: Folded (accent-free, lower-case) words and synonyms to highlight in results.
    terms: list[str] = []
    filters: dict[str, Any] | None = None


@router.get("", response_model=SearchResponseSchema, summary="Search spaces and pages")
async def search(
    user: CurrentUser,
    service: SearchServiceDep,
    q: str = Query(default="", description="Search query string"),
    limit: int = Query(default=20, ge=1, le=50),
    space: str | None = Query(default=None, description="Filter by space key or name"),
    author: str | None = Query(default=None, description="Filter by author username or name"),
    label: str | None = Query(default=None, description="Filter by page label"),
    type: str | None = Query(default=None, description="Filter by attachment type/ext"),
    updated: str | None = Query(default=None, description="Filter by updated date range"),
) -> SearchResults:
    parsed = parse_search_query(q)
    if space:
        parsed.filters.spaces.append(space)
    if author:
        parsed.filters.authors.append(author)
    if label:
        parsed.filters.labels.append(label)
    if type:
        cleaned_type = type.lower().lstrip(".")
        if cleaned_type:
            parsed.filters.types.append(cleaned_type)
    if updated:
        after, before = parse_date_spec(updated)
        if after:
            parsed.filters.updated_after = after
        if before:
            parsed.filters.updated_before = before

    return await service.search(
        # Only the free text: a filter-only box ("space:ENG") must not fall back to the raw
        # string, or the service would search for the literal word "space:ENG".
        query=parsed.clean_query,
        user=user,
        limit=limit,
        filters=parsed.filters,
        raw_query=q,
    )
