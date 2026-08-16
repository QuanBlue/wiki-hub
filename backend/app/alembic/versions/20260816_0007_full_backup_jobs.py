"""Durable ZIP backup archives and export/restore jobs."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260816_0007"
down_revision: str | None = "20260816_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "backup_archives",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("object_key", sa.String(length=512), nullable=False, unique=True),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("size_bytes", sa.BIGINT(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="uploading"),
        sa.Column("multipart_upload_id", sa.String(length=512), nullable=True),
        sa.Column("manifest", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("spaces", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    )
    op.create_index("ix_backup_archives_creator_status", "backup_archives", ["created_by_id", "status"])
    op.create_table(
        "backup_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("archive_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("backup_archives.id", ondelete="SET NULL"), nullable=True),
        sa.Column("output_key", sa.String(length=512), nullable=True, unique=True),
        sa.Column("output_filename", sa.String(length=255), nullable=True),
        sa.Column("include_credentials", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("confluence_profile", sa.String(length=32), nullable=True),
        sa.Column("import_all", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("space_keys", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("overwrite_space_keys", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="queued"),
        sa.Column("phase", sa.String(length=32), nullable=False, server_default="queued"),
        sa.Column("counters", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_backup_jobs_created_at", "backup_jobs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_backup_jobs_created_at", table_name="backup_jobs")
    op.drop_table("backup_jobs")
    op.drop_index("ix_backup_archives_creator_status", table_name="backup_archives")
    op.drop_table("backup_archives")
