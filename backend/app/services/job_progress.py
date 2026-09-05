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


def job_progress(
    job: ProgressReportingJob, *, in_progress_since: datetime | None = None
) -> tuple[int | None, int | None]:
    """Derive a 0-99/100 percent and an ETA in seconds from `job.counters`.

    Returns `(None, None)` whenever there isn't enough data to make a
    reasonable estimate (queued, or running but nothing has been reported
    yet) - the frontend falls back to an indeterminate spinner rather than
    showing a number that is really a guess.

    `in_progress_since` - when the caller has it - is when work began on the
    unit currently running, as opposed to `job.started_at`, which is when the
    whole job began. Passing it fixes a real defect in the plain
    remaining-items-times-average-pace estimate below: between two items
    finishing, `elapsed` grows every second while `processed` does not, so
    the average pace keeps *dropping* and the ETA keeps *climbing* for as
    long as the current item takes - a multi-megabyte file after several
    small ones reads as the import stalling and getting worse, not as one
    slow item. With it, only the average-paced items still waiting behind
    the current one grow the estimate; the current item itself contributes
    at most one more average's worth, counting down as its own time runs, so
    the number a slow file produces holds steady instead of climbing.
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
    now = datetime.now(UTC)
    elapsed = (now - job.started_at).total_seconds()
    eta_seconds = None
    if elapsed > 0:
        average_pace = elapsed / processed
        remaining = max(0, total - processed)
        if in_progress_since is not None and remaining > 0:
            time_on_current = max(0.0, (now - in_progress_since).total_seconds())
            current_item_eta = max(0.0, average_pace - time_on_current)
            eta_seconds = round((remaining - 1) * average_pace + current_item_eta)
        else:
            eta_seconds = round(remaining * average_pace)
    return percent, eta_seconds
