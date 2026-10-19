"""stats tracking: daily active people and their time in the app

``user_activity_daily`` holds one row per person per UTC day, written by the
browser's activity heartbeat. ``last_active_at`` is the previous heartbeat, so
the next one can credit only the time actually elapsed.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261022_0001"
down_revision: str | None = "20261021_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_activity_daily",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("active_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_user_activity_daily_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "day", name=op.f("pk_user_activity_daily")),
    )
    op.create_index("ix_user_activity_daily_day", "user_activity_daily", ["day"])


def downgrade() -> None:
    op.drop_index("ix_user_activity_daily_day", table_name="user_activity_daily")
    op.drop_table("user_activity_daily")
