"""preserve invalid Confluence actor labels without creating users"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020_invalid_import_actor_labels"
down_revision: str | None = "0019_page_restrictions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "pages",
        sa.Column("created_by_label", sa.String(length=255), nullable=True),
        if_not_exists=True,
    )
    op.add_column(
        "pages",
        sa.Column("updated_by_label", sa.String(length=255), nullable=True),
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_column("pages", "updated_by_label")
    op.drop_column("pages", "created_by_label")
