"""add the 'move' space permission (moving a page is now its own grant, not implied by Add/Edit)"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260912_0001"
down_revision: str | None = "20260904_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_VALUES = ("view", "add", "delete", "delete_own", "restrictions", "export", "admin")
_NEW_VALUES = (*_OLD_VALUES, "move")

# Raw SQL rather than `op.drop_constraint`/`create_check_constraint`: those
# resolve the name they're given through `target_metadata`'s own naming
# convention (see app/alembic/env.py), which re-wraps an already fully
# qualified name like "ck_space_user_permissions_space_permission" a second
# time into a hashed, truncated mess. Plain DDL uses the name exactly as
# written, matching what `pg_constraint` actually holds.
_CONSTRAINTS = (
    ("space_user_permissions", "ck_space_user_permissions_space_permission"),
    ("space_group_permissions", "ck_space_group_permissions_space_group_permission"),
)


def _check(values: Sequence[str]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"permission IN ({quoted})"


def _replace_constraints(values: Sequence[str]) -> None:
    condition = _check(values)
    for table, name in _CONSTRAINTS:
        op.execute(sa.text(f"ALTER TABLE {table} DROP CONSTRAINT {name}"))
        op.execute(sa.text(f"ALTER TABLE {table} ADD CONSTRAINT {name} CHECK ({condition})"))


def upgrade() -> None:
    _replace_constraints(_NEW_VALUES)

    # `move` is new, so nobody's existing rows carry it - a principal who
    # already holds Admin (and so already has every other permission) would
    # otherwise come out the other side of this migration missing the one
    # capability that didn't exist yet when they were granted Admin. Mirrors
    # migration 20260824_0002's own role -> permission backfill.
    connection = op.get_bind()
    for table, id_column in (
        ("space_user_permissions", "user_id"),
        ("space_group_permissions", "group_id"),
    ):
        admins = connection.execute(
            sa.text(f"SELECT space_id, {id_column} AS principal_id FROM {table} WHERE permission = 'admin'")
        ).mappings()
        for row in admins:
            connection.execute(
                sa.text(
                    f"INSERT INTO {table} (space_id, {id_column}, permission) "
                    f"VALUES (:space_id, :principal_id, 'move') ON CONFLICT DO NOTHING"
                ),
                {"space_id": row["space_id"], "principal_id": row["principal_id"]},
            )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM space_user_permissions WHERE permission = 'move'"))
    op.execute(sa.text("DELETE FROM space_group_permissions WHERE permission = 'move'"))
    _replace_constraints(_OLD_VALUES)
