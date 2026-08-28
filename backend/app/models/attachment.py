"""Files attached to a page, stored in object storage rather than Postgres."""

from __future__ import annotations

import uuid

from sqlalchemy import BigInteger, ForeignKey, Index, Integer, String
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
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    #: Bumped whenever ONLYOFFICE writes a new version.  Its value forms part
    #: of the document key, preventing the document server from serving a
    #: cached predecessor when an attachment is reopened.
    office_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
