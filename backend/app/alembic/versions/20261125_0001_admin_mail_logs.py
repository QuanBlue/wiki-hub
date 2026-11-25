"""add admin_mail_logs table for outbound email delivery history

Revision ID: 20261125_0001
Revises: 20261121_0001
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision: str = "20261125_0001"
down_revision: str | None = "20261121_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "admin_mail_logs",
        sa.Column("id", PgUUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "mailbox_id",
            PgUUID(as_uuid=True),
            sa.ForeignKey("admin_mailboxes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("from_email", sa.String(length=320), nullable=False, server_default=""),
        sa.Column("to_email", sa.String(length=320), nullable=False),
        sa.Column("subject", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("error_code", sa.String(length=32), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "actor_id",
            PgUUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("actor_username", sa.String(length=64), nullable=True),
    )
    op.create_index("ix_admin_mail_logs_created_at", "admin_mail_logs", ["created_at"])
    op.create_index(
        "ix_admin_mail_logs_status_created_at",
        "admin_mail_logs",
        ["status", "created_at"],
    )
    op.create_index(
        "ix_admin_mail_logs_kind_created_at",
        "admin_mail_logs",
        ["kind", "created_at"],
    )
    op.create_index(
        "ix_admin_mail_logs_mailbox_created_at",
        "admin_mail_logs",
        ["mailbox_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_admin_mail_logs_mailbox_created_at", table_name="admin_mail_logs")
    op.drop_index("ix_admin_mail_logs_kind_created_at", table_name="admin_mail_logs")
    op.drop_index("ix_admin_mail_logs_status_created_at", table_name="admin_mail_logs")
    op.drop_index("ix_admin_mail_logs_created_at", table_name="admin_mail_logs")
    op.drop_table("admin_mail_logs")
