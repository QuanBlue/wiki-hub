"""Request and response shapes for page comments."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

MAX_COMMENT_LENGTH = 5000


def _clean_body(value: str) -> str:
    body = value.strip()
    if not body:
        raise ValueError("A comment cannot be empty.")
    return body


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_COMMENT_LENGTH)
    parent_id: uuid.UUID | None = None

    _strip = field_validator("body")(_clean_body)


class CommentUpdate(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_COMMENT_LENGTH)

    _strip = field_validator("body")(_clean_body)


class CommentAuthor(BaseModel):
    id: uuid.UUID
    username: str
    full_name: str
    avatar_url: str | None = None


class CommentRead(BaseModel):
    id: uuid.UUID
    parent_id: uuid.UUID | None
    body: str
    author: CommentAuthor | None
    created_at: datetime
    edited_at: datetime | None
    like_count: int
    liked_by_me: bool
    mentions: list[str]
    can_edit: bool
    can_delete: bool


class CommentLikeRead(BaseModel):
    liked_by_me: bool
    like_count: int


class MentionCandidate(BaseModel):
    username: str
    full_name: str
    avatar_url: str | None = None
    # False for someone who cannot open this page (a restricted space or
    # page): the picker shows them disabled instead of hiding them silently.
    can_view: bool = True
