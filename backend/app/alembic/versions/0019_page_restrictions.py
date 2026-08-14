"""add page-level user and group restrictions"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019_page_restrictions"
down_revision: str | None = "0018_groups_and_permissions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    permission = sa.Enum(
        "view",
        "edit",
        name="page_restriction_permission",
        native_enum=False,
        create_constraint=True,
    )
    op.create_table(
        "page_user_restrictions",
        sa.Column("page_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("permission", permission, nullable=False),
        sa.ForeignKeyConstraint(["page_id"], ["pages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("page_id", "user_id", "permission"),
        if_not_exists=True,
    )
    op.create_table(
        "page_group_restrictions",
        sa.Column("page_id", sa.UUID(), nullable=False),
        sa.Column("group_id", sa.UUID(), nullable=False),
        sa.Column(
            "permission",
            sa.Enum(
                "view",
                "edit",
                name="page_restriction_permission",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["page_id"], ["pages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("page_id", "group_id", "permission"),
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_table("page_group_restrictions")
    op.drop_table("page_user_restrictions")
