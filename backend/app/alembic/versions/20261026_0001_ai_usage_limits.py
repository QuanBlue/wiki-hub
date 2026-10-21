"""AI usage limits an administrator can set in Administration > AI assistant

Two nullable columns on ``site_settings``: AI calls per person an hour, and the separate
allowance of a document translation. NULL keeps the value from the environment.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261026_0001"
down_revision: str | None = "20261025_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("site_settings", sa.Column("ai_requests_per_hour", sa.Integer(), nullable=True))
    op.add_column(
        "site_settings", sa.Column("ai_translate_requests_per_hour", sa.Integer(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("site_settings", "ai_translate_requests_per_hour")
    op.drop_column("site_settings", "ai_requests_per_hour")
