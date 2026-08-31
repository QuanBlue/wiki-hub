"""add private user page pins."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260830_0001"
down_revision: str | None = "20260828_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_page_pins",
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column(
            "page_id", sa.UUID(), sa.ForeignKey("pages.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_user_page_pins_user_created", "user_page_pins", ["user_id", "created_at"])
    op.create_table(
        "user_tags",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("user_id", "name", name="uq_user_tags_user_name"),
    )
    op.create_index("ix_user_tags_user_created", "user_tags", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_user_tags_user_created", table_name="user_tags")
    op.drop_table("user_tags")
    op.drop_index("ix_user_page_pins_user_created", table_name="user_page_pins")
    op.drop_table("user_page_pins")
