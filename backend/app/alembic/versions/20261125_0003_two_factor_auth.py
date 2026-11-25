"""add totp 2fa columns to users and require_2fa_mode to site_settings

Revision ID: 20261125_0003
Revises: 20261125_0002
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261125_0003"
down_revision: str | None = "20261125_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("totp_secret_encrypted", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("totp_pending_secret_encrypted", sa.Text(), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "totp_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "users",
        sa.Column("totp_enabled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "totp_recovery_codes",
            sa.JSON(),
            nullable=False,
            server_default="[]",
        ),
    )
    op.add_column(
        "site_settings",
        sa.Column(
            "require_2fa_mode",
            sa.String(length=16),
            nullable=False,
            server_default="off",
        ),
    )


def downgrade() -> None:
    op.drop_column("site_settings", "require_2fa_mode")
    op.drop_column("users", "totp_recovery_codes")
    op.drop_column("users", "totp_enabled_at")
    op.drop_column("users", "totp_enabled")
    op.drop_column("users", "totp_pending_secret_encrypted")
    op.drop_column("users", "totp_secret_encrypted")
