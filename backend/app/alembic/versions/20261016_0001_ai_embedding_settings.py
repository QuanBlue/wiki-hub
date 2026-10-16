"""semantic search settings become one wiki-wide row, not a field of each AI connection

The embedding model used to be saved on each AI connection, so switching the active
chat provider would silently change the embedding source. It now lives in one place
(``ai_embedding_settings``) with its own optional endpoint and key, and may point at a
self-hosted Ollama. An embedding model already saved on the active connection is
carried over as "use the active provider" so nothing is lost or re-indexed.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261016_0001"
down_revision: str | None = "20261015_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_embedding_settings",
        sa.Column("id", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("source", sa.String(16), server_default="provider", nullable=False),
        sa.Column("base_url", sa.String(500), server_default="", nullable=False),
        sa.Column("api_key_encrypted", sa.Text(), server_default="", nullable=False),
        sa.Column("api_key_preview", sa.String(40), server_default="", nullable=False),
        sa.Column("model", sa.String(255), server_default="", nullable=False),
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
        sa.CheckConstraint("id = 1", name="ck_ai_embedding_settings_singleton"),
        sa.ForeignKeyConstraint(
            ["updated_by_id"],
            ["users.id"],
            name=op.f("fk_ai_embedding_settings_updated_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_embedding_settings")),
    )
    op.execute(
        """
        INSERT INTO ai_embedding_settings (id, source, model, updated_by_id)
        SELECT 1, 'provider', embedding_model, updated_by_id
        FROM ai_connections
        WHERE is_active AND embedding_model <> ''
        LIMIT 1
        """
    )
    op.drop_column("ai_connections", "embedding_model")


def downgrade() -> None:
    op.add_column(
        "ai_connections",
        sa.Column("embedding_model", sa.String(255), server_default="", nullable=False),
    )
    op.execute(
        """
        UPDATE ai_connections SET embedding_model = s.model
        FROM ai_embedding_settings s
        WHERE ai_connections.is_active AND s.source = 'provider'
        """
    )
    op.drop_table("ai_embedding_settings")
