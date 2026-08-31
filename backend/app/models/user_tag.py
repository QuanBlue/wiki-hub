"""Private labels managed by one member for their own profile dashboard."""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class UserTag(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "user_tags"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_user_tags_user_name"),
        Index("ix_user_tags_user_created", "user_id", "created_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
