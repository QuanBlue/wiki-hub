"""The scheduled jobs behind AI health checks and semantic search indexing, and long-text chunking."""

from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from app.modules.ai import admin as admin_module
from app.modules.ai.admin import AIConnectionService
from app.modules.search.chunking import HARD_LIMIT, chunk_page
from app.workers import tasks


@asynccontextmanager
async def _scope():
    yield Mock()


async def test_the_ai_health_pass_reports_how_many_connections_it_checked() -> None:
    with (
        patch.object(tasks, "session_scope", _scope),
        patch.object(tasks, "check_all_connections", AsyncMock(return_value=3)),
    ):
        assert await tasks.check_ai_connections({}) == 3


def _redis(acquired: bool) -> Mock:
    redis = Mock()
    redis.set = AsyncMock(return_value=acquired)
    redis.delete = AsyncMock()
    return redis


async def test_an_indexing_pass_already_running_is_not_doubled_up() -> None:
    redis = _redis(acquired=False)
    with patch.object(tasks, "get_redis", return_value=redis):
        assert await tasks.index_search_pages({}) == 0
    redis.delete.assert_not_awaited()


async def test_the_indexing_pass_indexes_stale_pages_and_releases_its_lock() -> None:
    redis = _redis(acquired=True)
    index = AsyncMock(return_value=5)
    with (
        patch.object(tasks, "get_redis", return_value=redis),
        patch.object(tasks, "session_scope", _scope),
        patch.object(tasks, "load_config", AsyncMock(return_value=SimpleNamespace())),
        patch.object(tasks, "index_pending", index),
    ):
        assert await tasks.index_search_pages({}) == 5

    assert index.await_args.kwargs["deadline"] > 0
    redis.delete.assert_awaited_once_with("lock:search_index")


async def test_the_lock_is_released_even_when_indexing_fails() -> None:
    redis = _redis(acquired=True)
    with (
        patch.object(tasks, "get_redis", return_value=redis),
        patch.object(tasks, "session_scope", _scope),
        patch.object(tasks, "load_config", AsyncMock(return_value=SimpleNamespace())),
        patch.object(tasks, "index_pending", AsyncMock(side_effect=RuntimeError("boom"))),
    ):
        try:
            await tasks.index_search_pages({})
        except RuntimeError:
            pass
        else:  # pragma: no cover - the failure must surface
            raise AssertionError("the failure was swallowed")

    redis.delete.assert_awaited_once()


async def test_a_failed_probe_after_saving_never_undoes_the_save() -> None:
    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()
    service = AIConnectionService(session, SimpleNamespace(id="actor"))
    connection = SimpleNamespace()

    with patch.object(admin_module, "record_check", AsyncMock(side_effect=RuntimeError("probe"))):
        await service._record_check(connection)

    session.rollback.assert_awaited_once()
    session.refresh.assert_awaited_once_with(connection)


def test_a_long_sentence_after_a_short_one_starts_a_fresh_passage() -> None:
    short = "Short opening sentence. "
    chunks = chunk_page("Doc", "<p>" + short + "y" * (HARD_LIMIT + 5) + "</p>", max_chunks=10)

    assert any("Short opening sentence." in chunk for chunk in chunks)
    assert len(chunks) >= 3
