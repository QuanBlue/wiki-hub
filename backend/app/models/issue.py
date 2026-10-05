"""Issues: problems people report to the administrators.

Anyone signed in can report one. People who may triage (superusers, system
administrators and holders of the ``manage_issues`` global permission) claim it
and mark it done; only the assignee or a superuser may change its status.

``status`` is a plain string rather than a database enum, so a new state needs
no migration. Screenshots are stored in object storage, one row each.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class IssueStatus(StrEnum):
    open = "open"
    in_progress = "in_progress"
    done = "done"


class Issue(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "issues"
    __table_args__ = (
        Index("ix_issues_status_created", "status", "created_at"),
        Index("ix_issues_reporter", "reporter_id", "created_at"),
    )

    reporter_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=IssueStatus.open.value)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    #: Label slugs (see ``modules.issues.labels``), e.g. ``["bug", "question"]``.
    labels: Mapped[list[str]] = mapped_column(
        ARRAY(String(32)), nullable=False, default=list, server_default=text("'{}'")
    )
    #: The in-app page the reporter was on, to help reproduce it.
    page_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Issue {self.title!r} {self.status}>"


class IssueNote(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A note on an issue, written by someone who manages issues.

    Notes are internal by default: only issue managers see them. A note with
    ``public`` set - the one written when an issue is closed - is also shown to
    the person who reported it, and is what the closing email quotes.
    """

    __tablename__ = "issue_notes"
    __table_args__ = (Index("ix_issue_notes_issue", "issue_id", "created_at"),)

    issue_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("issues.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    public: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )


class IssueAttachment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A screenshot attached to an issue, kept in object storage."""

    __tablename__ = "issue_attachments"
    __table_args__ = (Index("ix_issue_attachments_issue", "issue_id"),)

    issue_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("issues.id", ondelete="CASCADE"), nullable=False
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    object_key: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
