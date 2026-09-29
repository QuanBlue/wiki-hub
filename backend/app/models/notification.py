"""In-app notifications: things that happened *to* a person.

Being given access to a space, having a password reset by an administrator,
being added to a group, a new request arriving for an administrator. Each is one
row, addressed to one user, so the bell can list them and count the unread.

What is stored is the *kind* and its parameters (the space's name, the group's
name, who did it) rather than finished sentences. The wording is chosen by the
reader's own language when it is shown, and a notification never goes stale
because a translation changed.

``kind`` is a plain string, not a database enum, so a new kind of event needs no
migration.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Notification(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "notifications"
    __table_args__ = (
        # "My notifications, newest first" and "how many unread".
        Index("ix_notifications_user_created", "user_id", "created_at"),
        Index(
            "ix_notifications_user_unread",
            "user_id",
            postgresql_where=text("read_at IS NULL"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(48), nullable=False)
    #: Everything the wording needs (names, roles); plain strings only.
    params: Mapped[dict[str, str]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    #: Where the notification leads when clicked (an in-app path), if anywhere.
    link: Mapped[str | None] = mapped_column(String(300), nullable=True)
    #: Whoever caused it, for display; the row survives that account going away.
    actor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Notification {self.kind} for {self.user_id}>"
