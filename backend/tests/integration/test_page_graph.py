"""The knowledge graph against a real database: building it, reading it, answering with it.

Embeddings come from the same tiny deterministic "model" the semantic search tests
use, so pages can be made alike (or not) on purpose.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_embedding_settings import AiEmbeddingSettings
from app.models.page import WikiPage
from app.models.page_graph import PageGraphState, PageLink
from app.models.restriction import PageRestrictionPermission
from app.models.space import SpaceRole, SpaceVisibility
from app.modules.graph import builder
from app.modules.graph.neighbors import related_pages
from app.modules.graph.service import GraphService
from app.modules.permissions.service import PermissionService
from app.modules.search import indexer
from app.modules.search.service import SearchService
from app.modules.spaces.service import SpaceService
from app.schemas.page import PageCreate, PageUpdate
from app.schemas.space import SpaceCreate
from tests.integration import test_hybrid_semantic_search as semantic
from tests.integration.test_hybrid_semantic_search import _connect, _user, _wiki

#: The search objects the migration creates, built in each test's own schema.
installed = semantic.installed

pytestmark = pytest.mark.integration


async def _edges(session: AsyncSession, kind: str | None = None) -> set[tuple[str, str, str]]:
    """``(source title, target title, kind)`` of every edge."""
    source = WikiPage.__table__.alias("s")
    target = WikiPage.__table__.alias("t")
    query = (
        select(source.c.title, target.c.title, PageLink.kind)
        .join(source, source.c.id == PageLink.source_page_id)
        .join(target, target.c.id == PageLink.target_page_id)
    )
    if kind:
        query = query.where(PageLink.kind == kind)
    return {tuple(row) for row in await session.execute(query)}


async def _build(session: AsyncSession) -> builder.PassResult:
    return await builder.build_text_edges(session)


async def test_links_and_mentions_become_edges(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    await pages.create(
        space, PageCreate(title="Install k3s cluster", content="<p>steps</p>"), owner
    )
    form = await pages.create(
        space, PageCreate(title="Leave request form", content="<p>fill it</p>"), owner
    )
    await pages.create(
        space,
        PageCreate(
            title="Leave policy",
            content=(
                "<p>Send the leave request form to HR. Ops runs "
                f'<a href="/spaces/{space.key}/pages/{form.slug}">this</a>.</p>'
                "<p>Servers: see install k3s cluster.</p>"
            ),
        ),
        owner,
    )

    result = await _build(installed)

    assert result.text_pages >= 3
    assert await _edges(installed) == {
        ("Leave policy", "Leave request form", "link"),
        ("Leave policy", "Leave request form", "mention"),
        ("Leave policy", "Install k3s cluster", "mention"),
    }
    # Nothing changed: nothing to do.
    assert (await _build(installed)).text_pages == 0


async def test_an_edit_replaces_the_page_edges(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    await pages.create(space, PageCreate(title="Prometheus", content="<p>Metrics.</p>"), owner)
    policy = await pages.create(
        space, PageCreate(title="Alerting", content="<p>uses prometheus</p>"), owner
    )
    await _build(installed)
    assert ("Alerting", "Prometheus", "mention") in await _edges(installed)

    await pages.update(space, policy, PageUpdate(content="<p>uses nothing</p>"), owner)
    await installed.commit()
    await _build(installed)

    assert await _edges(installed) == set()


async def test_a_new_page_is_found_in_pages_written_before_it(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    await pages.create(
        space, PageCreate(title="Runbook", content="<p>Escalate to the support desk.</p>"), owner
    )
    await _build(installed)
    assert await _edges(installed) == set()

    await pages.create(space, PageCreate(title="Support desk", content="<p>Ext. 100</p>"), owner)
    await installed.commit()
    result = await _build(installed)

    assert result.rescanned == 1
    assert await _edges(installed) == {("Runbook", "Support desk", "mention")}


async def test_a_new_title_does_not_undo_a_mention_found_earlier_in_the_same_pass(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    # Written together, so the pass may handle the page naming the title first.
    await pages.create(
        space, PageCreate(title="Runbook", content="<p>Call the support desk.</p>"), owner
    )
    await pages.create(space, PageCreate(title="Support desk", content="<p>Ext. 100</p>"), owner)

    await _build(installed)

    assert await _edges(installed) == {("Runbook", "Support desk", "mention")}


async def test_a_renamed_page_loses_mentions_of_its_old_title(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    target = await pages.create(
        space, PageCreate(title="Support desk", content="<p>Ext. 100</p>"), owner
    )
    await pages.create(
        space, PageCreate(title="Runbook", content="<p>Call the support desk.</p>"), owner
    )
    await _build(installed)
    assert await _edges(installed) == {("Runbook", "Support desk", "mention")}

    await pages.update(space, target, PageUpdate(title="Help line"), owner)
    await installed.commit()
    await _build(installed)

    assert await _edges(installed) == set()


async def test_a_page_back_from_the_trash_is_named_again(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    target = await pages.create(
        space, PageCreate(title="Support desk", content="<p>Ext. 100</p>"), owner
    )
    runbook = await pages.create(
        space, PageCreate(title="Runbook", content="<p>Call the support desk.</p>"), owner
    )
    await _build(installed)

    await pages.trash(space, target, owner)
    await installed.commit()
    # Edited while the page is in the Trash: the mention cannot resolve any more.
    await pages.update(
        space, runbook, PageUpdate(content="<p>Call the support desk now.</p>"), owner
    )
    await installed.commit()
    result = await _build(installed)
    assert result.forgotten == 1
    assert await _edges(installed) == set()
    assert await installed.get(PageGraphState, target.id) is None

    await pages.restore(space, target.id, owner)
    await installed.commit()
    await _build(installed)

    assert await _edges(installed) == {("Runbook", "Support desk", "mention")}


async def test_similar_pages_come_from_the_search_index(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    await pages.create(
        space, PageCreate(title="Pay day", content="<p>payroll payroll vacation</p>"), owner
    )
    await pages.create(space, PageCreate(title="Wages", content="<p>salary</p>"), owner)
    await pages.create(space, PageCreate(title="Network", content="<p>ip address</p>"), owner)
    await pages.create(space, PageCreate(title="Copy", content="<p>salary</p>"), owner)
    await indexer.index_pending(installed, config)

    await builder.build_pending(installed, config)

    similar = await _edges(installed, "similar")
    assert ("Pay day", "Wages", "similar") in similar
    assert not any("Network" in (source, target) for source, target, _ in similar)
    # Identical pages are copies: one adds nothing to the other.
    assert ("Wages", "Copy", "similar") not in similar
    assert (await builder.build_pending(installed, config)).similar_pages == 0


async def test_a_new_embedding_model_redoes_the_similar_pages(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    await pages.create(
        space, PageCreate(title="Pay day", content="<p>payroll payroll vacation</p>"), owner
    )
    await pages.create(space, PageCreate(title="Wages", content="<p>salary</p>"), owner)
    await indexer.index_pending(installed, config)
    await builder.build_pending(installed, config)
    assert await _edges(installed, "similar")

    # The administrator picks another model: the index is emptied...
    config = await _connect(installed, embedding_model="other-embed")
    await indexer.reset_if_model_changed(installed, config.embedding_model)
    result = await builder.build_similar_edges(installed, config)

    # ...and likeness measured with the old vectors goes with it,
    assert result.similar_dropped >= 1
    assert await _edges(installed, "similar") == set()
    # until the pages are embedded again with the new model.
    await indexer.index_pending(installed, config)
    await builder.build_pending(installed, config)
    assert ("Pay day", "Wages", "similar") in await _edges(installed, "similar")


async def test_neighbors_read_edges_both_ways_and_the_tree(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    parent = await pages.create(space, PageCreate(title="Operations", content=""), owner)
    seed = await pages.create(
        space, PageCreate(title="Deploy", content="", parent_id=parent.id), owner
    )
    sibling = await pages.create(
        space, PageCreate(title="Rollback", content="", parent_id=parent.id), owner
    )
    linker = await pages.create(
        space, PageCreate(title="Release notes", content="<p>see deploy guide</p>"), owner
    )
    await pages.create(space, PageCreate(title="Deploy guide", content=""), owner)
    installed.add(PageLink(source_page_id=linker.id, target_page_id=seed.id, kind="link"))
    await installed.flush()

    found = await related_pages(installed, {seed.id: 1.0}, limit=10)

    by_title = {neighbor.page.title: neighbor for neighbor in found}
    assert by_title["Release notes"].via == ["linked_from"]
    assert by_title["Operations"].via == ["parent"]
    assert by_title["Rollback"].via == ["sibling"]
    assert found[0].page.id == linker.id  # a link outweighs the tree
    assert seed.id not in by_title

    await pages.trash(space, sibling, owner)
    found = await related_pages(installed, {seed.id: 1.0}, limit=10)
    assert "Rollback" not in {neighbor.page.title for neighbor in found}


async def _answer_with_graph(session: AsyncSession, related: int) -> None:
    await session.execute(update(AiEmbeddingSettings).values(graph_related_pages=related))
    await session.flush()


async def test_answers_bring_in_related_pages_only_when_enabled(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    await _connect(installed)
    await pages.create(
        space,
        PageCreate(title="Leave policy", content="<p>Vacation needs the leave request form.</p>"),
        owner,
    )
    await pages.create(
        space,
        PageCreate(title="Leave request form", content="<p>Signed by your manager.</p>"),
        owner,
    )
    await builder.build_text_edges(installed)
    search = SearchService(installed)
    await _answer_with_graph(installed, 0)

    titles = [p.page.title for p in await search.answer_passages("vacation policy", owner)]
    assert titles == ["Leave policy"]

    await _answer_with_graph(installed, 2)
    passages = await search.answer_passages("vacation policy", owner)

    assert [p.page.title for p in passages] == ["Leave policy", "Leave request form"]
    assert "Signed by your manager" in passages[1].text


async def test_related_pages_never_reveal_a_restricted_page(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    reader = await _user(installed, "reader")
    await SpaceService(installed).set_member(space, owner, reader.id, SpaceRole.viewer)
    await _connect(installed)
    await pages.create(
        space,
        PageCreate(title="Leave policy", content="<p>Vacation: see the board pay scale.</p>"),
        owner,
    )
    secret = await pages.create(
        space, PageCreate(title="Board pay scale", content="<p>Directors earn a lot.</p>"), owner
    )
    await PermissionService(installed).set_page_restriction(
        secret, owner.id, PageRestrictionPermission.view, owner, group=False, present=True
    )
    await builder.build_text_edges(installed)
    await _answer_with_graph(installed, 3)

    as_owner = await SearchService(installed).answer_passages("vacation", owner)
    as_reader = await SearchService(installed).answer_passages("vacation", reader)

    assert "Board pay scale" in [p.page.title for p in as_owner]
    assert [p.page.title for p in as_reader] == ["Leave policy"]
    assert all("Directors" not in p.text for p in as_reader)


async def test_answers_still_work_without_the_graph_tables(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    await _connect(installed)
    await pages.create(space, PageCreate(title="Leave policy", content="<p>Vacation</p>"), owner)
    await _answer_with_graph(installed, 2)
    await installed.execute(text("DROP TABLE page_links CASCADE"))

    passages = await SearchService(installed).answer_passages("vacation", owner)

    assert [p.page.title for p in passages] == ["Leave policy"]


async def test_an_empty_page_is_never_named(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    # A blank space home page is often called after the space itself.
    await pages.create(space, PageCreate(title="DevOps team", content=""), owner)
    await pages.create(
        space, PageCreate(title="Runbook", content="<p>Owned by the devops team.</p>"), owner
    )

    await _build(installed)

    assert await _edges(installed) == set()


async def test_neighbors_take_one_of_a_set_of_copies(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    seed = await pages.create(space, PageCreate(title="Deploy", content="<p>x</p>"), owner)
    copies = [
        await pages.create(space, PageCreate(title=title, content="<p>y</p>"), owner)
        for title in ("Lesson learned", "Lesson learned (1)", "Lesson_Learned (2)")
    ]
    other = await pages.create(space, PageCreate(title="Rollback", content="<p>z</p>"), owner)
    for page in (*copies, other):
        installed.add(
            PageLink(source_page_id=seed.id, target_page_id=page.id, kind="similar", weight=0.8)
        )
    await installed.flush()

    found = await related_pages(installed, {seed.id: 1.0}, limit=10)

    titles = sorted(neighbor.page.title for neighbor in found)
    assert len(titles) == 2
    assert "Rollback" in titles


async def test_related_pages_of_a_page_say_why_and_respect_permissions(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    reader = await _user(installed, "reader")
    await SpaceService(installed).set_member(space, owner, reader.id, SpaceRole.viewer)
    policy = await pages.create(
        space,
        PageCreate(
            title="Leave policy",
            content="<p>Use the leave request form. Pay: see the board pay scale.</p>",
        ),
        owner,
    )
    await pages.create(
        space, PageCreate(title="Leave request form", content="<p>Sign it.</p>"), owner
    )
    secret = await pages.create(
        space, PageCreate(title="Board pay scale", content="<p>Secret.</p>"), owner
    )
    await pages.create(
        space,
        PageCreate(title="Holiday calendar", content="<p>Read the leave policy first.</p>"),
        owner,
    )
    await PermissionService(installed).set_page_restriction(
        secret, owner.id, PageRestrictionPermission.view, owner, group=False, present=True
    )
    await builder.build_text_edges(installed)

    as_owner = await GraphService(installed).related_for_page(policy, owner)
    as_reader = await GraphService(installed).related_for_page(policy, reader)

    owner_view = {page.title: page.via for page in as_owner.pages}
    assert owner_view["Leave request form"] == ["mention"]
    assert owner_view["Holiday calendar"] == ["mentioned_by"]
    assert "Board pay scale" in owner_view
    assert {page.title for page in as_reader.pages} == {"Leave request form", "Holiday calendar"}
    assert {m.title for m in as_reader.mentions} == {"Leave request form"}
    assert {m.title for m in as_owner.mentions} == {"Leave request form", "Board pay scale"}


async def test_space_map_draws_visible_pages_their_ties_and_groups(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    reader = await _user(installed, "reader")
    await SpaceService(installed).set_member(space, owner, reader.id, SpaceRole.viewer)
    ops = await pages.create(space, PageCreate(title="Operations", content="<p>o</p>"), owner)
    await pages.create(
        space,
        PageCreate(title="Deploy guide", content="<p>see rollback steps</p>", parent_id=ops.id),
        owner,
    )
    await pages.create(
        space,
        PageCreate(title="Rollback steps", content="<p>r</p>", parent_id=ops.id),
        owner,
    )
    await pages.create(space, PageCreate(title="Lonely notes", content="<p>x</p>"), owner)
    secret = await pages.create(
        space, PageCreate(title="Secret plan", content="<p>see deploy guide</p>"), owner
    )
    await PermissionService(installed).set_page_restriction(
        secret, owner.id, PageRestrictionPermission.view, owner, group=False, present=True
    )
    await builder.build_text_edges(installed)

    graph = await GraphService(installed).space_map(space, reader)

    titles = {node.title for node in graph.nodes}
    assert "Secret plan" not in titles
    assert {"Operations", "Deploy guide", "Rollback steps", "Lonely notes"} <= titles
    by_title = {node.title: node for node in graph.nodes}
    kinds = {
        (by_title_of(graph, edge.source), by_title_of(graph, edge.target), edge.kind)
        for edge in graph.edges
    }
    assert ("Deploy guide", "Rollback steps", "mention") in kinds
    assert ("Operations", "Deploy guide", "tree") in kinds
    assert all(edge.source in by_id(graph) and edge.target in by_id(graph) for edge in graph.edges)
    assert by_title["Deploy guide"].branch_id == by_title["Operations"].id
    assert by_title["Deploy guide"].community == by_title["Rollback steps"].community
    assert by_title["Lonely notes"].id in graph.insights.orphans
    assert by_title["Deploy guide"].excerpt == "see rollback steps"
    assert by_title["Deploy guide"].id not in graph.insights.orphans
    assert graph.total_pages == len(graph.nodes)


async def test_space_map_keeps_the_best_connected_pages_when_capped(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    hub = await pages.create(space, PageCreate(title="Hub", content="<p>h</p>"), owner)
    for i in range(4):
        await pages.create(
            space, PageCreate(title=f"Leaf {i}", content="<p>l</p>", parent_id=hub.id), owner
        )
    await pages.create(space, PageCreate(title="Island", content="<p>i</p>"), owner)

    graph = await GraphService(installed).space_map(space, owner, limit=3)

    assert len(graph.nodes) == 3
    assert graph.total_pages > 3
    assert "Hub" in {node.title for node in graph.nodes}


def by_id(graph) -> set:  # type: ignore[no-untyped-def]
    return {node.id for node in graph.nodes}


def by_title_of(graph, page_id) -> str:  # type: ignore[no-untyped-def]
    return next(node.title for node in graph.nodes if node.id == page_id)


async def test_two_pages_finding_each_other_alike_count_as_one_tie(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    seed = await pages.create(space, PageCreate(title="Deploy", content="<p>x</p>"), owner)
    alike = await pages.create(space, PageCreate(title="Release", content="<p>y</p>"), owner)
    named = await pages.create(space, PageCreate(title="Runbook", content="<p>z</p>"), owner)
    for source, target in ((seed, alike), (alike, seed)):
        installed.add(
            PageLink(source_page_id=source.id, target_page_id=target.id, kind="similar", weight=0.9)
        )
    installed.add(PageLink(source_page_id=seed.id, target_page_id=named.id, kind="mention"))
    await installed.flush()

    found = await related_pages(installed, {seed.id: 1.0}, limit=5)

    # 2.0 for the mention beats 1.5 x 0.9 for likeness, counted once.
    assert [neighbor.page.title for neighbor in found][:2] == ["Runbook", "Release"]


async def test_a_page_tied_only_to_another_space_is_not_an_orphan(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    other = await SpaceService(installed).create(
        SpaceCreate(key=f"O{uuid.uuid4().hex[:7]}", name="Other"), owner
    )
    here = await pages.create(space, PageCreate(title="Grafana", content="<p>g</p>"), owner)
    there = await pages.create(other, PageCreate(title="Prometheus", content="<p>p</p>"), owner)
    installed.add(
        PageLink(source_page_id=here.id, target_page_id=there.id, kind="similar", weight=0.8)
    )
    await installed.flush()

    graph = await GraphService(installed).space_map(space, owner)

    assert here.id not in graph.insights.orphans


async def _two_spaces(installed: AsyncSession):  # type: ignore[no-untyped-def]
    owner, ops, pages = await _wiki(installed)
    docs = await SpaceService(installed).create(
        SpaceCreate(key=f"D{uuid.uuid4().hex[:7]}", name="Docs"), owner
    )
    grafana = await pages.create(
        ops, PageCreate(title="Grafana setup", content="<p>dashboards</p>"), owner
    )
    prometheus = await pages.create(
        docs, PageCreate(title="Prometheus guide", content="<p>metrics</p>"), owner
    )
    installed.add(
        PageLink(
            source_page_id=grafana.id,
            target_page_id=prometheus.id,
            kind="similar",
            weight=0.86,
        )
    )
    await installed.flush()
    return owner, ops, docs, pages, grafana, prometheus


async def test_a_map_of_several_spaces_draws_the_ties_between_them(
    installed: AsyncSession,
) -> None:
    owner, ops, docs, _, grafana, prometheus = await _two_spaces(installed)

    across = await GraphService(installed).map_for([ops, docs], owner)
    one = await GraphService(installed).space_map(ops, owner)

    assert any({edge.source, edge.target} == {grafana.id, prometheus.id} for edge in across.edges)
    assert {node.space_key for node in across.nodes} == {ops.key, docs.key}
    assert [(space.key, space.pages) for space in across.spaces] == sorted(
        [(docs.key, 2), (ops.key, 2)],  # each space's own home page, and the one created
        key=lambda item: item[0] == ops.key,
    )
    by_id = {node.id: node for node in across.nodes}
    assert by_id[prometheus.id].space_name == "Docs"
    # A map of one space still leaves the tie out: its other end is elsewhere.
    assert not any(prometheus.id in (edge.source, edge.target) for edge in one.edges)
    assert grafana.id not in one.insights.orphans  # tied, only not on this map


async def test_a_map_of_several_spaces_never_shows_a_page_the_reader_may_not_read(
    installed: AsyncSession,
) -> None:
    owner, ops, docs, _pages, grafana, prometheus = await _two_spaces(installed)
    reader = await _user(installed, "reader")
    await SpaceService(installed).set_member(ops, owner, reader.id, SpaceRole.viewer)
    await SpaceService(installed).set_member(docs, owner, reader.id, SpaceRole.viewer)
    await PermissionService(installed).set_page_restriction(
        prometheus, owner.id, PageRestrictionPermission.view, owner, group=False, present=True
    )

    graph = await GraphService(installed).map_for([ops, docs], reader)

    ids = {node.id for node in graph.nodes}
    assert prometheus.id not in ids
    assert grafana.id in ids
    assert all(edge.source in ids and edge.target in ids for edge in graph.edges)


async def test_the_spaces_listed_for_the_map_are_those_the_reader_may_open(
    installed: AsyncSession,
) -> None:
    owner, ops, *_ = await _two_spaces(installed)
    secret = await SpaceService(installed).create(
        SpaceCreate(
            key=f"S{uuid.uuid4().hex[:7]}",
            name="Board",
            visibility=SpaceVisibility.restricted,
        ),
        owner,
    )
    reader = await _user(installed, "reader")

    keys = {space.key for space in await SpaceService(installed).list_space_models(reader)}
    everything = {space.key for space in await SpaceService(installed).list_space_models(owner)}

    assert ops.key in keys
    assert secret.key not in keys
    assert secret.key in everything
