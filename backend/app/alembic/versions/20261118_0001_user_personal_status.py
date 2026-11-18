"""users: add personal status fields and default receive_admin_emails to false

Revision ID: 20261118_0001
Revises: 20261104_0005
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261118_0001"
down_revision: str | None = "20261104_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("status_emoji", sa.String(length=32), nullable=False, server_default=""),
    )
    op.add_column(
        "users",
        sa.Column("status_text", sa.String(length=140), nullable=False, server_default=""),
    )
    op.add_column(
        "users",
        sa.Column("status_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.alter_column(
        "users",
        "receive_admin_emails",
        existing_type=sa.Boolean(),
        existing_nullable=False,
        server_default=sa.text("false"),
    )


def downgrade() -> None:
    op.alter_column(
        "users",
        "receive_admin_emails",
        existing_type=sa.Boolean(),
        existing_nullable=False,
        server_default=sa.text("true"),
    )
    op.drop_column("users", "status_expires_at")
    op.drop_column("users", "status_text")
    op.drop_column("users", "status_emoji")
