"""Private labels attached to pages by one member."""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class UserPageLabel(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "user_page_labels"
    __table_args__ = (
        UniqueConstraint("user_id", "page_id", "name", name="uq_user_page_labels_user_page_name"),
        Index("ix_user_page_labels_user_page", "user_id", "page_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    page_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), ForeignKey("pages.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
