"""deduplicate uploaded Confluence archives by sha256

Revision ID: 0017_import_archive_sha256
Revises: 0016_page_attachments
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017_import_archive_sha256"
down_revision: str | None = "0016_page_attachments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("import_archives", sa.Column("sha256", sa.String(length=64), nullable=True))
    op.create_index(
        "ix_import_archives_sha256_size_status",
        "import_archives",
        ["sha256", "size_bytes", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_import_archives_sha256_size_status", table_name="import_archives")
    op.drop_column("import_archives", "sha256")
