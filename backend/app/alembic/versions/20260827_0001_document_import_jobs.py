"""import Word/PDF/HTML documents as pages

Until now the only way to get existing content into WikiHub was to paste it
into the editor by hand, or to restore an entire Confluence backup - an
admin-only operation covering a whole workspace.  These two tables back the
in-between case an ordinary editor actually has: "I have a Word file, make it
a page."

Why not reuse `import_jobs`: its `archive_id` is NOT NULL against
`import_archives`, it carries `space_keys` / `overwrite_existing` / `import_all`
that mean nothing here, and `app/services/import_concurrency.py` treats any
active row in it as "the workspace is claimed".  Reusing it would mean one
editor importing a Word file blocks an administrator from running a restore.

Why there is no `document_import_logs` to match `import_logs` and
`backup_job_logs`: those exist because their jobs narrate thousands of
unrelated entities against a single job row.  A document import is a handful
of files, and every line worth writing is about exactly one of them, so
`document_import_items` is itself the log - one row per file, carrying its
status, its warnings and the page it produced.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260827_0001"
down_revision: str | None = "20260826_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "document_import_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "space_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("spaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # SET NULL, not CASCADE: the job is a historical record and outlives
        # whichever page happened to be open when it was started.
        sa.Column(
            "parent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("pages.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", sa.String(24), nullable=False, server_default="queued"),
        sa.Column("phase", sa.String(32), nullable=False, server_default="queued"),
        sa.Column(
            "counters",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "cancel_requested", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        # A "running" row with a stale heartbeat belongs to a worker that died.
        # Without it, an orphaned job keeps a progress bar spinning forever.
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_document_import_jobs_space_created",
        "document_import_jobs",
        ["space_id", "created_at"],
    )
    op.create_index(
        "ix_document_import_jobs_creator_status",
        "document_import_jobs",
        ["created_by_id", "status"],
    )

    op.create_table(
        "document_import_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "job_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("document_import_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column(
            "content_type",
            sa.String(255),
            nullable=False,
            server_default="application/octet-stream",
        ),
        sa.Column("object_key", sa.String(512), nullable=False, unique=True),
        sa.Column("size_bytes", sa.BIGINT(), nullable=False, server_default="0"),
        sa.Column("source_format", sa.String(16), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="queued"),
        # SET NULL keeps the record of the import when the page is deleted; the
        # denormalised title and slug below are what keep that record readable.
        sa.Column(
            "page_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("pages.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("page_title", sa.String(255), nullable=True),
        sa.Column("page_slug", sa.String(255), nullable=True),
        sa.Column(
            "attachments_created", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "warnings",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_document_import_items_job_position",
        "document_import_items",
        ["job_id", "position"],
    )


def downgrade() -> None:
    op.drop_table("document_import_items")
    op.drop_table("document_import_jobs")
