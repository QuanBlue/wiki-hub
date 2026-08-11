"""add page parent relationship

Revision ID: 0008_page_hierarchy
Revises: 0007_sidebar_permissions
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_page_hierarchy"
down_revision: str | None = "0007_sidebar_permissions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "pages",
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(op.f("ix_pages_parent_id"), "pages", ["parent_id"], unique=False)
    op.create_foreign_key(
        "fk_pages_parent_id_pages",
        "pages",
        "pages",
        ["parent_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_pages_parent_id_pages", "pages", type_="foreignkey")
    op.drop_index(op.f("ix_pages_parent_id"), table_name="pages")
    op.drop_column("pages", "parent_id")
