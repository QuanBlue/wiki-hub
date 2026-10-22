"""content health: pages confirmed still correct, and questions the wiki could not answer

``page_reviews`` records that a space administrator read a page flagged as possibly out of
date and found it still right. ``ai_question_gaps`` keeps the questions the AI assistant
found no answer to in the pages (or whose answer was marked unhelpful), with who asked, for
Administration > AI assistant; rows are removed after 90 days. ``site_settings`` gains the
switch that turns that recording off (NULL = on).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261027_0001"
down_revision: str | None = "20261026_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "page_reviews",
        sa.Column("page_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "reviewed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("reviewed_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["page_id"],
            ["pages.id"],
            name=op.f("fk_page_reviews_page_id_pages"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by_id"],
            ["users.id"],
            name=op.f("fk_page_reviews_reviewed_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("page_id", name=op.f("pk_page_reviews")),
    )

    op.create_table(
        "ai_question_gaps",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("standalone", sa.Text(), nullable=True),
        sa.Column("group_key", sa.String(length=32), nullable=False),
        sa.Column("surface", sa.String(length=8), nullable=False),
        sa.Column("reason", sa.String(length=16), nullable=False),
        sa.Column(
            "near_page_ids",
            postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("answer_excerpt", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resolution", sa.String(length=16), nullable=True),
        sa.Column("answer_page_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_ai_question_gaps_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["resolved_by_id"],
            ["users.id"],
            name=op.f("fk_ai_question_gaps_resolved_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["answer_page_id"],
            ["pages.id"],
            name=op.f("fk_ai_question_gaps_answer_page_id_pages"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_question_gaps")),
    )
    op.create_index(
        "ix_ai_question_gaps_group_key", "ai_question_gaps", ["group_key", "resolved_at"]
    )
    op.create_index("ix_ai_question_gaps_created_at", "ai_question_gaps", ["created_at"])

    op.add_column(
        "site_settings", sa.Column("record_unanswered_questions", sa.Boolean(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("site_settings", "record_unanswered_questions")
    op.drop_index("ix_ai_question_gaps_created_at", table_name="ai_question_gaps")
    op.drop_index("ix_ai_question_gaps_group_key", table_name="ai_question_gaps")
    op.drop_table("ai_question_gaps")
    op.drop_table("page_reviews")
