"""add max_upload_size_mb to spaces so one space can raise or lower the attachment ceiling

The attachment size limit was workspace-wide: a space holding screen recordings
and a space holding meeting notes had to share one number, so raising it for the
former raised it everywhere. NULL keeps a space on the workspace value, which is
what every existing row wants.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_0003"
down_revision: str | None = "20260828_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("spaces", sa.Column("max_upload_size_mb", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("spaces", "max_upload_size_mb")
