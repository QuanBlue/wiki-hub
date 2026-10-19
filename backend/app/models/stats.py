"""Usage records that feed the administrator statistics page.

These tables are counters written as a side effect of normal use. None is
part of backups: they are derived telemetry, not wiki content.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKeyMixin


class AiUsage(UUIDPrimaryKeyMixin, Base):
    """Tokens one AI request spent, as reported by the gateway."""

    __tablename__ = "ai_usage"
    __table_args__ = (Index("ix_ai_usage_created_at", "created_at"),)

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    feature: Mapped[str] = mapped_column(String(24), nullable=False)
    model: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ContentViewDaily(Base):
    """How many times a page or space was opened on one day (UTC)."""

    __tablename__ = "content_views_daily"

    entity_type: Mapped[str] = mapped_column(String(8), primary_key=True)  # "page" | "space"
    entity_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    views: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class UserActivityDaily(Base):
    """One person's time in the app on one day (UTC), fed by the browser's activity heartbeat."""

    __tablename__ = "user_activity_daily"
    __table_args__ = (Index("ix_user_activity_daily_day", "day"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    active_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_active_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
