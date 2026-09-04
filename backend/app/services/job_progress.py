"""Percent and ETA for any job that reports `items_processed` / `items_total`.

Backup exports, restores and document imports all present the same progress UI,
so they must compute progress the same way - a second implementation drifts,
and the drift shows up as two progress bars that disagree about the same kind
of work. Job rows keep the two counter keys below for exactly this reason.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Protocol


class ProgressReportingJob(Protocol):
    """The three columns this calculation needs, whichever job table it is."""

    status: str
    started_at: datetime | None
    counters: dict[str, int]


def job_progress(job: ProgressReportingJob) -> tuple[int | None, int | None]:
    """Derive a 0-99/100 percent and an ETA in seconds from `job.counters`.

    Returns `(None, None)` whenever there isn't enough data to make a
    reasonable estimate (queued, or running but nothing has been reported
    yet) - the frontend falls back to an indeterminate spinner rather than
    showing a number that is really a guess.
    """
    if job.status == "complete":
        return 100, 0
    if job.status != "running" or job.started_at is None:
        return None, None
    total = job.counters.get("items_total") or 0
    processed = job.counters.get("items_processed") or 0
    # A restore's `items_total` (the eventual attachment count) is known
    # before its long page/permission-restore phase even starts - that phase
    # reports no progress at all (see `restore_full_package`'s savepoint
    # comment), so `processed` sits at 0 for minutes while `total` is already
    # a real, nonzero number. Without this check that produced a literal "0%
    # complete" the whole time - indistinguishable from a genuinely stalled
    # job - instead of the honest "nothing reported yet" this function's own
    # docstring promises.
    if total <= 0 or processed <= 0:
        return None, None
    # Capped at 99: the last percent belongs to "actually finished", so a
    # progress bar never sits at 100 while work is still going on.
    percent = min(99, processed * 100 // total)
    elapsed = (datetime.now(UTC) - job.started_at).total_seconds()
    eta_seconds = None
    if processed > 0 and elapsed > 0:
        rate = processed / elapsed
        if rate > 0:
            eta_seconds = round(max(0, total - processed) / rate)
    return percent, eta_seconds
