"""Files attached to a page, stored in object storage rather than Postgres."""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class PageAttachment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "page_attachments"
    __table_args__ = (Index("ix_page_attachments_page_id", "page_id"),)

    page_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("pages.id", ondelete="CASCADE"), nullable=False
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(
        String(255), nullable=False, default="application/octet-stream"
    )
    object_key: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
