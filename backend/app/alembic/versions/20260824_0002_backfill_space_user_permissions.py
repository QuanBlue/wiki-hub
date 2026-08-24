"""backfill space_user_permissions from space_members

The Confluence importer (and the legacy `/spaces/{key}/members` endpoint)
only ever wrote to `space_members`. `PermissionService.effective_permissions`
and the Admin > Space > Access screen read `space_user_permissions`
instead, so users granted access that way ended up with no real access and
were invisible in the Access screen. This mirrors the same role -> permission
expansion migration 0018 used when it first introduced the additive model.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824_0002"
down_revision: str | None = "20260824_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ROLE_PERMISSIONS: dict[str, tuple[str, ...]] = {
    "viewer": ("view",),
    "editor": ("view", "add"),
    "admin": ("view", "add", "delete", "delete_own", "restrictions", "export", "admin"),
}


def upgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(
        sa.text("SELECT space_id, user_id, role FROM space_members")
    ).mappings()
    for row in rows:
        for permission in ROLE_PERMISSIONS.get(row["role"], ("view",)):
            connection.execute(
                sa.text(
                    "INSERT INTO space_user_permissions (space_id, user_id, permission) "
                    "VALUES (:space_id, :user_id, :permission) ON CONFLICT DO NOTHING"
                ),
                {"space_id": row["space_id"], "user_id": row["user_id"], "permission": permission},
            )


def downgrade() -> None:
    # Backfilled data only; there is nothing safe to reverse without risking
    # dropping permissions a Space administrator granted by hand afterwards.
    pass
