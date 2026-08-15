"""Page draft schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PageDraftUpsert(BaseModel):
    content: str = Field(max_length=200_000)
    content_format: Literal["html", "markdown"]
    edit_mode: Literal["normal", "markdown", "html"]
    base_updated_at: datetime


class PageDraftRead(PageDraftUpsert):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    page_id: uuid.UUID
    updated_at: datetime
    is_conflict: bool = False
