"""pages: a Trash instead of deleting outright

``pages.deleted_at`` marks a page that was deleted but can still be restored; it is
removed for good once it has been in the Trash longer than ``trash_retention_days``.
``pages.deleted_by_id`` records who put it there.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261021_0001"
down_revision: str | None = "20261020_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("pages", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "pages",
        sa.Column(
            "deleted_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_pages_deleted_at", "pages", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("ix_pages_deleted_at", table_name="pages")
    op.drop_column("pages", "deleted_by_id")
    op.drop_column("pages", "deleted_at")
