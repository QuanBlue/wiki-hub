"""page and space watches

Revision ID: 20261102_0001
Revises: 20261030_0002
Create Date: 2026-11-02 09:15:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261102_0001"
down_revision: str | None = "20261030_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "page_watches",
        sa.Column(
            "page_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("pages.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "include_descendants",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_page_watches_page_id", "page_watches", ["page_id"])
    op.create_index("ix_page_watches_user_id", "page_watches", ["user_id"])

    op.create_table(
        "space_watches",
        sa.Column(
            "space_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("spaces.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_space_watches_space_id", "space_watches", ["space_id"])
    op.create_index("ix_space_watches_user_id", "space_watches", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_space_watches_user_id", table_name="space_watches")
    op.drop_index("ix_space_watches_space_id", table_name="space_watches")
    op.drop_table("space_watches")

    op.drop_index("ix_page_watches_user_id", table_name="page_watches")
    op.drop_index("ix_page_watches_page_id", table_name="page_watches")
    op.drop_table("page_watches")
