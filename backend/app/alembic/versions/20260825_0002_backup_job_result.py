"""add result to backup_jobs so a completed restore's report survives past the request

`ImportReport` (created/skipped/errors counts, conflicting_space_keys,
users_without_password, ...) used to be returned directly in the HTTP response
of the old synchronous `/backup/import-zip` call. Restore is becoming a
durable background job like export already is, so there is no longer a
response to hand it back in - the frontend has to read it after the fact from
the job row instead.

Deliberately a separate column from `counters`: `counters` stays a live,
throttled *progress* signal (`items_total`/`items_processed`) written many
times while a job runs, exactly as export already uses it. `result` is
write-once, only set when the job reaches `complete`, and holds a much richer
structure than `dict[str, int]` - conflating the two would either force
progress updates to carry the growing report around on every checkpoint, or
force the report into an integer-only shape it doesn't fit.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260825_0002"
down_revision: str | None = "20260825_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "backup_jobs",
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("backup_jobs", "result")
