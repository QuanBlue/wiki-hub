"""add groups and additive global/space permissions"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018_groups_and_permissions"
down_revision: str | None = "b82c402c2158"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(name: str, *values: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True)


def upgrade() -> None:
    op.add_column(
        "spaces",
        sa.Column(
            "visibility",
            _enum("space_visibility", "open", "restricted"),
            nullable=False,
            server_default="open",
        ),
    )

    op.create_table(
        "groups",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_groups_name"),
    )
    op.create_table(
        "group_members",
        sa.Column("group_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("group_id", "user_id"),
        sa.UniqueConstraint("group_id", "user_id", name="uq_group_members_group_user"),
    )
    op.create_table(
        "group_global_permissions",
        sa.Column("group_id", sa.UUID(), nullable=False),
        sa.Column(
            "permission",
            _enum(
                "global_permission", "create_space", "manage_users", "manage_groups", "system_admin"
            ),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("group_id", "permission"),
    )
    space_permissions = _enum(
        "space_permission",
        "view",
        "add",
        "delete",
        "delete_own",
        "restrictions",
        "export",
        "admin",
    )
    op.create_table(
        "space_user_permissions",
        sa.Column("space_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("permission", space_permissions, nullable=False),
        sa.ForeignKeyConstraint(["space_id"], ["spaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("space_id", "user_id", "permission"),
    )
    op.create_table(
        "space_group_permissions",
        sa.Column("space_id", sa.UUID(), nullable=False),
        sa.Column("group_id", sa.UUID(), nullable=False),
        sa.Column(
            "permission",
            _enum(
                "space_group_permission",
                "view",
                "add",
                "delete",
                "delete_own",
                "restrictions",
                "export",
                "admin",
            ),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["space_id"], ["spaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("space_id", "group_id", "permission"),
    )

    # Preserve the existing direct role assignments as additive permissions.
    connection = op.get_bind()
    rows = connection.execute(
        sa.text("SELECT space_id, user_id, role FROM space_members")
    ).mappings()
    permission_map = {
        "viewer": ("view",),
        "editor": ("view", "add"),
        "admin": ("view", "add", "delete", "delete_own", "restrictions", "export", "admin"),
    }
    for row in rows:
        for permission in permission_map.get(row["role"], ("view",)):
            connection.execute(
                sa.text(
                    "INSERT INTO space_user_permissions (space_id, user_id, permission) "
                    "VALUES (:space_id, :user_id, :permission) ON CONFLICT DO NOTHING"
                ),
                {"space_id": row["space_id"], "user_id": row["user_id"], "permission": permission},
            )


def downgrade() -> None:
    op.drop_table("space_group_permissions")
    op.drop_table("space_user_permissions")
    op.drop_table("group_global_permissions")
    op.drop_table("group_members")
    op.drop_table("groups")
    op.drop_column("spaces", "visibility")
