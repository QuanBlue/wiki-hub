"""public page shares and site_settings.public_shares_enabled

Allows users to create controlled external read-only share links for pages,
with expiration and optional password protection.
Administrators can enable or disable the feature system-wide.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261102_0002"
down_revision: str | None = "20261102_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "site_settings",
        sa.Column("public_shares_enabled", sa.Boolean(), nullable=True),
    )
    op.create_table(
        "public_page_shares",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "page_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("pages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token", sa.String(64), nullable=False),
        sa.Column(
            "created_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.Column("view_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
    )
    op.create_index("ix_public_page_shares_page_id", "public_page_shares", ["page_id"])
    op.create_index(
        "ix_public_page_shares_token", "public_page_shares", ["token"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_public_page_shares_token", table_name="public_page_shares")
    op.drop_index("ix_public_page_shares_page_id", table_name="public_page_shares")
    op.drop_table("public_page_shares")
    op.drop_column("site_settings", "public_shares_enabled")
