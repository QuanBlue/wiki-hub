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


class TestInProgressSince:
    """Regression coverage for a real bug: the plain average-pace ETA -
    remaining items times elapsed-over-processed - grows every second a slow
    item is in progress, since `elapsed` keeps climbing while `processed`
    holds still. A batch of a few files with wildly different sizes (an
    ordinary document import) hits this constantly; passing when the current
    item started lets the estimate hold steady instead.
    """

    def test_a_slow_current_item_does_not_grow_the_estimate_without_bound(self):
        # 5 items in 50s (10s/item average), 2 left, and the one in progress
        # has already run for 40s - four times the average.
        job = _job(
            started_at=datetime.now(UTC) - timedelta(seconds=50),
            counters={"items_total": 7, "items_processed": 5},
        )

        _, plain_eta = job_progress(job)
        _, anchored_eta = job_progress(
            job, in_progress_since=datetime.now(UTC) - timedelta(seconds=40)
        )

        # The plain estimate: 2 remaining * 10s average = 20s, growing every
        # second the current item keeps running past that average.
        assert plain_eta == 20
        # The anchored estimate: the current item has used up its whole
        # average already, contributing nothing further; only the one item
        # genuinely still waiting behind it (10s) remains.
        assert anchored_eta == 10

    def test_a_current_item_still_within_the_average_counts_down_normally(self):
        # Same pace, but the current item has only been running 3s of its
        # ~10s average - 7s of it should still show up in the estimate.
        job = _job(
            started_at=datetime.now(UTC) - timedelta(seconds=50),
            counters={"items_total": 7, "items_processed": 5},
        )

        _, eta_seconds = job_progress(
            job, in_progress_since=datetime.now(UTC) - timedelta(seconds=3)
        )

        assert eta_seconds == 17  # 1 waiting item (10s) + 7s left on this one

    def test_no_in_progress_since_falls_back_to_the_plain_estimate(self):
        job = _job(counters={"items_total": 100, "items_processed": 25})

        assert job_progress(job) == job_progress(job, in_progress_since=None)
