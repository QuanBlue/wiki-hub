"""Track attachment versions used by ONLYOFFICE document keys."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_0001"
down_revision: str | None = "20260827_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "page_attachments",
        sa.Column("office_revision", sa.Integer(), nullable=False, server_default="1"),
    )
    op.alter_column("page_attachments", "office_revision", server_default=None)


def downgrade() -> None:
    op.drop_column("page_attachments", "office_revision")
