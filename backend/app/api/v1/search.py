"""Search endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict

from app.api.deps import CurrentUser, DbSession
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


@router.get("", response_model=SearchResponseSchema, summary="Search spaces and pages")
async def search(
    user: CurrentUser,
    service: SearchServiceDep,
    q: str = Query(default="", description="Search query string"),
    limit: int = Query(default=20, ge=1, le=50),
) -> SearchResults:
    return await service.search(query=q, user=user, limit=limit)
