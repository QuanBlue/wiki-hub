"""hybrid (full-text + trigram) page search and semantic-search tables

Nothing here can cost data or stop the app from starting: every extension is
created inside a guarded block, and whatever cannot be created is skipped. The
search service checks what exists and falls back to plain substring search, so
a database without ``pgvector`` simply has semantic search switched off.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.modules.search import ddl

revision: str = "20261014_0002"
down_revision: str | None = "20261014_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _try_extension(name: str) -> None:
    op.execute(
        f"""
        DO $$ BEGIN
            CREATE EXTENSION IF NOT EXISTS {name};
        EXCEPTION WHEN others THEN
            RAISE NOTICE 'extension {name} unavailable: %', SQLERRM;
        END $$;
        """
    )


def _extension_schema(name: str) -> str | None:
    return (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT n.nspname FROM pg_extension e "
                "JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = :name"
            ),
            {"name": name},
        )
        .scalar()
    )


def upgrade() -> None:
    op.add_column(
        "ai_connections",
        sa.Column("embedding_model", sa.String(255), server_default="", nullable=False),
    )

    for extension in ("unaccent", "pg_trgm", "vector"):
        _try_extension(extension)

    unaccent_schema = _extension_schema("unaccent")
    if unaccent_schema and _extension_schema("pg_trgm"):
        for statement in ddl.functions_sql(unaccent_schema):
            op.execute(statement)
        for statement in ddl.INDEX_STATEMENTS:
            op.execute(statement)

    if _extension_schema("vector"):
        for statement in ddl.SEMANTIC_TABLE_STATEMENTS:
            op.execute(statement)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS page_chunks")
    op.execute("DROP TABLE IF EXISTS page_search_state")
    op.execute("DROP INDEX IF EXISTS ix_pages_title_trgm")
    op.execute("DROP INDEX IF EXISTS ix_pages_search_vector")
    for function in (
        "wh_search_vector(text, text)",
        "wh_title_key(text)",
        "wh_plain_text(text)",
        "wh_unaccent(text)",
    ):
        op.execute(f"DROP FUNCTION IF EXISTS {function}")
    op.drop_column("ai_connections", "embedding_model")
