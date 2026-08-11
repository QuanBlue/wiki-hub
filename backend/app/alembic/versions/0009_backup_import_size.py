"""add backup import size setting

Revision ID: 0009_backup_import_size
Revises: 0008_page_hierarchy
"""
from __future__ import annotations
from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op

revision: str = "0009_backup_import_size"
down_revision: str | None = "0008_page_hierarchy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

def upgrade() -> None:
    op.add_column("site_settings", sa.Column("max_backup_import_size_mb", sa.Integer(), nullable=True))

def downgrade() -> None:
    op.drop_column("site_settings", "max_backup_import_size_mb")
