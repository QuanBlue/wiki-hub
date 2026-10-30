"""site settings: system-wide announcement banner configuration

``site_settings.announcement`` stores the administrator-configured top banner
(rich-text HTML content, level, start/expiry schedule, dismissibility, and
login-page visibility); NULL means no announcement is configured.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261030_0002"
down_revision: str | None = "20261030_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "site_settings",
        sa.Column(
            "announcement",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("site_settings", "announcement")
