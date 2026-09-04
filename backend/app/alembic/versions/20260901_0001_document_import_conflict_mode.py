"""store document import title conflict preference."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260901_0001"
down_revision: str | None = "20260831_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "document_import_jobs",
        sa.Column(
            "conflict_mode",
            sa.String(length=16),
            nullable=False,
            server_default="rename",
        ),
    )


def downgrade() -> None:
    op.drop_column("document_import_jobs", "conflict_mode")
