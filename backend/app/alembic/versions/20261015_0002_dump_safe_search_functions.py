"""search helper functions as SQL-standard bodies, so a database dump restores

The functions behind ``pages.search_vector`` were created with quoted bodies,
which record no dependency on the functions they call. ``pg_dump`` could then
write them in an order in which ``pg_restore`` fails to create ``pages`` itself.
Re-creating them with ``BEGIN ATOMIC`` bodies (same behaviour) fixes the order.

Nothing is rewritten: the column, its values and its index are untouched.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.modules.search import ddl

revision: str = "20261015_0002"
down_revision: str | None = "20261015_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _unaccent_schema() -> str | None:
    return (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT n.nspname FROM pg_extension e "
                "JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'unaccent'"
            )
        )
        .scalar()
    )


def upgrade() -> None:
    schema = _unaccent_schema()
    has_functions = (
        op.get_bind()
        .execute(sa.text("SELECT to_regprocedure('wh_search_vector(text, text)')"))
        .scalar()
    )
    if not schema or not has_functions:
        return  # search was never set up in this database
    for statement in ddl.functions_sql(schema):
        op.execute(statement)


def downgrade() -> None:
    """Nothing to undo: the old and new bodies behave the same."""
