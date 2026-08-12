"""API models for staged Confluence imports."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class UploadInit(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(gt=0)


class UploadTarget(BaseModel):
    archive_id: uuid.UUID
    object_key: str
    max_size_bytes: int
    part_size_bytes: int
    uploaded_parts: list[int] = Field(default_factory=list)


class UploadPartUrlsRequest(BaseModel):
    part_numbers: list[int] = Field(min_length=1, max_length=32)


class UploadPartUrlsRead(BaseModel):
    urls: dict[int, str]


class UploadProgressRead(BaseModel):
    archive_id: uuid.UUID
    filename: str
    size_bytes: int
    status: str
    part_size_bytes: int
    uploaded_parts: list[int] = Field(default_factory=list)


class SpaceCandidate(BaseModel):
    key: str
    name: str
    page_count: int
    attachment_count: int = 0
    conflict: bool = False


class ArchiveRead(BaseModel):
    id: uuid.UUID
    filename: str
    size_bytes: int
    status: str
    error: str | None
    spaces: list[SpaceCandidate]


class ImportCreate(BaseModel):
    import_all: bool = False
    space_keys: list[str] = Field(default_factory=list)


class ImportJobRead(BaseModel):
    id: uuid.UUID
    archive_id: uuid.UUID
    import_all: bool
    space_keys: list[str]
    status: str
    phase: str
    counters: dict[str, int]
    cancel_requested: bool
    error: str | None
    created_at: datetime
    updated_at: datetime


class ImportLogRead(BaseModel):
    id: uuid.UUID
    created_at: datetime
    level: str
    phase: str
    entity_type: str | None
    entity_label: str | None
    message: str


class ImportLogPage(BaseModel):
    items: list[ImportLogRead]
    next_offset: int | None
