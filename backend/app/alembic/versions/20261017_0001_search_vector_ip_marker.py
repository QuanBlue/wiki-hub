"""mark pages that contain an IP address in the search vector

"ip of the DMS system" asks for pages that list addresses, but the text parser splits
``10.10.10.64`` into digits, so no page ever matched the word "ip". The search vector now
carries a marker word for every page with an IPv4 address in it, and the query side treats
"ip" as that marker too.

``pages.search_vector`` is a generated column, so a new function body only applies to
rows written afterwards: the column is dropped and added again, which recomputes every
page once (a few milliseconds each) and rebuilds its index.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.modules.search import ddl

revision: str = "20261017_0001"
down_revision: str | None = "20261016_0002"
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
    op.execute("ALTER TABLE pages DROP COLUMN IF EXISTS search_vector")
    for statement in ddl.functions_sql(schema):
        op.execute(statement)
    for statement in ddl.STORED_VECTOR_STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    """Nothing to undo: the marker word is harmless to the previous search code."""
