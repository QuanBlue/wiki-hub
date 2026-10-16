"""The statistics writers are best-effort: a database failure is logged, never raised."""

import uuid

import pytest

from app.modules.stats import recorder


def _broken_factory():
    raise RuntimeError("database is down")


@pytest.mark.asyncio
async def test_a_failed_ai_usage_write_is_swallowed(monkeypatch) -> None:
    monkeypatch.setattr(recorder, "get_session_factory", _broken_factory)
    await recorder.record_ai_usage(
        user_id=uuid.uuid4(), feature="summarize", model="m", prompt_tokens=1, completion_tokens=2
    )


@pytest.mark.asyncio
async def test_a_failed_view_write_is_swallowed(monkeypatch) -> None:
    monkeypatch.setattr(recorder, "get_session_factory", _broken_factory)
    await recorder.record_view("page", uuid.uuid4())
