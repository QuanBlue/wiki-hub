"""`job_progress`: the shared percent/ETA derivation for backup, restore, and
document-import jobs.

Regression coverage for a real bug: a WikiHub restore's `items_total` (the
eventual attachment count) is known before its page/permission-restore phase
even starts, and that phase reports no progress at all - so `items_processed`
sits at 0 for minutes while `items_total` is already nonzero. The admin panel
read that as a literal, static "0% complete" indistinguishable from a stalled
job, instead of the indeterminate state the function's own docstring promises
whenever there isn't enough data yet.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from app.services.job_progress import job_progress


def _job(**overrides):
    defaults = dict(
        status="running",
        started_at=datetime.now(UTC) - timedelta(seconds=60),
        counters={},
    )
    return SimpleNamespace(**{**defaults, **overrides})


def test_a_known_total_with_nothing_processed_yet_is_indeterminate():
    job = _job(counters={"items_total": 4799, "items_processed": 0})

    assert job_progress(job) == (None, None)


def test_no_total_at_all_is_indeterminate():
    job = _job(counters={"items_processed": 0})

    assert job_progress(job) == (None, None)


def test_progress_appears_once_at_least_one_item_is_processed():
    job = _job(counters={"items_total": 100, "items_processed": 25})

    percent, eta_seconds = job_progress(job)

    assert percent == 25
    assert eta_seconds is not None


def test_percent_is_capped_at_ninety_nine_while_still_running():
    job = _job(counters={"items_total": 100, "items_processed": 100})

    percent, _ = job_progress(job)

    assert percent == 99


def test_complete_is_always_one_hundred_regardless_of_counters():
    job = _job(status="complete", counters={})

    assert job_progress(job) == (100, 0)


def test_queued_is_indeterminate():
    job = _job(status="queued", started_at=None, counters={"items_total": 100})

    assert job_progress(job) == (None, None)
