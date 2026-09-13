"""add space_owners table for multi-owner spaces, mirroring group_owners"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260913_0001"
down_revision: str | None = "20260912_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "space_owners",
        sa.Column("space_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(["space_id"], ["spaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("space_id", "user_id"),
        sa.UniqueConstraint("space_id", "user_id", name="uq_space_owners_space_user"),
    )

    # Backfill, same idea as group_owners seeding from Group.owner_id: a
    # space created before this feature existed still needs a resolvable
    # owner. Preference order, each step skipping spaces the previous one
    # already covered:
    #   1. The space's creator, if their account is still active.
    #   2. Anyone currently holding a direct 'admin' grant (every one of
    #      them, not just one - demoting existing admins to "just Admin"
    #      by picking a single winner would be a silent capability loss).
    #   3. Anyone holding the legacy SpaceMember.role == 'admin'.
    # A space matching none of these (e.g. its creator was removed and no
    # admin grant survived) is left ownerless - the same state a factory
    # dev/test database starts in - rather than guessing.
    connection = op.get_bind()
    connection.execute(
        sa.text(
            "INSERT INTO space_owners (space_id, user_id) "
            "SELECT s.id, s.created_by_id FROM spaces s "
            "JOIN users u ON u.id = s.created_by_id "
            "WHERE u.is_active = true "
            "ON CONFLICT DO NOTHING"
        )
    )
    connection.execute(
        sa.text(
            "INSERT INTO space_owners (space_id, user_id) "
            "SELECT sup.space_id, sup.user_id FROM space_user_permissions sup "
            "JOIN users u ON u.id = sup.user_id "
            "WHERE sup.permission = 'admin' AND u.is_active = true "
            "AND sup.space_id NOT IN (SELECT space_id FROM space_owners) "
            "ON CONFLICT DO NOTHING"
        )
    )
    connection.execute(
        sa.text(
            "INSERT INTO space_owners (space_id, user_id) "
            "SELECT sm.space_id, sm.user_id FROM space_members sm "
            "JOIN users u ON u.id = sm.user_id "
            "WHERE sm.role = 'admin' AND u.is_active = true "
            "AND sm.space_id NOT IN (SELECT space_id FROM space_owners) "
            "ON CONFLICT DO NOTHING"
        )
    )


def downgrade() -> None:
    op.drop_table("space_owners")
