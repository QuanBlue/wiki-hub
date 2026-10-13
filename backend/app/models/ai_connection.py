"""Gateways the AI assistant can talk to, managed by a system administrator.

Any number of connections may be saved, but **at most one is active** - a
partial unique index enforces that in the database, so two concurrent
"activate" requests cannot both win. The active connection is the one every
AI feature uses; none active means the assistant is off.

The API key is stored encrypted with the key that protects mailbox passwords
and, like those, this table is left out of backups so an archive never carries
a credential. Only a masked preview is kept readable, to tell keys apart.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class AiConnection(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "ai_connections"
    __table_args__ = (
        Index(
            "uq_ai_connections_one_active",
            "is_active",
            unique=True,
            postgresql_where=text("is_active"),
        ),
    )

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    base_url: Mapped[str] = mapped_column(String(500), nullable=False)
    model: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    api_key_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    #: ``sk-abc1****97a`` - enough to recognise the key, never enough to use it.
    api_key_preview: Mapped[str] = mapped_column(String(40), nullable=False, default="****")
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: ``None`` until the connection has been checked.
    last_check_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
