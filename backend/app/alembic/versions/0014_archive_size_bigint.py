"""support large staged import archives

Revision ID: 0014_archive_size_bigint
Revises: 0013_confluence_resume
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_archive_size_bigint"
down_revision: str | None = "0013_confluence_resume"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("import_archives", "size_bytes", type_=sa.BigInteger())


def downgrade() -> None:
    op.alter_column("import_archives", "size_bytes", type_=sa.Integer())
