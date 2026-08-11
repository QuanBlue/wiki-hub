"""add sidebar role permissions

Revision ID: 0007_sidebar_permissions
Revises: 0006_pages
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007_sidebar_permissions"
down_revision: str | None = "0006_pages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "site_settings",
        sa.Column("sidebar_permissions", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("site_settings", "sidebar_permissions")
