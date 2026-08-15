"""Private, recoverable page drafts owned by individual users."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class PageDraft(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "page_drafts"
    __table_args__ = (
        UniqueConstraint("page_id", "user_id", name="uq_page_drafts_page_user"),
        Index("ix_page_drafts_page_id", "page_id"),
    )

    page_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("pages.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    content_format: Mapped[str] = mapped_column(String(16), nullable=False, default="html")
    edit_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="normal")
    base_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
