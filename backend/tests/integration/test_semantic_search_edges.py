# ruff: noqa: F811
"""Semantic search when the gateway, the cache or the database misbehave."""

from __future__ import annotations

import time

import pytest
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.ai.config import OFF, AIConfig
from app.modules.ai.embeddings import EmbeddingError
from app.modules.search import indexer
from app.modules.search import service as search_module
from app.modules.search.service import SearchService
from app.schemas.page import PageCreate
from tests.integration.test_hybrid_semantic_search import (  # noqa: F401 - fixtures
    _connect,
    _wiki,
    fake_vector,
    installed,
)

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _fresh_index_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    """Each test builds its own schema, so "the index exists" must not be remembered."""
    monkeypatch.setattr(indexer, "_dimensions_with_index", set())


async def test_a_new_embedding_model_drops_the_old_vector_index(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed, "model-a")
    await pages.create(space, PageCreate(title="Doc", content="<p>payroll</p>"), owner)
    await indexer.index_pending(installed, config)
    names = (
        await installed.scalars(
            text(
                "SELECT indexname FROM pg_indexes WHERE indexname LIKE 'ix%page_chunks%embedding%'"
            )
        )
    ).all()
    assert names, "indexing should have built a nearest-neighbour index"

    assert await indexer.reset_if_model_changed(installed, "model-b") is True

    remaining = (
        await installed.scalars(
            text(
                "SELECT indexname FROM pg_indexes WHERE indexname LIKE 'ix%page_chunks%embedding%'"
            )
        )
    ).all()
    assert remaining == []


async def test_an_indexing_pass_stops_at_its_deadline(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    await pages.create(space, PageCreate(title="Doc", content="<p>payroll</p>"), owner)

    assert await indexer.index_pending(installed, config, deadline=time.monotonic() - 1) == 0


async def test_a_busy_gateway_pauses_indexing(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    await pages.create(space, PageCreate(title="Doc", content="<p>payroll</p>"), owner)

    async def busy(_config: AIConfig, _texts: list[str]) -> list[list[float]]:
        raise EmbeddingError("busy", permanent=False)

    monkeypatch.setattr(indexer, "embed", busy)

    assert await indexer.index_pending(installed, config) == 0
    assert (await indexer.index_status(installed, config)).indexed == 0


async def test_when_the_gateway_rejects_every_page_none_is_marked_done(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A model that cannot embed at all must not leave the wiki looking indexed."""
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    await pages.create(space, PageCreate(title="Doc", content="<p>payroll</p>"), owner)

    async def reject(_config: AIConfig, _texts: list[str]) -> list[list[float]]:
        raise EmbeddingError("rejected", permanent=True)

    monkeypatch.setattr(indexer, "embed", reject)

    assert await indexer.index_pending(installed, config) == 0
    status = await indexer.index_status(installed, config)
    assert status.indexed == 0
    assert await installed.scalar(text("SELECT count(*) FROM page_search_state")) == 0


async def test_a_page_that_cannot_be_stored_is_skipped(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    await pages.create(space, PageCreate(title="Doc", content="<p>payroll</p>"), owner)

    async def deleted_meanwhile(*_args: object, **_kwargs: object) -> None:
        raise SQLAlchemyError("the page is gone")

    monkeypatch.setattr(indexer, "_store", deleted_meanwhile)

    assert await indexer.index_pending(installed, config) == 0


async def test_indexing_status_without_the_semantic_tables(session: AsyncSession) -> None:
    status = await indexer.index_status(session, OFF)

    assert status.available is False
    assert status.indexed == 0


async def test_a_failing_keyword_search_does_not_leave_the_query_embedding_running(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, _space, _pages = await _wiki(installed)
    await _connect(installed)

    async def broken(*_args: object, **_kwargs: object) -> list[object]:
        raise RuntimeError("keyword search failed")

    monkeypatch.setattr(SearchService, "_keyword_pages", broken)

    with pytest.raises(RuntimeError, match="keyword search failed"):
        await SearchService(installed).search("payroll", owner)


async def test_search_returns_no_more_pages_than_asked_for(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    for number in range(3):
        await pages.create(
            space, PageCreate(title=f"Payroll {number}", content="<p>payroll</p>"), owner
        )

    result = await SearchService(installed).search("payroll", owner, limit=2)

    assert len(result.pages) == 2


async def test_search_falls_back_to_keywords_when_the_gateway_cannot_embed(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _wiki(installed)
    await _connect(installed)
    page = await pages.create(
        space, PageCreate(title="Payroll", content="<p>payroll dates</p>"), owner
    )

    async def unavailable(_config: AIConfig, _texts: list[str]) -> list[list[float]]:
        raise EmbeddingError("down")

    monkeypatch.setattr(search_module, "embed", unavailable)

    result = await SearchService(installed).search("payroll", owner)

    assert [hit.id for hit in result.pages] == [page.id]


async def test_search_without_semantic_tables_still_answers_by_keyword(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _wiki(session)
    await _connect(session)
    page = await pages.create(space, PageCreate(title="Plain", content="<p>needle</p>"), owner)

    async def embed(_config: AIConfig, texts: list[str]) -> list[list[float]]:
        return [fake_vector(t) for t in texts]

    monkeypatch.setattr(search_module, "embed", embed)

    result = await SearchService(session).search("needle", owner)

    assert [hit.id for hit in result.pages] == [page.id]


async def test_vectors_of_another_size_do_not_break_search(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    page = await pages.create(
        space, PageCreate(title="Payroll", content="<p>payroll dates</p>"), owner
    )
    await indexer.index_pending(installed, config)

    async def other_size(_config: AIConfig, texts: list[str]) -> list[list[float]]:
        return [[1.0, 0.0, 0.0] for _ in texts]  # the stored vectors have four dimensions

    monkeypatch.setattr(search_module, "embed", other_size)

    result = await SearchService(installed).search("payroll", owner)

    assert [hit.id for hit in result.pages] == [page.id]


class _BrokenRedis:
    async def get(self, _key: str) -> str:
        raise RuntimeError("cache down")

    async def set(self, _key: str, _value: str, **_: object) -> None:
        raise RuntimeError("cache down")


async def test_a_broken_query_cache_never_breaks_search(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    page = await pages.create(
        space, PageCreate(title="Compensation", content="<p>payroll</p>"), owner
    )
    await indexer.index_pending(installed, config)
    monkeypatch.setattr(search_module, "get_redis", lambda: _BrokenRedis())

    result = await SearchService(installed).search("salary", owner)

    assert [hit.id for hit in result.pages] == [page.id]
