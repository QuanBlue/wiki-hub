"""document imports: an optional review of each page against its source file

``document_import_jobs.ai_review`` records that the person asked for it;
``document_import_items.review`` holds what the review found and did, for the progress card and
the admin log.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261019_0001"
down_revision: str | None = "20261018_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "document_import_jobs",
        sa.Column("ai_review", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "document_import_items",
        sa.Column("review", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("document_import_items", "review")
    op.drop_column("document_import_jobs", "ai_review")
