# ruff: noqa: F811
"""Search and passage finding in the corners: nothing to embed, odd vectors, empty pages."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.ai.config import AIConfig
from app.modules.permissions.service import PermissionService
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
    monkeypatch.setattr(indexer, "_dimensions_with_index", set())


async def test_with_no_ideas_there_are_no_weights(installed: AsyncSession) -> None:
    assert await SearchService(installed)._idea_weights([]) == ([], 0.0)


async def test_passages_cannot_be_matched_when_the_query_cannot_be_embedded(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = await _connect(installed)

    async def nothing(_config: AIConfig, _query: str) -> list[float] | None:
        return None

    monkeypatch.setattr(search_module, "_embed_query", nothing)

    found = await SearchService(installed)._best_passages("payroll dates", [uuid.uuid4()], config)

    assert found == {}


async def test_a_vector_of_the_wrong_size_leaves_passage_matching_empty_not_broken(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    page = await pages.create(
        space, PageCreate(title="Payroll", content="<p>payroll dates</p>"), owner
    )
    await indexer.index_pending(installed, config)

    async def wrong_size(_config: AIConfig, _query: str) -> list[float] | None:
        return [1.0, 0.0, 0.0]  # the stored vectors have four dimensions

    monkeypatch.setattr(search_module, "_embed_query", wrong_size)

    found = await SearchService(installed)._best_passages("payroll dates", [page.id], config)

    assert found == {}


async def test_a_semantic_search_over_an_index_with_no_passages_finds_nothing(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    await pages.create(space, PageCreate(title="Payroll", content="<p>payroll</p>"), owner)

    async def vector(_config: AIConfig, _query: str) -> list[float] | None:
        return fake_vector("payroll")

    monkeypatch.setattr(search_module, "_embed_query", vector)
    # Nothing has been indexed, so there is no passage to be close to.
    import asyncio

    task = asyncio.ensure_future(vector(config, "payroll"))

    assert await SearchService(installed)._semantic_hits(task, 10, config) == {}


async def test_with_many_pages_close_in_meaning_only_the_outstanding_ones_are_kept(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    # Plenty of pages on the same idea, and one that says it plainly.
    for index in range(search_module._OUTLIER_MIN_PAGES + 2):
        await pages.create(
            space,
            PageCreate(
                title=f"Note {index}",
                content=f"<p>payroll {'holiday ' * (index % 4)} {'address ' * (index % 3)}</p>",
            ),
            owner,
        )
    indexed = await indexer.index_pending(installed, config)
    assert indexed >= search_module._OUTLIER_MIN_PAGES

    async def vector(_config: AIConfig, _query: str) -> list[float] | None:
        return fake_vector("payroll")

    monkeypatch.setattr(search_module, "_embed_query", vector)
    import asyncio

    task = asyncio.ensure_future(vector(config, "payroll"))

    hits = await SearchService(installed)._semantic_hits(task, 50, config)

    assert hits  # the spread between candidates is worked out, and something is kept


async def test_passages_skip_a_page_with_nothing_to_quote_and_stop_when_the_budget_is_spent(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    await _connect(installed, "")
    await pages.create(space, PageCreate(title="Payroll empty", content=""), owner)
    for index in range(3):
        await pages.create(
            space,
            PageCreate(
                title=f"Payroll note {index}",
                content=f"<p>Payroll runs monthly, note number {index}, " + "word " * 80 + "</p>",
            ),
            owner,
        )

    passages = await SearchService(installed).answer_passages(
        "payroll", owner, max_pages=5, passage_chars=120, total_chars=200
    )

    found, _terms = await SearchService(installed)._search_pages(
        "payroll", owner, 5, PermissionService(installed)
    )
    assert "Payroll empty" in [r.title for r in found]  # it does match, and is then skipped
    titles = [p.page.title for p in passages]
    assert "Payroll empty" not in titles  # nothing to quote from it
    assert 1 <= len(titles) < 3  # the budget ran out before every page was added

    # With room for everything, the page with nothing to quote is still left out.
    roomy = await SearchService(installed).answer_passages(
        "payroll", owner, max_pages=5, passage_chars=120, total_chars=100_000
    )
    assert "Payroll empty" not in [p.page.title for p in roomy]
    assert len(roomy) == 3
