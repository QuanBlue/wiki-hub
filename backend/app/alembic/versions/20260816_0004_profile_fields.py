"""Add optional public profile fields to users."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260816_0004"
down_revision: str | None = "20260816_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("bio", sa.Text(), nullable=False, server_default="")
    )
    op.add_column(
        "users",
        sa.Column("pronouns", sa.String(length=64), nullable=False, server_default=""),
    )
    op.add_column(
        "users",
        sa.Column(
            "profile_url", sa.String(length=2048), nullable=False, server_default=""
        ),
    )
    op.add_column(
        "users", sa.Column("social_links", sa.JSON(), nullable=False, server_default="[]")
    )
    op.add_column(
        "users",
        sa.Column("company", sa.String(length=255), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("users", "company")
    op.drop_column("users", "social_links")
    op.drop_column("users", "profile_url")
    op.drop_column("users", "pronouns")
    op.drop_column("users", "bio")
