"""administrator mailboxes, user requests and their inbox

Users who cannot sign in have no way to reach an administrator. This adds the
tables behind the public "contact an administrator" form:

* `admin_mailboxes` - one SMTP identity per administrator account.
* `admin_requests` - each request, stored once regardless of email outcome.
* `admin_request_recipients` - per-account read state and delivery result.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260928_0001"
down_revision: str | None = "20260915_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "admin_mailboxes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("display_name", sa.String(120)),
        sa.Column("smtp_host", sa.String(255), nullable=False),
        sa.Column("smtp_port", sa.Integer(), nullable=False),
        sa.Column("smtp_security", sa.String(16), nullable=False),
        sa.Column("smtp_username", sa.String(320), nullable=False),
        sa.Column("smtp_password_enc", sa.Text(), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("health_status", sa.String(24), nullable=False, server_default="unknown"),
        sa.Column("health_checked_at", sa.DateTime(timezone=True)),
        sa.Column("health_error", sa.Text()),
        *_timestamps(),
    )

    op.create_table(
        "admin_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("requester_name", sa.String(120), nullable=False),
        sa.Column("requester_email", sa.String(320), nullable=False),
        sa.Column("requester_username", sa.String(64)),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("client_ip", sa.String(64)),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column(
            "resolved_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        *_timestamps(),
    )
    op.create_index("ix_admin_requests_created_at", "admin_requests", ["created_at"])

    op.create_table(
        "admin_request_recipients",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "request_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("admin_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("mailbox_email", sa.String(320), nullable=False),
        sa.Column("delivery_status", sa.String(16), nullable=False, server_default="failed"),
        sa.Column("delivery_error", sa.Text()),
        sa.Column("read_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("request_id", "user_id", name="uq_admin_request_recipient"),
    )
    op.create_index(
        "ix_admin_request_recipients_user_read",
        "admin_request_recipients",
        ["user_id", "read_at"],
    )


def downgrade() -> None:
    op.drop_table("admin_request_recipients")
    op.drop_table("admin_requests")
    op.drop_table("admin_mailboxes")
