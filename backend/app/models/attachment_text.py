"""The words inside a file attached to a page, so search and the AI assistant can read it.

People often attach a Word, Excel, HTML or PDF file to a page instead of importing it,
and still expect to find and ask about what it says. The worker reads each file attached
to a page (see ``modules.attachments.text``) into simple markup here; the file itself is
never changed. Derived data: an empty table is rebuilt by the worker.

The database adds a ``search_vector`` column like ``pages.search_vector`` where the
search functions exist (see ``modules.search.ddl``); it is not mapped here.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

#: What reading a file came to.
#: ``ok`` - its text is here; ``empty`` - it holds no text; ``scanned`` - a PDF of page
#: images (no OCR); ``unsupported`` - a type WikiHub cannot read; ``too_large`` - past the
#: size limit; ``failed`` - corrupt, password-protected, or the reader gave up.
STATUSES = ("ok", "empty", "scanned", "unsupported", "too_large", "failed")


class AttachmentText(Base):
    __tablename__ = "attachment_texts"
    __table_args__ = (Index("ix_attachment_texts_page_id", "page_id"),)

    attachment_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("page_attachments.id", ondelete="CASCADE"),
        primary_key=True,
    )
    page_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("pages.id", ondelete="CASCADE"), nullable=False
    )
    #: The file name shown with what was read from it (a copy, so search needs no join).
    filename: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    #: What the text was read from (name, size and edit count); a new version re-reads it.
    signature: Mapped[str] = mapped_column(String(320), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    #: Headings and paragraphs as plain markup (``<h2>``/``<p>``), empty unless ``ok``.
    content: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    #: Why it could not be read, for the administrator.
    detail: Mapped[str] = mapped_column(String(500), nullable=False, default="", server_default="")
    #: Characters of text read (before any cut).
    chars: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    extracted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
