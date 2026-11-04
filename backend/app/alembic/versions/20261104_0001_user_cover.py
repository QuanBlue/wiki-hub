"""Store uploaded member profile covers."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261104_0001"
down_revision: str = "20261102_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("cover_url", sa.String(length=2048), nullable=True))
    op.add_column("users", sa.Column("cover_object_key", sa.String(length=512), nullable=True))
    op.add_column("users", sa.Column("cover_content_type", sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "cover_content_type")
    op.drop_column("users", "cover_object_key")
    op.drop_column("users", "cover_url")
