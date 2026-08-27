"""Page draft schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.page import MAX_PAGE_CONTENT_CHARS


class PageDraftUpsert(BaseModel):
    # Same ceiling as the page itself: a draft is the page's unsaved content,
    # so a cap that is lower means autosave 422s on a page that saved fine.
    content: str = Field(max_length=MAX_PAGE_CONTENT_CHARS)
    content_format: Literal["html", "markdown"]
    edit_mode: Literal["normal", "markdown", "html"]
    base_updated_at: datetime


class PageDraftRead(PageDraftUpsert):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    page_id: uuid.UUID
    updated_at: datetime
    is_conflict: bool = False
