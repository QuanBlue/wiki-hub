"""add heartbeat_at to import_jobs so an orphaned Confluence import can be detected

The same hole `20260825_0001` closed for `backup_jobs`, still open here. An
import row saying "running" only means some worker once started it; if that
worker dies (crash, container restart, `arq --watch` reload) nothing moves the
row out of "running". Cancelling a *running* import works by setting
`cancel_requested` and waiting for the worker loop to observe it, so with no
worker left the operator gets a progress bar that never advances and a Cancel
button that writes "the current import step will stop shortly" and then does
nothing at all, forever.

`backup_jobs` and `document_import_jobs` both already carry a heartbeat and
both are swept by `reap_backup_jobs`; `import_jobs` was the one job table with
neither, which is why a dead Confluence import had nothing that could ever
finish it.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_0002"
down_revision: str | None = "20260828_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "import_jobs",
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Existing "running" rows predate heartbeats and cannot be alive - this
    # migration runs while the stack is being deployed, so every worker that
    # could have owned one is already gone. Leaving them running would keep an
    # unclearable progress bar in front of the operator, which is the very
    # thing this column exists to end.
    op.execute(
        """
        UPDATE import_jobs
           SET status = CASE WHEN cancel_requested THEN 'cancelled' ELSE 'failed' END,
               phase  = CASE WHEN cancel_requested THEN 'cancelled' ELSE 'failed' END,
               error  = CASE
                          WHEN cancel_requested THEN error
                          ELSE 'The import worker stopped before this job finished.'
                        END
         WHERE status = 'running'
        """
    )


def downgrade() -> None:
    op.drop_column("import_jobs", "heartbeat_at")
