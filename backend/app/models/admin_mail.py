"""Administrator mailboxes and the requests users send to them.

A user who cannot sign in (no account yet, forgotten password) has no way to
reach an administrator inside the app. They fill in a public form; the request
is stored, then emailed to every administrator mailbox.

Three tables, and the split is deliberate:

* ``AdminMailbox`` - one SMTP identity, linked to exactly one WikiHub account.
  It is the account's own mailbox: requests are mailed *from* it *to* it.
* ``AdminRequest`` - the request itself, stored once whatever happens to the
  email. The Inbox is the durable copy, so a mailbox whose password has
  expired never costs anyone a request.
* ``AdminRequestRecipient`` - one row per mailbox that was active when the
  request arrived. Keyed by *user* rather than mailbox so read state and the
  delivery result are per account, and survive the mailbox being edited.

Statuses are plain strings, not database enums, for the same reason as the
rest of the schema: adding a value must not need a migration.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class SmtpSecurity(StrEnum):
    #: Implicit TLS from the first byte (usually port 465).
    ssl = "ssl"
    #: Plain connection upgraded with STARTTLS (usually port 587).
    starttls = "starttls"
    #: No encryption. Only sensible for a relay on a trusted network.
    none = "none"


class MailHealth(StrEnum):
    #: Never checked yet.
    unknown = "unknown"
    #: The last check or send authenticated and worked.
    ok = "ok"
    #: The server rejected the credentials - the password has expired, been
    #: changed elsewhere, or could not be decrypted. Needs a new password.
    auth_failed = "auth_failed"
    #: The server could not be reached (DNS, refused, timed out).
    unreachable = "unreachable"
    #: Reached and authenticated, but the server refused the message.
    error = "error"


class RequestKind(StrEnum):
    account = "account"
    password_reset = "password_reset"  # noqa: S105 - a kind of request, not a credential
    other = "other"


class DeliveryStatus(StrEnum):
    sent = "sent"
    failed = "failed"


class AdminMailbox(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "admin_mailboxes"

    #: One mailbox per account. Deleting the account removes its mailbox.
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)

    smtp_host: Mapped[str] = mapped_column(String(255), nullable=False)
    smtp_port: Mapped[int] = mapped_column(Integer, nullable=False)
    smtp_security: Mapped[str] = mapped_column(
        String(16), nullable=False, default=SmtpSecurity.starttls.value
    )
    smtp_username: Mapped[str] = mapped_column(String(320), nullable=False)
    #: Fernet token (see ``modules/admin_mail/crypto.py``). Never returned by
    #: the API and never logged.
    smtp_password_enc: Mapped[str] = mapped_column(Text, nullable=False)

    #: The administrator's own switch. The mailbox is only *effectively*
    #: enabled while the linked account is also active.
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    health_status: Mapped[str] = mapped_column(
        String(24), nullable=False, default=MailHealth.unknown.value
    )
    health_checked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    health_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<AdminMailbox {self.email} {self.health_status}>"


class AdminRequest(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "admin_requests"
    # The Inbox lists newest first.
    __table_args__ = (Index("ix_admin_requests_created_at", "created_at"),)

    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    requester_name: Mapped[str] = mapped_column(String(120), nullable=False)
    #: Where an administrator can reply. Not verified: anyone can type any
    #: address, so it is presented as "claimed" in the UI.
    requester_email: Mapped[str] = mapped_column(String(320), nullable=False)
    requester_username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    client_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)

    #: Resolved is shared by every recipient: one administrator handling a
    #: request closes it for the others.
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )


class AdminRequestRecipient(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "admin_request_recipients"
    __table_args__ = (
        UniqueConstraint("request_id", "user_id", name="uq_admin_request_recipient"),
        Index("ix_admin_request_recipients_user_read", "user_id", "read_at"),
    )

    request_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("admin_requests.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    #: Snapshot: shows what the mail went to even after the mailbox is edited.
    mailbox_email: Mapped[str] = mapped_column(String(320), nullable=False)
    delivery_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=DeliveryStatus.failed.value
    )
    delivery_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
