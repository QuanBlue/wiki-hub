"""store the source format for wiki page content

Revision ID: 0010_page_content_format
Revises: 0009_backup_import_size
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_page_content_format"
down_revision: str | None = "0009_backup_import_size"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "pages",
        sa.Column("content_format", sa.String(length=16), nullable=False, server_default="html"),
    )
    op.alter_column("pages", "content_format", server_default=None)


def downgrade() -> None:
    op.drop_column("pages", "content_format")
