"""Sharing a page with people, and its share count."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import CurrentUser, DbSession
from app.modules.shares.service import ShareService
from app.schemas.comment import MentionCandidate
from app.schemas.share import ShareCreate, ShareResult, ShareSummary

router = APIRouter(prefix="/spaces/{key}/pages/{slug}/shares", tags=["shares"])


def get_share_service(session: DbSession, user: CurrentUser) -> ShareService:
    return ShareService(session, user)


ShareServiceDep = Annotated[ShareService, Depends(get_share_service)]


@router.get("", response_model=ShareSummary, summary="How many times a page was shared")
async def share_summary(key: str, slug: str, service: ShareServiceDep) -> ShareSummary:
    return await service.summary(key, slug)


@router.get(
    "/candidates",
    response_model=list[MentionCandidate],
    summary="People the page could be shared with",
)
async def share_candidates(
    key: str,
    slug: str,
    service: ShareServiceDep,
    q: Annotated[str, Query(max_length=64)] = "",
) -> list[MentionCandidate]:
    return await service.candidates(key, slug, q)


@router.post("", response_model=ShareResult, summary="Share a page with people")
async def share_page(
    key: str, slug: str, payload: ShareCreate, service: ShareServiceDep
) -> ShareResult:
    return await service.share(key, slug, payload)
