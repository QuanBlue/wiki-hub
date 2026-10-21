"""The scheduled jobs behind AI health checks and semantic search indexing, and long-text chunking."""

from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.modules.ai import admin as admin_module
from app.modules.ai.admin import AIConnectionService
from app.modules.search.chunking import HARD_LIMIT, chunk_page
from app.workers import tasks


@pytest.fixture(autouse=True)
def not_paused(monkeypatch: pytest.MonkeyPatch) -> None:
    """Indexing is not paused unless a test says so (the sessions here are stand-ins)."""
    monkeypatch.setattr(tasks, "indexing_paused", AsyncMock(return_value=False))


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
    redis.expire = AsyncMock()
    redis.eval = AsyncMock(return_value=1)
    return redis


async def test_an_indexing_pass_already_running_is_not_doubled_up() -> None:
    redis = _redis(acquired=False)
    with patch.object(tasks, "get_redis", return_value=redis):
        assert await tasks.index_search_pages({}) == 0
    redis.eval.assert_not_awaited()


async def test_the_indexing_pass_indexes_stale_pages_and_releases_its_lock() -> None:
    redis = _redis(acquired=True)
    # One batch of five, then nothing left.
    index = AsyncMock(side_effect=[5, 0])
    with (
        patch.object(tasks, "get_redis", return_value=redis),
        patch.object(tasks, "session_scope", _scope),
        patch.object(tasks, "load_config", AsyncMock(return_value=SimpleNamespace())),
        patch.object(tasks, "index_pending", index),
    ):
        assert await tasks.index_search_pages({}) == 5

    assert index.await_args.kwargs["deadline"] > 0
    # Released only if the lock still holds this pass's own token.
    token = redis.set.await_args.args[1]
    _script, keys, key, owner = redis.eval.await_args.args
    assert (keys, key, owner) == (1, "lock:search_index", token)


async def test_a_pass_takes_batch_after_batch_while_pages_are_waiting() -> None:
    """Ending after one batch left the embedding model idle until the next minute."""
    redis = _redis(acquired=True)
    index = AsyncMock(side_effect=[20, 20, 7, 0])
    with (
        patch.object(tasks, "get_redis", return_value=redis),
        patch.object(tasks, "session_scope", _scope),
        patch.object(tasks, "load_config", AsyncMock(return_value=SimpleNamespace())),
        patch.object(tasks, "index_pending", index),
    ):
        assert await tasks.index_search_pages({}) == 47

    assert index.await_count == 4
    # Every batch shares the one deadline of the pass.
    assert len({call.kwargs["deadline"] for call in index.await_args_list}) == 1


async def test_a_pass_ends_at_its_deadline_even_with_pages_left(monkeypatch) -> None:
    redis = _redis(acquired=True)
    monkeypatch.setattr(tasks, "_SEARCH_INDEX_BUDGET_SECONDS", 0.05)
    import asyncio

    async def batch(*_args, **_kwargs) -> int:
        await asyncio.sleep(0.02)
        return 3

    with (
        patch.object(tasks, "get_redis", return_value=redis),
        patch.object(tasks, "session_scope", _scope),
        patch.object(tasks, "load_config", AsyncMock(return_value=SimpleNamespace())),
        patch.object(tasks, "index_pending", batch),
    ):
        indexed = await tasks.index_search_pages({})

    assert 3 <= indexed <= 12
    redis.eval.assert_awaited_once()


async def test_a_paused_index_does_not_start_a_pass(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = _redis(acquired=True)
    monkeypatch.setattr(tasks, "indexing_paused", AsyncMock(return_value=True))
    index = AsyncMock(return_value=5)
    with (
        patch.object(tasks, "get_redis", return_value=redis),
        patch.object(tasks, "session_scope", _scope),
        patch.object(tasks, "load_config", AsyncMock(return_value=SimpleNamespace())),
        patch.object(tasks, "index_pending", index),
    ):
        assert await tasks.index_search_pages({}) == 0

    index.assert_not_awaited()
    redis.eval.assert_awaited_once()  # the lock is still given back


async def test_a_pass_hands_indexing_a_way_to_notice_a_pause() -> None:
    redis = _redis(acquired=True)
    index = AsyncMock(side_effect=[0])
    with (
        patch.object(tasks, "get_redis", return_value=redis),
        patch.object(tasks, "session_scope", _scope),
        patch.object(tasks, "load_config", AsyncMock(return_value=SimpleNamespace())),
        patch.object(tasks, "index_pending", index),
    ):
        await tasks.index_search_pages({})

    stop = index.await_args.kwargs["stop"]
    assert await stop() is False  # asked before every page; not paused here


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

    redis.eval.assert_awaited_once()


async def test_a_pass_stuck_on_one_slow_page_keeps_its_lock_alive(monkeypatch) -> None:
    """One embedding call can outlast the lock; the lock must not lapse meanwhile."""
    import asyncio

    redis = _redis(acquired=True)
    monkeypatch.setattr(tasks, "_SEARCH_INDEX_LOCK_RENEW_SECONDS", 0.01)

    calls = 0

    async def slow_page(*_args, **_kwargs) -> int:
        nonlocal calls
        calls += 1
        if calls > 1:
            return 0  # the backlog is done
        await asyncio.sleep(0.08)
        return 1

    with (
        patch.object(tasks, "get_redis", return_value=redis),
        patch.object(tasks, "session_scope", _scope),
        patch.object(tasks, "load_config", AsyncMock(return_value=SimpleNamespace())),
        patch.object(tasks, "index_pending", slow_page),
    ):
        assert await tasks.index_search_pages({}) == 1

    assert redis.expire.await_count >= 3
    redis.expire.assert_awaited_with("lock:search_index", tasks._SEARCH_INDEX_LOCK_TTL_SECONDS)


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


async def test_ollama_is_kept_running_even_while_indexing_is_paused() -> None:
    config = SimpleNamespace(
        embedding_source="ollama", embeddings_ready=True, tuning=SimpleNamespace()
    )
    with (
        patch.object(tasks, "session_scope", _scope),
        patch.object(tasks, "load_config", AsyncMock(return_value=config)),
        patch.object(tasks.ollama, "ensure_running", AsyncMock(return_value=True)) as ensure,
    ):
        assert await tasks.keep_ollama_running({}) is True
        ensure.assert_awaited_once()

    # Another source, or Ollama off, is left alone.
    for other in (
        SimpleNamespace(embedding_source="provider", embeddings_ready=True, tuning=None),
        SimpleNamespace(embedding_source="ollama", embeddings_ready=False, tuning=None),
    ):
        with (
            patch.object(tasks, "session_scope", _scope),
            patch.object(tasks, "load_config", AsyncMock(return_value=other)),
            patch.object(tasks.ollama, "ensure_running", AsyncMock()) as ensure,
        ):
            assert await tasks.keep_ollama_running({}) is False
            ensure.assert_not_awaited()
