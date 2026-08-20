"""Add theme_color, logo_icon, custom_logo_url to site_settings

Revision ID: 20260820_0001
Revises: 20260818_0001
Create Date: 2026-08-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "20260820_0001"
down_revision: str = "20260818_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("site_settings", sa.Column("theme_color", sa.String(length=50), nullable=True))
    op.add_column("site_settings", sa.Column("logo_icon", sa.String(length=50), nullable=True))
    op.add_column("site_settings", sa.Column("custom_logo_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("site_settings", "custom_logo_url")
    op.drop_column("site_settings", "logo_icon")
    op.drop_column("site_settings", "theme_color")
