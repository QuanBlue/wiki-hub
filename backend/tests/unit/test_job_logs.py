"""Shared job-log helpers."""

from __future__ import annotations

from unittest.mock import AsyncMock

from app.models.import_job import ImportLog
from app.services.job_logs import problem_counts


async def test_problem_counts_skips_the_query_when_there_are_no_jobs():
    session = AsyncMock()

    assert await problem_counts(session, ImportLog, []) == {}
    session.execute.assert_not_awaited()
