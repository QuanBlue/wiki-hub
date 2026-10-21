"""knowledge graph: how pages relate, and the knobs that bring related pages into answers

``page_links`` holds the edges worked out from what pages already say (links,
mentions of another page's title, similar meaning); ``page_graph_state`` records
what each page's edges were worked out from, so the builder knows what is stale.
Both are derived data: an empty table is rebuilt by the worker.

The two new tuning columns are nullable like the others: ``NULL`` keeps the
built-in default (two related pages per answer; 0 turns it off).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261023_0001"
down_revision: str | None = "20261022_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TUNING_COLUMNS: tuple[tuple[str, sa.types.TypeEngine], ...] = (
    ("graph_related_pages", sa.Integer()),
    ("graph_min_similarity", sa.Float()),
)


def upgrade() -> None:
    op.create_table(
        "page_links",
        sa.Column("source_page_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("target_page_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("weight", sa.Float(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("source_page_id <> target_page_id", name=op.f("ck_page_links_not_self")),
        sa.CheckConstraint(
            "kind IN ('link', 'mention', 'similar')", name=op.f("ck_page_links_kind")
        ),
        sa.ForeignKeyConstraint(
            ["source_page_id"],
            ["pages.id"],
            name=op.f("fk_page_links_source_page_id_pages"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["target_page_id"],
            ["pages.id"],
            name=op.f("fk_page_links_target_page_id_pages"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "source_page_id", "target_page_id", "kind", name=op.f("pk_page_links")
        ),
    )
    op.create_index("ix_page_links_target_page_id", "page_links", ["target_page_id"])

    op.create_table(
        "page_graph_state",
        sa.Column("page_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("similar_indexed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["page_id"],
            ["pages.id"],
            name=op.f("fk_page_graph_state_page_id_pages"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("page_id", name=op.f("pk_page_graph_state")),
    )

    for name, kind in TUNING_COLUMNS:
        op.add_column("ai_embedding_settings", sa.Column(name, kind, nullable=True))


def downgrade() -> None:
    for name, _ in reversed(TUNING_COLUMNS):
        op.drop_column("ai_embedding_settings", name)
    op.drop_table("page_graph_state")
    op.drop_index("ix_page_links_target_page_id", table_name="page_links")
    op.drop_table("page_links")
