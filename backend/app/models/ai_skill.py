"""Instructions an administrator can customise for an AI feature (a "skill").

One row per skill, keyed by name (today only ``summary``). No row means the
built-in instructions apply. Like the connections, this table is not part of
backups.
"""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class AiSkill(TimestampMixin, Base):
    __tablename__ = "ai_skills"

    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    instructions: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
