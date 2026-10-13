"""ai connections (several saved gateways, one active) replacing ai_settings"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261013_0002"
down_revision: str | None = "20261013_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_connections",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("base_url", sa.String(500), nullable=False),
        sa.Column("model", sa.String(255), nullable=False),
        sa.Column("api_key_encrypted", sa.Text(), nullable=False),
        sa.Column("api_key_preview", sa.String(40), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("last_checked_at", sa.DateTime(timezone=True)),
        sa.Column("last_check_ok", sa.Boolean()),
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
        sa.ForeignKeyConstraint(
            ["updated_by_id"],
            ["users.id"],
            name=op.f("fk_ai_connections_updated_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_connections")),
    )
    op.create_index(
        "uq_ai_connections_one_active",
        "ai_connections",
        ["is_active"],
        unique=True,
        postgresql_where=sa.text("is_active"),
    )
    # Carry over a connection saved on the single-settings screen, if any. Its
    # key was encrypted the same way; the preview can only be recomputed when
    # the key is replaced, so it shows as hidden until then.
    op.execute(
        """
        INSERT INTO ai_connections
            (id, name, base_url, model, api_key_encrypted, api_key_preview,
             is_active, updated_by_id)
        SELECT gen_random_uuid(), 'Default', base_url, COALESCE(model, ''),
               api_key_encrypted, '****', enabled, updated_by_id
        FROM ai_settings
        WHERE base_url IS NOT NULL AND api_key_encrypted IS NOT NULL
        """
    )
    op.drop_table("ai_settings")


def downgrade() -> None:
    op.create_table(
        "ai_settings",
        sa.Column("id", sa.SmallInteger(), autoincrement=False, nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("base_url", sa.String(500)),
        sa.Column("model", sa.String(255)),
        sa.Column("api_key_encrypted", sa.Text()),
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
        sa.CheckConstraint("id = 1", name=op.f("ck_ai_settings_singleton")),
        sa.ForeignKeyConstraint(
            ["updated_by_id"],
            ["users.id"],
            name=op.f("fk_ai_settings_updated_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_settings")),
    )
    op.drop_index("uq_ai_connections_one_active", table_name="ai_connections")
    op.drop_table("ai_connections")
