"""record what a backup job is doing, not just how far along it is

`backup_jobs.phase` and `backup_jobs.counters` are current-state columns:
each write overwrites the last, so a step that has finished leaves no trace.
Watching a multi-hour restore against a progress bar alone gives no way to
tell steady work from a wedged worker, and no record afterwards of what the
run actually touched.

The Confluence import has had `import_logs` since 0011 and the admin panel
already renders it.  Restore is shown in the same panel, right beside it, so
this is deliberately the same table shape rather than a new idea - an
operator should not have to learn two different accounts of the same kind of
work.  It stays a separate table because a foreign key can only point at one
job table, and the two job kinds are kept apart on purpose (different trust
boundaries: a WikiHub backup can carry identities and credentials).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260826_0001"
down_revision: str | None = "20260825_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "backup_job_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "job_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("backup_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("level", sa.String(12), nullable=False),
        sa.Column("phase", sa.String(32), nullable=False),
        sa.Column("entity_type", sa.String(32)),
        sa.Column("entity_label", sa.String(255)),
        sa.Column("message", sa.Text(), nullable=False),
    )
    op.create_index(
        "ix_backup_job_logs_job_created", "backup_job_logs", ["job_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_table("backup_job_logs")
