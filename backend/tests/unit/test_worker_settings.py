"""Worker job time limits."""

from __future__ import annotations

from app.workers.settings import LONG_RUNNING_JOB_TIMEOUT_SECONDS, WorkerSettings


def _timeouts() -> dict[str, float | None]:
    """Job name -> its own timeout (None means the worker-wide default applies)."""
    result: dict[str, float | None] = {}
    for entry in WorkerSettings.functions:
        name = getattr(entry, "name", None) or entry.__name__
        timeout = getattr(entry, "timeout_s", None)
        result[name] = timeout.total_seconds() if hasattr(timeout, "total_seconds") else timeout
    return result


def test_large_imports_and_restores_are_not_cut_off_by_the_default_limit() -> None:
    timeouts = _timeouts()

    assert LONG_RUNNING_JOB_TIMEOUT_SECONDS > WorkerSettings.job_timeout
    assert timeouts["run_confluence_import"] == LONG_RUNNING_JOB_TIMEOUT_SECONDS
    assert timeouts["run_backup_job"] == LONG_RUNNING_JOB_TIMEOUT_SECONDS


def test_short_jobs_keep_the_default_limit() -> None:
    timeouts = _timeouts()

    assert timeouts["ping"] is None
    assert timeouts["run_document_import"] is None
