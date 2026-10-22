"""The knowledge graph at its edges: a pass out of time, a page or a query that fails, a long
list of siblings or related pages, and titles too long or too many to name."""

from __future__ import annotations

import time
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.page import WikiPage
from app.modules.graph import builder, neighbors
from app.modules.graph.extract import TitledPage, TitleIndex, is_matchable_title
from app.modules.graph.neighbors import MAX_SIBLINGS, related_pages
from app.modules.graph.service import RELATED_LIMIT, GraphService, _merge_similar
from app.modules.search import indexer
from app.schemas.graph import GraphEdge
from app.schemas.page import PageCreate
from tests.integration import test_hybrid_semantic_search as semantic
from tests.integration.test_hybrid_semantic_search import _connect, _wiki

installed = semantic.installed

pytestmark = pytest.mark.integration


def test_a_title_must_be_short_enough_and_something_to_name() -> None:
    assert not is_matchable_title(())
    assert not is_matchable_title(tuple("word" for _ in range(13)))
    assert is_matchable_title(("leave", "request"))


def test_an_index_with_no_titles_finds_nothing() -> None:
    nothing = TitleIndex([])
    assert len(nothing) == 0
    assert (
        nothing.mentions(
            "A page", "<p>says anything</p>", page_id=uuid.uuid4(), space_id=uuid.uuid4()
        )
        == []
    )
    one = TitleIndex(
        [TitledPage(id=uuid.uuid4(), space_id=uuid.uuid4(), title="Leave request form")]
    )
    assert len(one) == 1


async def test_a_text_pass_out_of_time_stops_and_says_so(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    await pages.create(space, PageCreate(title="One", content="<p>x</p>"), owner)

    result = await builder.build_text_edges(installed, deadline=time.monotonic() - 1)

    assert result.stopped == "time_budget"
    assert result.text_pages == 0


async def test_a_page_that_cannot_be_saved_is_noted_and_the_others_go_on(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _wiki(installed)
    await pages.create(space, PageCreate(title="Good", content="<p>x</p>"), owner)
    await pages.create(space, PageCreate(title="Bad", content="<p>y</p>"), owner)
    real = builder.replace_edges
    calls = {"n": 0}

    async def flaky(session, source_id, kind, targets) -> None:
        calls["n"] += 1
        if calls["n"] == 1:
            raise SQLAlchemyError("the page was purged")
        await real(session, source_id, kind, targets)

    beats = {"n": 0}

    async def beat() -> None:
        beats["n"] += 1

    monkeypatch.setattr(builder, "replace_edges", flaky)

    result = await builder.build_text_edges(installed, heartbeat=beat)

    assert len(result.errors) == 1
    assert result.text_pages >= 1
    assert beats["n"] == result.text_pages


async def test_similar_pages_are_not_looked_for_without_embeddings(installed: AsyncSession) -> None:
    result = await builder.build_similar_edges(
        installed,
        SimpleNamespace(embeddings_ready=False),  # type: ignore[arg-type]
    )
    assert result.similar_pages == 0 and result.errors == []


async def _indexed_wiki(installed: AsyncSession):
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    await pages.create(space, PageCreate(title="Pay day", content="<p>payroll payroll</p>"), owner)
    await pages.create(space, PageCreate(title="Wages", content="<p>salary</p>"), owner)
    await indexer.index_pending(installed, config)
    await builder.build_text_edges(installed)
    return config


async def test_a_failing_likeness_query_is_noted_not_raised(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = await _indexed_wiki(installed)
    real = installed.execute

    async def execute(statement, *args, **kwargs):
        if "avg(c.embedding)" in str(statement):
            raise SQLAlchemyError("the index is being rebuilt")
        return await real(statement, *args, **kwargs)

    monkeypatch.setattr(installed, "execute", execute)

    result = await builder.build_similar_edges(installed, config)

    assert result.errors == ["similar"]


async def test_a_page_whose_likeness_cannot_be_saved_is_noted_and_skipped(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = await _indexed_wiki(installed)

    async def refuse(session, source_id, kind, targets) -> None:
        raise SQLAlchemyError("the page is gone")

    monkeypatch.setattr(builder, "replace_edges", refuse)

    result = await builder.build_similar_edges(installed, config)

    assert result.similar_pages == 0
    assert len(result.errors) >= 1


async def test_neighbors_of_nothing_or_with_no_room_are_none(installed: AsyncSession) -> None:
    assert await related_pages(installed, {}, limit=5) == []
    assert await related_pages(installed, {uuid.uuid4(): 1.0}, limit=0) == []


async def test_children_count_and_only_so_many_siblings_do(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    parent = await pages.create(space, PageCreate(title="Operations", content=""), owner)
    seed = await pages.create(
        space, PageCreate(title="Deploy", content="", parent_id=parent.id), owner
    )
    await pages.create(space, PageCreate(title="Canary", content="", parent_id=seed.id), owner)
    for n in range(MAX_SIBLINGS + 3):
        await pages.create(
            space,
            PageCreate(title=f"Sibling topic number {n} alpha{n}", content="", parent_id=parent.id),
            owner,
        )

    found = await related_pages(installed, {seed.id: 1.0}, limit=100)

    by_title = {n.page.title: n for n in found}
    assert by_title["Canary"].via == ["child"]
    siblings = [t for t in by_title if t.startswith("Sibling topic")]
    assert len(siblings) <= MAX_SIBLINGS

    # Asking for fewer stops at the number asked for.
    assert len(await related_pages(installed, {seed.id: 1.0}, limit=2)) == 2


async def test_a_page_with_many_related_pages_lists_only_the_most_that_fit(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _wiki(installed)
    seed = await pages.create(space, PageCreate(title="Deploy", content=""), owner)
    for n in range(RELATED_LIMIT + 2):
        await pages.create(
            space,
            PageCreate(title=f"Related topic {n} unique{n}", content="", parent_id=None),
            owner,
        )
    others = list(
        (
            await installed.execute(
                select(WikiPage).where(WikiPage.id != seed.id, WikiPage.deleted_at.is_(None))
            )
        )
        .scalars()
        .all()
    )

    async def many(session, seeds, *, limit, tree):
        return [neighbors.Neighbor(page=p, score=1.0, via=["link"]) for p in others]

    monkeypatch.setattr("app.modules.graph.service.related_pages", many)
    await installed.refresh(seed, ["space"])
    for page in others:
        await installed.refresh(page, ["space"])

    related = await GraphService(installed).related_for_page(seed, owner)

    assert len(related.pages) == RELATED_LIMIT


def test_two_pages_finding_each_other_are_one_similar_tie() -> None:
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    edges = [
        GraphEdge(source=a, target=b, kind="similar", weight=0.8),
        GraphEdge(source=b, target=a, kind="similar", weight=0.8),
        GraphEdge(source=a, target=c, kind="link", weight=1),
        GraphEdge(source=a, target=c, kind="link", weight=1),
    ]
    merged = _merge_similar(edges)
    assert [edge.kind for edge in merged] == ["similar", "link", "link"]
