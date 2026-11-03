"""Sharing a page with people, and its share count."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Response, status

from app.api.deps import CurrentUser, DbSession
from app.modules.shares.service import PublicShareService, ShareService
from app.schemas.comment import MentionCandidate
from app.schemas.share import (
    PublicShareCreate,
    PublicShareItem,
    PublicShareListResponse,
    PublicShareUpdate,
    PublicShareVerifyRequest,
    PublicShareView,
    ShareCreate,
    ShareResult,
    ShareSummary,
)

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


@router.get(
    "/public",
    response_model=PublicShareListResponse,
    summary="List public share links for this page",
)
async def list_public_shares(
    key: str, slug: str, service: ShareServiceDep
) -> PublicShareListResponse:
    return await service.list_public_shares(key, slug)


@router.post(
    "/public",
    response_model=PublicShareItem,
    status_code=status.HTTP_201_CREATED,
    summary="Create a public share link for this page",
)
async def create_public_share(
    key: str, slug: str, payload: PublicShareCreate, service: ShareServiceDep
) -> PublicShareItem:
    return await service.create_public_share(key, slug, payload)


@router.patch(
    "/public/{share_id}",
    response_model=PublicShareItem,
    summary="Update a public share link (expiration or password)",
)
@router.put(
    "/public/{share_id}",
    response_model=PublicShareItem,
    summary="Update a public share link (expiration or password)",
)
async def update_public_share(
    key: str,
    slug: str,
    share_id: uuid.UUID,
    payload: PublicShareUpdate,
    service: ShareServiceDep,
) -> PublicShareItem:
    return await service.update_public_share(key, slug, share_id, payload)


@router.delete(
    "/public/{share_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke a public share link",
)
async def revoke_public_share(
    key: str, slug: str, share_id: uuid.UUID, service: ShareServiceDep
) -> Response:
    await service.revoke_public_share(key, slug, share_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Public unauthenticated routes for external partners/clients
public_shares_router = APIRouter(prefix="/public/shares", tags=["public-shares"])


def get_public_share_service(session: DbSession) -> PublicShareService:
    return PublicShareService(session)


PublicShareServiceDep = Annotated[PublicShareService, Depends(get_public_share_service)]


@public_shares_router.get(
    "/{token}",
    response_model=PublicShareView,
    summary="View a publicly shared page",
)
async def get_public_share(
    token: str,
    service: PublicShareServiceDep,
    x_share_password: Annotated[str | None, Header(alias="X-Share-Password")] = None,
) -> PublicShareView:
    return await service.get_share(token, password=x_share_password)


@public_shares_router.post(
    "/{token}/verify",
    response_model=PublicShareView,
    summary="Verify password and unlock a publicly shared page",
)
async def verify_public_share(
    token: str,
    payload: PublicShareVerifyRequest,
    service: PublicShareServiceDep,
) -> PublicShareView:
    return await service.get_share(token, password=payload.password)

