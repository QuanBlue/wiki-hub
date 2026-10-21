"""semantic search: an administrator can pause indexing and resume it later

Pausing frees the server's CPU and memory while pages are being embedded; the backlog
waits, and indexing carries on from where it stopped once resumed.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261024_0001"
down_revision: str | None = "20261023_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ai_embedding_settings",
        sa.Column("indexing_paused", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("ai_embedding_settings", "indexing_paused")
