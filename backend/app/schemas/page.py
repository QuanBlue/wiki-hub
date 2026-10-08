"""Page schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

#: Ceiling on stored page content. Security-report exports can legitimately
#: exceed one million HTML characters even after their layout wrappers and
#: unsafe markup have been removed. Two and a half megabytes keeps such reports whole;
#: the same limit is shared by page updates and drafts so an imported page can
#: still be edited and saved without a validation failure.
MAX_PAGE_CONTENT_CHARS = 2_500_000


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
    can_move: bool = False
    can_delete: bool = False
    # True when a view restriction on this page or an ancestor narrows who may
    # read it. Independent of the space's own visibility.
    is_restricted: bool = False
    # This page's own General-access setting, separate from anything it
    # inherits - `is_restricted` above also counts an ancestor's.
    own_restricted: bool = False
    # The nearest ancestor whose restrictions flow down to this page, if any.
    restricted_ancestor_title: str | None = None
    restricted_ancestor_slug: str | None = None
    # An ancestor is in Restricted mode, so this page is closed to that
    # ancestor's list even while its own setting is Open.
    inherits_view_restriction: bool = False
    # Whether this page follows its parent's access at all (child pages only).
    inherit_restrictions: bool = True


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


class LikerRead(BaseModel):
    """Someone who liked a page or a comment, for the "who liked this" list."""

    id: uuid.UUID
    username: str
    full_name: str
    avatar_url: str | None = None


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
