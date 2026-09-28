"""Shared job-log helpers."""

from __future__ import annotations

from unittest.mock import AsyncMock

from app.models.import_job import ImportLog
from app.services.job_logs import problem_counts


async def test_problem_counts_skips_the_query_when_there_are_no_jobs():
    session = AsyncMock()

    assert await problem_counts(session, ImportLog, []) == {}
    session.execute.assert_not_awaited()


def test_concise_error_keeps_only_the_point_of_a_database_failure():
    from app.services.job_logs import concise_error

    raw = (
        "(sqlalchemy.dialects.postgresql.asyncpg.Error) <class 'asyncpg.exceptions."
        "DiskFullError'>: could not extend file \"base/16384/16731\": No space left on "
        "device\nHINT:  Check free disk space.\n[SQL: INSERT INTO page_user_restrictions "
        "VALUES ($1::UUID)]\n[parameters: (UUID('x'),)]\n(Background on this error at: "
        "https://sqlalche.me/e/20/dbapi)"
    )

    assert concise_error(Exception(raw)) == "No space left on device HINT: Check free disk space."


def test_concise_error_leaves_plain_messages_and_bounds_long_ones():
    from app.services.job_logs import MAX_ERROR_LENGTH, concise_error

    assert concise_error("archive is corrupt") == "archive is corrupt"
    assert concise_error("") == "Unknown error"
    long = concise_error("x" * 1000)
    assert len(long) == MAX_ERROR_LENGTH and long.endswith("…")
