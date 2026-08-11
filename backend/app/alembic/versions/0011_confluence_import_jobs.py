"""add staged Confluence import jobs

Revision ID: 0011_confluence_import_jobs
Revises: 0010_page_content_format
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011_confluence_import_jobs"
down_revision: str | None = "0010_page_content_format"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "import_archives",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("object_key", sa.String(512), nullable=False, unique=True),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("spaces", postgresql.JSONB(), nullable=False),
        sa.Column("error", sa.Text()),
        sa.Column(
            "created_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_table(
        "import_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "archive_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("import_archives.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("import_all", sa.Boolean(), nullable=False),
        sa.Column("space_keys", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("phase", sa.String(32), nullable=False),
        sa.Column("counters", postgresql.JSONB(), nullable=False),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False),
        sa.Column("error", sa.Text()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_import_jobs_created_at", "import_jobs", ["created_at"])
    op.create_table(
        "import_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "job_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("import_jobs.id", ondelete="CASCADE"),
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
    op.create_index("ix_import_logs_job_created", "import_logs", ["job_id", "created_at"])


def downgrade() -> None:
    op.drop_table("import_logs")
    op.drop_table("import_jobs")
    op.drop_table("import_archives")
