"""Audit trail of privileged operations.

Append-only: there is no update or delete path anywhere in the application, and
no API surface to write one. Rows are written in the *same* transaction as the
operation they describe, so an operation that rolls back leaves no audit row
claiming it happened.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKeyMixin


class AuditAction(StrEnum):
    """Known audit actions.

    Deliberately *not* a database CHECK constraint, unlike ``SpaceRole``. An
    audit log is historical: a constraint that rejected a newly added action
    would fail the business operation being recorded, and rows written by an
    older build must stay readable after this list changes.
    """

    user_created = "user_created"
    user_updated = "user_updated"
    user_activated = "user_activated"
    user_deactivated = "user_deactivated"
    user_role_changed = "user_role_changed"
    user_permissions_changed = "user_permissions_changed"
    user_password_reset = "user_password_reset"  # noqa: S105 - an action name
    user_password_changed = "user_password_changed"  # noqa: S105 - an action name
    user_deleted = "user_deleted"

    space_created = "space_created"
    space_updated = "space_updated"
    space_archived = "space_archived"
    space_deleted = "space_deleted"
    space_member_set = "space_member_set"
    space_member_removed = "space_member_removed"
    page_created = "page_created"
    page_updated = "page_updated"

    impersonation_started = "impersonation_started"
    impersonation_stopped = "impersonation_stopped"

    site_settings_updated = "site_settings_updated"
    sidebar_permissions_updated = "sidebar_permissions_updated"
    backup_exported = "backup_exported"
    backup_imported = "backup_imported"


class AuditLog(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        # Plain ascending indexes: PostgreSQL scans a btree backwards just as
        # cheaply, so `ORDER BY created_at DESC` needs no DESC index.
        Index("ix_audit_logs_created_at", "created_at"),
        Index("ix_audit_logs_action_created_at", "action", "created_at"),
        Index("ix_audit_logs_actor_id_created_at", "actor_id", "created_at"),
        Index("ix_audit_logs_entity", "entity_type", "entity_id"),
    )

    # No TimestampMixin: these rows are immutable, and its `updated_at`
    # onupdate would force a refresh round trip after every insert.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    #: Denormalised so a `user_deleted` row stays readable after the FK is
    #: nulled - which is exactly the row you most want to read later.
    actor_username: Mapped[str] = mapped_column(String(64), nullable=False, server_default="system")

    #: Set when the action was taken through impersonation. ``actor_*`` then
    #: names the account the request ran as, and this names the human who chose
    #: to run it. Without this column the trail would read "alice deleted the
    #: space" when an administrator did it while impersonating alice - which is
    #: precisely the accountability the feature would otherwise destroy.
    impersonator_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    impersonator_username: Mapped[str | None] = mapped_column(String(64), nullable=True)

    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True), nullable=True)
    #: Human-readable name of the target at the time of the action.
    entity_label: Mapped[str] = mapped_column(String(255), nullable=False, server_default="")

    #: Named `details`, never `metadata` - the latter is reserved on SQLAlchemy
    #: declarative classes and fails at class-definition time.
    details: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )

    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)  # IPv6 max
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<AuditLog {self.action} {self.entity_type}>"
