"""add 'denied' to page restrictions (a per-principal block, independent of the page's Open/Restricted allow-list mode)"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260912_0002"
down_revision: str | None = "20260912_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table in ("page_user_restrictions", "page_group_restrictions"):
        op.add_column(
            table,
            sa.Column("denied", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )


def downgrade() -> None:
    for table in ("page_user_restrictions", "page_group_restrictions"):
        op.drop_column(table, "denied")
