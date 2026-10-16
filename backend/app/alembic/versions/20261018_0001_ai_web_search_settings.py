"""the chat may look things up on the internet: one wiki-wide setting, off by default

``ai_web_search_settings`` holds whether web search is on, which search service is used and
its (encrypted) key.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261018_0001"
down_revision: str | None = "20261017_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_web_search_settings",
        sa.Column("id", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("provider", sa.String(16), server_default="tavily", nullable=False),
        sa.Column("api_key_encrypted", sa.Text(), server_default="", nullable=False),
        sa.Column("api_key_preview", sa.String(40), server_default="", nullable=False),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("id = 1", name="ck_ai_web_search_settings_singleton"),
        sa.ForeignKeyConstraint(
            ["updated_by_id"],
            ["users.id"],
            name=op.f("fk_ai_web_search_settings_updated_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_web_search_settings")),
    )


def downgrade() -> None:
    op.drop_table("ai_web_search_settings")
