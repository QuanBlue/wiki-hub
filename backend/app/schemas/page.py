"""Page schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    space_id: uuid.UUID
    parent_id: uuid.UUID | None
    title: str
    slug: str
    content: str
    content_format: Literal["html", "markdown"]
    created_at: datetime
    updated_at: datetime
    created_by_username: str | None = None
    updated_by_username: str | None = None


class PageRecentItem(BaseModel):
    id: uuid.UUID
    title: str
    slug: str
    space_key: str
    space_name: str
    created_at: datetime
    updated_at: datetime
    user_username: str
    user_full_name: str


class PageLikeRead(BaseModel):
    liked_by_me: bool
    like_count: int


class PageCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    content: str = Field(default="", max_length=200_000)
    content_format: Literal["html", "markdown"] = "html"
    parent_id: uuid.UUID | None = None


class PageMove(BaseModel):
    destination_space_key: str = Field(min_length=1, max_length=50)
    parent_id: uuid.UUID | None = None


class PageUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: str | None = Field(default=None, max_length=200_000)
    content_format: Literal["html", "markdown"] | None = None
