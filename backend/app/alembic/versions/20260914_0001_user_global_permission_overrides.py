"""add user_global_permission_overrides for per-user grant/deny beating groups"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260914_0001"
down_revision: str | None = "20260913_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(name: str, *values: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=False)


def upgrade() -> None:
    # `create_constraint=False`: the CHECK constraint for this exact set of
    # values already exists on `group_global_permissions.permission` (native
    # PostgreSQL enums aren't used here - see `_enum_column` in
    # app/models/permission.py) - `native_enum=False` makes this a plain
    # VARCHAR either way, so no type to share or duplicate.
    op.create_table(
        "user_global_permission_overrides",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column(
            "permission",
            _enum(
                "global_permission",
                "create_space",
                "manage_users",
                "manage_groups",
                "system_admin",
            ),
            nullable=False,
        ),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "permission"),
    )


def downgrade() -> None:
    op.drop_table("user_global_permission_overrides")
