"""allow confirmed Confluence space overwrites

Revision ID: 0015_import_overwrite
Revises: 0014_archive_size_bigint
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_import_overwrite"
down_revision: str | None = "0014_archive_size_bigint"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "import_jobs",
        sa.Column("overwrite_existing", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("import_jobs", "overwrite_existing", server_default=None)


def downgrade() -> None:
    op.drop_column("import_jobs", "overwrite_existing")
