# ruff: noqa: F811
"""Indexing when pages are refused one by one, and when the note about why cannot be kept."""

from __future__ import annotations

import pytest
from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_embedding_settings import AiEmbeddingSettings
from app.modules.ai.config import AIConfig
from app.modules.ai.embeddings import EmbeddingError
from app.modules.search import indexer
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
    monkeypatch.setattr(indexer, "_dimensions_with_index", set())


async def test_a_page_the_gateway_refuses_after_others_went_through_is_marked_handled_unless_that_fails(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    await pages.create(space, PageCreate(title="Good", content="<p>payroll</p>"), owner)
    await pages.create(space, PageCreate(title="Bad", content="<p>forbidden</p>"), owner)

    async def embed(_config: AIConfig, texts: list[str]) -> list[list[float]]:
        if any("forbidden" in text.lower() or "bad" in text.lower() for text in texts):
            raise EmbeddingError("rejected", permanent=True)
        return [fake_vector(text) for text in texts]

    real_store = indexer._store

    async def store(session, page_id, updated_at, model, chunks, vectors, sources=None) -> None:
        if not chunks:  # the note that a refused page was handled
            raise SQLAlchemyError("the page is gone")
        await real_store(session, page_id, updated_at, model, chunks, vectors, sources)

    monkeypatch.setattr(indexer, "embed", embed)
    monkeypatch.setattr(indexer, "_store", store)

    # The good page is indexed; marking the refused one as handled fails and is only counted.
    assert await indexer.index_pending(installed, config) >= 1


class BrokenRedis:
    async def get(self, key: str) -> str:
        raise OSError("redis is down")

    async def set(self, *args: object, **kwargs: object) -> None:
        raise OSError("redis is down")

    async def delete(self, *args: object, **kwargs: object) -> None:
        raise OSError("redis is down")


async def test_a_note_about_why_indexing_stopped_that_cannot_be_kept_or_read_is_only_a_lost_hint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(indexer, "get_redis", lambda: BrokenRedis())

    await indexer._remember_error("model", "it broke")
    await indexer._remember_error("model", None)

    assert await indexer.last_error("model") is None


async def test_a_database_without_the_pause_column_has_nothing_paused(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def refuse(*args, **kwargs):
        raise SQLAlchemyError("no such column")

    monkeypatch.setattr(installed, "scalar", refuse)

    assert await indexer.indexing_paused(installed) is False


async def test_pausing_asks_a_self_hosted_ollama_to_let_go_of_its_memory(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    import httpx

    await _connect(installed)
    await installed.execute(update(AiEmbeddingSettings).values(source="ollama"))
    await installed.commit()
    sent: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        sent.append(json.loads(request.content))
        return httpx.Response(200)

    real = httpx.AsyncClient
    monkeypatch.setattr(
        indexer.httpx,
        "AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(handler), **kw),
    )

    await indexer.set_indexing_paused(installed, True, model="bge-m3")
    assert sent == [{"model": "bge-m3", "input": [], "keep_alive": 0}]

    # An Ollama that is not running is no reason to fail: it lets go by itself later.
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("not running")

    monkeypatch.setattr(
        indexer.httpx,
        "AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(down), **kw),
    )
    await indexer.set_indexing_paused(installed, True, model="bge-m3")
    assert await indexer.indexing_paused(installed) is True


async def test_pausing_with_no_settings_yet_creates_them(installed: AsyncSession) -> None:
    from sqlalchemy import text

    await installed.execute(text("DELETE FROM ai_embedding_settings"))
    await installed.commit()

    await indexer.set_indexing_paused(installed, True)

    assert await indexer.indexing_paused(installed) is True
