"""Page revision schemas for API responses and diff calculations."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class PageRevisionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    page_id: uuid.UUID
    version: int
    title: str
    content: str
    content_format: Literal["html", "markdown"]
    created_at: datetime
    change_summary: str | None = None
    created_by_username: str | None = None
    created_by_full_name: str | None = None


class PageRevisionDiffChunk(BaseModel):
    operation: Literal["add", "delete", "equal"]
    text: str


class PageRevisionDiffSegment(BaseModel):
    operation: Literal["add", "delete", "equal"]
    text: str


class PageRevisionDiffLine(BaseModel):
    operation: Literal["add", "delete", "equal", "replace"]
    old_line_number: int | None = None
    new_line_number: int | None = None
    old_text: str | None = None
    new_text: str | None = None
    old_segments: list[PageRevisionDiffSegment] = []
    new_segments: list[PageRevisionDiffSegment] = []


class PageRevisionDiffRead(BaseModel):
    from_version: int
    to_version: int
    title_changed: bool
    from_title: str
    to_title: str
    chunks: list[PageRevisionDiffChunk]
    added_count: int
    deleted_count: int
    lines: list[PageRevisionDiffLine] = []
