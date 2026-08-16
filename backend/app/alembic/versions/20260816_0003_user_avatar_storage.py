"""Store object-storage metadata for uploaded user avatars."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260816_0003"
down_revision: tuple[str, str] = ("0022_page_drafts", "b82c402c2158")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_object_key", sa.String(length=512), nullable=True))
    op.add_column("users", sa.Column("avatar_content_type", sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_content_type")
    op.drop_column("users", "avatar_object_key")
