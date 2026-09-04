"""add host-mounted automatic backup policy and artifact metadata"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260903_0001"
down_revision: str | None = "20260901_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("backup_jobs", sa.Column("automated", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("backup_jobs", sa.Column("local_filename", sa.String(length=255), nullable=True))
    op.create_table(
        "automated_backup_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("interval_unit", sa.String(length=8), nullable=False, server_default="days"),
        sa.Column("interval_value", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("time_of_day", sa.String(length=5), nullable=False, server_default="02:00"),
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="UTC"),
        sa.Column("retention_count", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(length=24), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("id = 1", name="automated_backup_settings_singleton"),
    )


def downgrade() -> None:
    op.drop_table("automated_backup_settings")
    op.drop_column("backup_jobs", "local_filename")
    op.drop_column("backup_jobs", "automated")
