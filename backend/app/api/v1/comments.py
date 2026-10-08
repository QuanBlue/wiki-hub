"""Threaded comments (and their likes) on a page."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import CurrentUser, DbSession
from app.modules.comments.service import CommentService
from app.schemas.comment import (
    CommentCreate,
    CommentLikeRead,
    CommentRead,
    CommentUpdate,
    MentionCandidate,
)
from app.schemas.page import LikerRead
from app.schemas.pagination import Page

router = APIRouter(prefix="/spaces/{key}/pages/{slug}/comments", tags=["comments"])


def get_comment_service(session: DbSession, user: CurrentUser) -> CommentService:
    return CommentService(session, user)


CommentServiceDep = Annotated[CommentService, Depends(get_comment_service)]


@router.get("", response_model=Page[CommentRead], summary="List a page's comments")
async def list_comments(key: str, slug: str, service: CommentServiceDep) -> Page[CommentRead]:
    return await service.list_comments(key, slug)


@router.post(
    "",
    response_model=CommentRead,
    status_code=status.HTTP_201_CREATED,
    summary="Comment on a page, or reply to a comment",
)
async def create_comment(
    key: str, slug: str, payload: CommentCreate, service: CommentServiceDep
) -> CommentRead:
    return await service.create(key, slug, payload)


@router.get(
    "/mentionable",
    response_model=list[MentionCandidate],
    summary="People who can be @mentioned on this page",
)
async def mentionable(
    key: str,
    slug: str,
    service: CommentServiceDep,
    q: Annotated[str, Query(max_length=64)] = "",
) -> list[MentionCandidate]:
    return await service.mentionable(key, slug, q)


@router.patch("/{comment_id}", response_model=CommentRead, summary="Edit your comment")
async def update_comment(
    key: str,
    slug: str,
    comment_id: uuid.UUID,
    payload: CommentUpdate,
    service: CommentServiceDep,
) -> CommentRead:
    return await service.update(key, slug, comment_id, payload)


@router.delete(
    "/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete a comment and all of its replies",
)
async def delete_comment(
    key: str, slug: str, comment_id: uuid.UUID, service: CommentServiceDep
) -> Response:
    await service.delete(key, slug, comment_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{comment_id}/likes", response_model=list[LikerRead], summary="Who liked a comment"
)
async def comment_likers(
    key: str, slug: str, comment_id: uuid.UUID, service: CommentServiceDep
) -> list[LikerRead]:
    return await service.likers(key, slug, comment_id)


@router.put("/{comment_id}/like", response_model=CommentLikeRead, summary="Like a comment")
async def like_comment(
    key: str, slug: str, comment_id: uuid.UUID, service: CommentServiceDep
) -> CommentLikeRead:
    return await service.set_like(key, slug, comment_id, True)


@router.delete(
    "/{comment_id}/like", response_model=CommentLikeRead, summary="Remove your like"
)
async def unlike_comment(
    key: str, slug: str, comment_id: uuid.UUID, service: CommentServiceDep
) -> CommentLikeRead:
    return await service.set_like(key, slug, comment_id, False)
