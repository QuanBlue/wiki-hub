"""add per-user page likes

Revision ID: 0012_page_likes
Revises: 0011_confluence_import_jobs
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012_page_likes"
down_revision: str | None = "0011_confluence_import_jobs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "page_likes",
        sa.Column("page_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("pages.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    )
    op.create_index("ix_page_likes_page_id", "page_likes", ["page_id"])


def downgrade() -> None:
    op.drop_index("ix_page_likes_page_id", table_name="page_likes")
    op.drop_table("page_likes")
