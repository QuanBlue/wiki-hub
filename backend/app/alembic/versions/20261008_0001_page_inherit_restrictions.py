"""add pages.inherit_restrictions (a child page may stop following its parent's access)"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261008_0001"
down_revision: str | None = "20261007_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Every existing page keeps inheriting - the behaviour it already had.
    op.add_column(
        "pages",
        sa.Column(
            "inherit_restrictions", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
    )


def downgrade() -> None:
    op.drop_column("pages", "inherit_restrictions")
