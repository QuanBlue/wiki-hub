"""Document import schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.modules.document_import.convert import FORMAT_BY_EXTENSION

#: How many documents one request may carry. Not a technical limit - each file
#: is separately bounded by the workspace upload ceiling - but a batch this
#: size already takes minutes, and a larger one is almost always a mistake
#: (someone selecting a whole folder) that is kinder to reject than to run.
MAX_DOCUMENT_IMPORT_FILES = 20

#: Extensions the picker offers and the endpoint accepts. Derived from the
#: converter's own table so the two can never disagree about what is supported.
DOCUMENT_IMPORT_EXTENSIONS: frozenset[str] = frozenset(FORMAT_BY_EXTENSION)

#: Statuses that mean a job is still going. Shared by the API's "is anything
#: running?" query and the frontend's polling teardown.
ACTIVE_DOCUMENT_IMPORT_STATUSES = ("queued", "running")


class DocumentImportItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    position: int
    filename: str
    size_bytes: int
    source_format: str
    status: str
    error: str | None = None
    warnings: list[str] = []
    #: Null until the page exists, and null again if it is later deleted -
    #: `page_title` and `page_slug` keep the record readable either way.
    page_id: uuid.UUID | None = None
    page_title: str | None = None
    page_slug: str | None = None
    attachments_created: int = 0


class DocumentImportJobRead(BaseModel):
    id: uuid.UUID
    space_key: str
    parent_id: uuid.UUID | None = None
    status: str
    phase: str
    counters: dict[str, int] = {}
    cancel_requested: bool = False
    error: str | None = None
    #: Null when there is not yet enough data to estimate; the UI shows an
    #: indeterminate spinner rather than a fabricated number.
    percent: int | None = None
    eta_seconds: int | None = None
    started_at: datetime | None = None
    heartbeat_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    items: list[DocumentImportItemRead] = []
