"""backfill missing view permission for principals holding another one

Every other space permission is useless without View, and
`PermissionService.set_space_permission` now enforces that going forward
(granting anything else implicitly grants View, and View can't be removed
while a sibling permission remains) - see the Admin > Space > Access
checkbox matrix, where View is a non-interactive "always on" indicator for
that same reason. This backfills the handful of pre-existing rows that
predate that rule: any (space, principal) pair that already holds some
other `space_user_permissions`/`space_group_permissions` grant but was
never given `view` directly (e.g. an administrator unchecked View by hand
before this rule existed, leaving Add/Delete/etc. checked but functionally
unreachable).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260915_0001"
down_revision: str | None = "20260914_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text(
            "INSERT INTO space_user_permissions (space_id, user_id, permission) "
            "SELECT DISTINCT space_id, user_id, 'view' FROM space_user_permissions "
            "WHERE permission != 'view' "
            "ON CONFLICT DO NOTHING"
        )
    )
    connection.execute(
        sa.text(
            "INSERT INTO space_group_permissions (space_id, group_id, permission) "
            "SELECT DISTINCT space_id, group_id, 'view' FROM space_group_permissions "
            "WHERE permission != 'view' "
            "ON CONFLICT DO NOTHING"
        )
    )


def downgrade() -> None:
    # Backfilled data only; there is nothing safe to reverse without risking
    # dropping a View grant a Space administrator relies on.
    pass
