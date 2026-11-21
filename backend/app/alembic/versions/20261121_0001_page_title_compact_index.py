"""index page titles squashed to letters and digits, for names typed any way

Quick search now also finds a page whose title holds the query once both are squashed
("DMS10" or "dms_1" for "dms1.0 overview"), which the word index cannot: it splits
"dms1.0" into "dms1" and "0". A trigram index on that expression keeps the
``LIKE '%dms10%'`` it runs off a full scan of every title.

Revision ID: 20261121_0001
Revises: 20261119_0002
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.modules.search import ddl

revision: str = "20261121_0001"
down_revision: str | None = "20261119_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    has_title_key = bind.execute(sa.text("SELECT to_regprocedure('wh_title_key(text)')")).scalar()
    has_trgm = bind.execute(
        sa.text("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")
    ).scalar()
    if not has_title_key or not has_trgm:
        return  # search was never set up in this database: the query falls back by itself
    for statement in ddl.COMPACT_TITLE_INDEX_STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_pages_title_compact_trgm")
