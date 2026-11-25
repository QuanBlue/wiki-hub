"""add page_templates table

Revision ID: 20261125_0004
Revises: 20261125_0003
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261125_0004"
down_revision: str | None = "20261125_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "page_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("scope", sa.String(length=16), nullable=False),
        sa.Column("space_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("category", sa.String(length=64), nullable=False, server_default="general"),
        sa.Column("icon", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("content_format", sa.String(length=16), nullable=False, server_default="html"),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_page_templates"),
        sa.ForeignKeyConstraint(
            ["space_id"],
            ["spaces.id"],
            name="fk_page_templates_space_id_spaces",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name="fk_page_templates_created_by_id_users",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_id"],
            ["users.id"],
            name="fk_page_templates_updated_by_id_users",
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "(scope = 'global' AND space_id IS NULL) OR (scope = 'space' AND space_id IS NOT NULL)",
            name="ck_page_templates_scope_space_consistency",
        ),
        sa.CheckConstraint(
            "scope IN ('global', 'space')",
            name="ck_page_templates_scope_valid",
        ),
        sa.CheckConstraint(
            "content_format IN ('html', 'markdown')",
            name="ck_page_templates_content_format_valid",
        ),
    )
    op.create_index(
        "ix_page_templates_scope_space_id",
        "page_templates",
        ["scope", "space_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_page_templates_scope_space_id", table_name="page_templates")
    op.drop_table("page_templates")
