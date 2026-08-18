"""Add size_bytes to page_attachments

Revision ID: 20260818_0001
Revises: 20260816_0007_full_backup_jobs
Create Date: 2026-08-18
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "20260818_0001"
down_revision: str = "20260816_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "page_attachments",
        sa.Column("size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
    )
    # Remove the server default after backfill so future rows must supply the value.
    op.alter_column("page_attachments", "size_bytes", server_default=None)


def downgrade() -> None:
    op.drop_column("page_attachments", "size_bytes")
