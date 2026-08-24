"""add space_visits table for the "most visited" sidebar ranking"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824_0003"
down_revision: str | None = "20260824_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "space_visits",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("space_id", sa.UUID(), nullable=False),
        sa.Column("visit_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "last_visited_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["space_id"], ["spaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "space_id"),
    )
    op.create_index(
        "ix_space_visits_user_id_visit_count",
        "space_visits",
        ["user_id", "visit_count"],
    )


def downgrade() -> None:
    op.drop_index("ix_space_visits_user_id_visit_count", table_name="space_visits")
    op.drop_table("space_visits")
