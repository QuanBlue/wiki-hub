"""attached files: the words inside them, for search and the AI assistant

``attachment_texts`` holds what the worker read from each file attached to a page (Word,
Excel, HTML, PDF...). Where the search functions exist it gets a ``search_vector`` like
``pages``; where semantic search exists, ``page_chunks`` learns which file a passage came
from. Derived data: emptied, it is rebuilt by the worker.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.modules.search import ddl

revision: str = "20261025_0001"
down_revision: str | None = "20261024_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _exists(query: str) -> bool:
    return bool(op.get_bind().execute(sa.text(query)).scalar())


def upgrade() -> None:
    op.create_table(
        "attachment_texts",
        sa.Column(
            "attachment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("page_attachments.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "page_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("pages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("signature", sa.String(length=320), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("content", sa.Text(), server_default="", nullable=False),
        sa.Column("detail", sa.String(length=500), server_default="", nullable=False),
        sa.Column("chars", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "extracted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_attachment_texts_page_id", "attachment_texts", ["page_id"])
    if _exists("SELECT to_regprocedure('wh_search_vector(text, text)') IS NOT NULL"):
        for statement in ddl.ATTACHMENT_VECTOR_STATEMENTS:
            op.execute(statement)
    if _exists("SELECT to_regclass('page_chunks') IS NOT NULL"):
        for statement in ddl.ATTACHMENT_CHUNK_STATEMENTS:
            op.execute(statement)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_page_chunks_attachment_id")
    op.execute("ALTER TABLE IF EXISTS page_chunks DROP COLUMN IF EXISTS attachment_id")
    op.drop_index("ix_attachment_texts_page_id", table_name="attachment_texts")
    op.drop_table("attachment_texts")
