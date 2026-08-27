"""Page schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

#: Ceiling on stored page content. Raised from 200k when document import landed:
#: a converted 300-page Word file exceeds 200k routinely, and a page the
#: importer creates has to stay editable - with the old cap, opening such a page
#: and pressing Save returned 422 from `PageUpdate`, on a page WikiHub itself
#: created. Both schemas below therefore share one constant; they must never
#: drift apart. Not raised further: at a million characters the Tiptap editor is
#: already sluggish and every revision duplicates the content in page_revisions.
MAX_PAGE_CONTENT_CHARS = 1_000_000


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
    can_edit: bool = False
    can_export: bool = False
    # True when a view restriction on this page or an ancestor narrows who may
    # read it. Independent of the space's own visibility.
    is_restricted: bool = False


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
    content: str = Field(default="", max_length=MAX_PAGE_CONTENT_CHARS)
    content_format: Literal["html", "markdown"] = "html"
    parent_id: uuid.UUID | None = None


class PageMove(BaseModel):
    destination_space_key: str = Field(min_length=1, max_length=50)
    parent_id: uuid.UUID | None = None


class PageUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: str | None = Field(default=None, max_length=MAX_PAGE_CONTENT_CHARS)
    content_format: Literal["html", "markdown"] | None = None
