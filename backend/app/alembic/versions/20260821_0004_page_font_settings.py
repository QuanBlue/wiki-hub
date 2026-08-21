"""Add default_font to site_settings and font_family to spaces.

Revision ID: 20260821_0004
Revises: 20260821_0003
Create Date: 2026-08-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "20260821_0004"
down_revision: str = "20260821_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("site_settings", sa.Column("default_font", sa.String(length=50), nullable=True))
    op.add_column("spaces", sa.Column("font_family", sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column("spaces", "font_family")
    op.drop_column("site_settings", "default_font")
