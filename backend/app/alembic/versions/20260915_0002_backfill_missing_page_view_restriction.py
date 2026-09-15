"""backfill missing view allow-list row for principals holding edit

Same rule as `20260915_0001_backfill_missing_view_permission` for space
permissions: every other permission is useless without View, and
`PermissionService.set_page_restriction` now enforces that going forward
for page-level Edit too. This backfills pre-existing allow-list rows
(`denied=False`) that already grant Edit on a page but were never given
View directly.

Denied (block) rows are untouched - a block is the opposite of a grant, and
`_has_other_page_restriction` on the backend already excludes them from
this same check.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260915_0002"
down_revision: str | None = "20260915_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text(
            "INSERT INTO page_user_restrictions (page_id, user_id, permission, denied) "
            "SELECT DISTINCT page_id, user_id, 'view', false FROM page_user_restrictions "
            "WHERE permission = 'edit' AND denied = false "
            "ON CONFLICT DO NOTHING"
        )
    )
    connection.execute(
        sa.text(
            "INSERT INTO page_group_restrictions (page_id, group_id, permission, denied) "
            "SELECT DISTINCT page_id, group_id, 'view', false FROM page_group_restrictions "
            "WHERE permission = 'edit' AND denied = false "
            "ON CONFLICT DO NOTHING"
        )
    )


def downgrade() -> None:
    # Backfilled data only; there is nothing safe to reverse without risking
    # dropping a View grant a Space administrator relies on.
    pass
