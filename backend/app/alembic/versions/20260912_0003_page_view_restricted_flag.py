"""add pages.view_restricted (an explicit Open/Restricted setting, decoupled from whether restriction rows happen to exist)"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260912_0003"
down_revision: str | None = "20260912_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "pages",
        sa.Column("view_restricted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    # Backfill: any page that already has a non-denied view restriction row
    # (its own, allow-list rows only - `denied` doesn't exist until the
    # previous migration in this same series) was already "Restricted" under
    # the old rows-imply-mode inference; carry that forward so nothing that
    # used to be closed off suddenly opens up.
    op.execute(
        sa.text(
            "UPDATE pages SET view_restricted = true WHERE id IN ("
            "SELECT page_id FROM page_user_restrictions WHERE permission = 'view' AND denied = false"
            " UNION "
            "SELECT page_id FROM page_group_restrictions WHERE permission = 'view' AND denied = false"
            ")"
        )
    )


def downgrade() -> None:
    op.drop_column("pages", "view_restricted")
