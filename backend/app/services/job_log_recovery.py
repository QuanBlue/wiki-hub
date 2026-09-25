"""Keep a job's narration when the transaction that carried it is rolled back.

Import and restore jobs `session.add` their log lines and only commit at
progress checkpoints, to stay off the hot path of per-item loops. That is fine
until the job fails: the failure handlers must `rollback()` to get a usable
transaction, and a rollback discards every line still pending - precisely the
lines written since the last checkpoint, which are the ones that explain the
failure. Collect them first, then re-add them once the session is usable.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession


def pending_log_entries(session: AsyncSession, *log_models: type[Any]) -> list[Any]:
    """Log rows added to `session` but not yet flushed, of the given model(s)."""
    return [row for row in session.new if isinstance(row, log_models)]


def restore_log_entries(session: AsyncSession, entries: list[Any]) -> None:
    """Re-add entries collected by `pending_log_entries` after a rollback."""
    session.add_all(entries)
