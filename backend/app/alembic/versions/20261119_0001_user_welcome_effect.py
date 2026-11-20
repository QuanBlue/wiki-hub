"""users: add welcome_effect and welcome_message, and customize_profile_welcome permission

Revision ID: 20261119_0001
Revises: 20261118_0001
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261119_0001"
down_revision: str | None = "20261118_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CONSTRAINT = "ck_group_global_permissions_global_permission"
_OLD = ("create_space", "manage_users", "manage_groups", "manage_issues", "system_admin")
_NEW = (
    "create_space",
    "manage_users",
    "manage_groups",
    "manage_issues",
    "customize_profile_welcome",
    "system_admin",
)


def _replace_permission_check(values: tuple[str, ...]) -> None:
    """Drop existing CHECK(s) on group_global_permissions.permission and recreate."""
    op.execute(
        """
        DO $$
        DECLARE c record;
        BEGIN
          FOR c IN
            SELECT conname FROM pg_constraint
            WHERE conrelid = 'group_global_permissions'::regclass AND contype = 'c'
          LOOP
            EXECUTE format('ALTER TABLE group_global_permissions DROP CONSTRAINT %I', c.conname);
          END LOOP;
        END $$;
        """
    )
    listed = ", ".join(f"'{value}'" for value in values)
    op.execute(
        f"ALTER TABLE group_global_permissions ADD CONSTRAINT {_CONSTRAINT} "
        f"CHECK (permission IN ({listed}))"
    )


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("welcome_effect", sa.String(length=32), nullable=False, server_default=""),
    )
    op.add_column(
        "users",
        sa.Column("welcome_message", sa.String(length=140), nullable=False, server_default=""),
    )
    _replace_permission_check(_NEW)


def downgrade() -> None:
    op.execute(
        "DELETE FROM group_global_permissions WHERE permission = 'customize_profile_welcome'"
    )
    op.execute(
        "DELETE FROM user_global_permission_overrides WHERE permission = 'customize_profile_welcome'"
    )
    _replace_permission_check(_OLD)
    op.drop_column("users", "welcome_message")
    op.drop_column("users", "welcome_effect")
