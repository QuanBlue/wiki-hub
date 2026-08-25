"""add heartbeat_at to backup_jobs so an orphaned running job can be detected

A job row saying "running" only means some worker once started it. If that
worker dies (crash, container restart, `arq --watch` reload), nothing ever
moves the row out of "running" - the admin UI then shows a progress bar that
spins forever and Cancel appears to do nothing, because cancellation for a
running job relies on the worker observing `cancel_requested`.

The worker now stamps `heartbeat_at` as it works, which makes "is anyone
actually running this?" an answerable question.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260825_0001"
down_revision: str | None = "20260824_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "backup_jobs",
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Existing "running" rows predate heartbeats and cannot be alive: this
    # migration runs while the stack is being deployed. Leaving them running
    # would keep an unclearable progress bar in front of the operator.
    op.execute(
        """
        UPDATE backup_jobs
           SET status = CASE WHEN cancel_requested THEN 'cancelled' ELSE 'failed' END,
               phase  = CASE WHEN cancel_requested THEN 'cancelled' ELSE 'failed' END,
               error  = CASE
                          WHEN cancel_requested THEN error
                          ELSE 'The export worker stopped before this job finished.'
                        END
         WHERE status = 'running'
        """
    )


def downgrade() -> None:
    op.drop_column("backup_jobs", "heartbeat_at")
