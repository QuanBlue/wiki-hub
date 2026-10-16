"""Whether the chat may look things up on the internet, and with which search service.

One wiki-wide row, off until an administrator turns it on. The key of the search service
is stored encrypted like an AI connection's, and this table is left out of backups for the
same reason.
"""

from __future__ import annotations

import uuid

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

#: ``gateway`` searches through the AI connection itself: no key of its own.
PROVIDERS = ("gateway", "tavily", "brave", "serper")


class AiWebSearchSettings(TimestampMixin, Base):
    __tablename__ = "ai_web_search_settings"
    __table_args__ = (CheckConstraint("id = 1", name="ck_ai_web_search_settings_singleton"),)

    #: Always 1: there is exactly one row.
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1, server_default=text("1"))
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    provider: Mapped[str] = mapped_column(
        String(16), nullable=False, default="tavily", server_default="tavily"
    )
    api_key_encrypted: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=""
    )
    api_key_preview: Mapped[str] = mapped_column(
        String(40), nullable=False, default="", server_default=""
    )
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
