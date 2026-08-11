"""Runtime-editable instance settings.

A single row (``id = 1``), enforced by a CHECK constraint.

**NULL means "inherit from the environment".** That is the load-bearing
decision: if the row instead stored a snapshot of the env value, then changing
``WIKIHUB_SITE_NAME`` in the environment would silently do nothing forever.
NULL keeps "reset to the environment default" a reachable state.

Typed columns rather than a key/value table: key/value needs a value-type
discriminator, a cast on every read and a per-key validation registry - more
machinery than a handful of typed columns, with worse types. The cost is a
migration per new setting, which ``alembic check`` then keeps honest.
"""

from __future__ import annotations

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Integer, SmallInteger, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

#: The only valid primary key. Exposed so services and tests agree on it.
SINGLETON_ID = 1


class SiteSettings(TimestampMixin, Base):
    __tablename__ = "site_settings"
    __table_args__ = (CheckConstraint("id = 1", name="singleton"),)

    id: Mapped[int] = mapped_column(
        SmallInteger, primary_key=True, autoincrement=False, default=SINGLETON_ID
    )

    # Every override is nullable: NULL = fall back to the env-backed default.
    site_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    max_upload_size_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    allowed_attachment_types: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    #: Per-role visibility for the application navigation. NULL keeps the
    #: conservative built-in policy (knowledge navigation for everyone,
    #: administration for administrators only).
    sidebar_permissions: Mapped[dict[str, list[str]] | None] = mapped_column(
        JSONB, nullable=True
    )

    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<SiteSettings id={self.id}>"
