"""keep each page's search vector in a stored column (faster, ranked keyword search)

The vector was an expression index, which let a query *find* pages quickly but
made *ranking* them re-parse the full text of every match. As a stored column it
is computed once per write. Adding it rewrites ``pages`` once.

Skipped when the search functions were never created (no ``unaccent`` / ``pg_trgm``
in this database): search then falls back to plain substring matching, as before.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.modules.search import ddl

revision: str = "20261015_0001"
down_revision: str | None = "20261014_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_search_functions() -> bool:
    return bool(
        op.get_bind().execute(sa.text("SELECT to_regprocedure('wh_search_vector(text, text)')")).scalar()
    )


def upgrade() -> None:
    if not _has_search_functions():
        return
    for statement in ddl.STORED_VECTOR_STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_pages_search_vector_col")
    op.execute("ALTER TABLE pages DROP COLUMN IF EXISTS search_vector")
    if _has_search_functions():
        op.execute(ddl.INDEX_STATEMENTS[0])
