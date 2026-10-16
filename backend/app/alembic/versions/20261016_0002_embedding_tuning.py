"""tuning overrides for semantic search and the self-hosted Ollama, editable in the admin UI

Every column is nullable: ``NULL`` keeps the built-in default, so existing installs
behave exactly as before until an administrator changes something.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261016_0002"
down_revision: str | None = "20261016_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS: tuple[tuple[str, sa.types.TypeEngine], ...] = (
    ("index_batch", sa.Integer()),
    ("embed_batch_size", sa.Integer()),
    ("max_chunks_per_page", sa.Integer()),
    ("embed_timeout_seconds", sa.Float()),
    ("query_timeout_seconds", sa.Float()),
    ("min_similarity", sa.Float()),
    ("margin", sa.Float()),
    ("ollama_memory_gb", sa.Float()),
    ("ollama_cpus", sa.Integer()),
    ("ollama_keep_alive", sa.String(8)),
)


def upgrade() -> None:
    for name, kind in COLUMNS:
        op.add_column("ai_embedding_settings", sa.Column(name, kind, nullable=True))


def downgrade() -> None:
    for name, _ in reversed(COLUMNS):
        op.drop_column("ai_embedding_settings", name)
