"""site settings: how long a deleted page stays in the Trash

``site_settings.trash_retention_days`` is an administrator's choice (Administration >
Settings); NULL keeps the built-in default of 30 days.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261021_0002"
down_revision: str | None = "20261021_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("site_settings", sa.Column("trash_retention_days", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("site_settings", "trash_retention_days")
