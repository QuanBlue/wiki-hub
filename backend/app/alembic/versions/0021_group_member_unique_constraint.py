"""restore the explicit group membership uniqueness constraint"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "0021_group_member_unique"
down_revision: str | None = "0020_invalid_import_actor_labels"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    exists = bind.execute(
        text(
            "SELECT 1 FROM pg_constraint "
            "WHERE conrelid = 'group_members'::regclass "
            "AND conname = 'uq_group_members_group_user'"
        )
    ).scalar()
    if not exists:
        op.create_unique_constraint(
            "uq_group_members_group_user", "group_members", ["group_id", "user_id"]
        )


def downgrade() -> None:
    op.drop_constraint("uq_group_members_group_user", "group_members", type_="unique")
