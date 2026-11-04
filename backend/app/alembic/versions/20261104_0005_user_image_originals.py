"""users: keep the uncropped avatar/cover and its crop so it can be repositioned

Revision ID: 20261104_0005
Revises: 20261104_0004
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261104_0005"
down_revision: str | None = "20261104_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_COLUMNS = (
    ("avatar_original_key", sa.String(length=512)),
    ("avatar_original_content_type", sa.String(length=100)),
    ("avatar_crop", sa.JSON()),
    ("cover_original_key", sa.String(length=512)),
    ("cover_original_content_type", sa.String(length=100)),
    ("cover_crop", sa.JSON()),
)


def upgrade() -> None:
    for name, type_ in _COLUMNS:
        op.add_column("users", sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    for name, _ in reversed(_COLUMNS):
        op.drop_column("users", name)
