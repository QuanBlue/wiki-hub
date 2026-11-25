"""Page template model (global and per-space reusable page structures)."""

from __future__ import annotations

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class PageTemplate(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "page_templates"
    __table_args__ = (
        CheckConstraint(
            "(scope = 'global' AND space_id IS NULL) OR (scope = 'space' AND space_id IS NOT NULL)",
            name="scope_space_consistency",
        ),
        CheckConstraint("scope IN ('global', 'space')", name="scope_valid"),
        CheckConstraint("content_format IN ('html', 'markdown')", name="content_format_valid"),
        Index("ix_page_templates_scope_space_id", "scope", "space_id"),
    )

    scope: Mapped[str] = mapped_column(String(16), nullable=False)
    space_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("spaces.id", ondelete="CASCADE"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False, server_default="")
    category: Mapped[str] = mapped_column(String(64), nullable=False, server_default="general")
    icon: Mapped[str] = mapped_column(String(32), nullable=False, server_default="")
    content: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    content_format: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="html"
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<PageTemplate {self.scope}:{self.name!r}>"
