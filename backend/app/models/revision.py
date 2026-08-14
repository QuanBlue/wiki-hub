"""Page revision history model for tracking edits and supporting restoration."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDPrimaryKeyMixin
from app.models.page import WikiPage
from app.models.user import User


class PageRevision(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "page_revisions"
    __table_args__ = (
        UniqueConstraint("page_id", "version", name="uq_page_revisions_version"),
        Index("ix_page_revisions_page_id_created", "page_id", "created_at"),
    )

    page_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("pages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    content_format: Mapped[str] = mapped_column(
        String(16), nullable=False, default="html", server_default="html"
    )

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    change_summary: Mapped[str | None] = mapped_column(String(255), nullable=True)

    page: Mapped[WikiPage] = relationship(lazy="joined")
    created_by: Mapped[User | None] = relationship(lazy="joined")
