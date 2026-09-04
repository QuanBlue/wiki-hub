"""let the admin scope automatic backups to a subdirectory of the mounted backup volume"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260904_0001"
down_revision: str | None = "20260903_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "automated_backup_settings",
        sa.Column("subdirectory", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("automated_backup_settings", "subdirectory")
