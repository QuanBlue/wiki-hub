"""document imports: an optional translation of each page

``document_import_jobs.translate_to`` records the language the person asked for;
``document_import_items.translation`` holds what the translation did, for the progress card.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261020_0001"
down_revision: str | None = "20261019_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("document_import_jobs", sa.Column("translate_to", sa.String(8), nullable=True))
    op.add_column(
        "document_import_items",
        sa.Column("translation", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("document_import_items", "translation")
    op.drop_column("document_import_jobs", "translate_to")
