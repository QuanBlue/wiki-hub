"""add resumable Confluence upload state

Revision ID: 0013_confluence_resume
Revises: 0012_page_likes
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_confluence_resume"
down_revision: str | None = "0012_page_likes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("import_archives", sa.Column("multipart_upload_id", sa.String(512), nullable=True))


def downgrade() -> None:
    op.drop_column("import_archives", "multipart_upload_id")
