"""A space's content health report against a real database: stale pages, broken links,
orphans and duplicates, and the AI check of a stale page."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import PermissionDeniedError, ServiceUnavailableError
from app.models.page import WikiPage
from app.models.page_review import PageReview
from app.models.space import SpaceRole, SpaceVisibility
from app.modules.ai import service as ai_service
from app.modules.ai.client import ChatReply
from app.modules.ai.service import AIService
from app.modules.graph import builder
from app.modules.graph import health as health_module
from app.modules.graph.health import ContentHealthService
from app.modules.search import indexer
from app.modules.spaces.service import SpaceService
from app.schemas.page import PageCreate
from app.schemas.space import SpaceCreate
from tests.integration import test_hybrid_semantic_search as semantic
from tests.integration.test_hybrid_semantic_search import FakeRedis, _connect, _user, _wiki

installed = semantic.installed

pytestmark = pytest.mark.integration


async def _age(session: AsyncSession, page: WikiPage, days: int) -> None:
    """Make ``page`` look last edited ``days`` ago."""
    await session.execute(
        update(WikiPage)
        .where(WikiPage.id == page.id)
        .values(updated_at=datetime.now(UTC) - timedelta(days=days))
    )
    await session.commit()


async def _report(session: AsyncSession, space, user, **kwargs):
    # Ages are set with plain UPDATEs: read every page afresh, as a new request would.
    session.expire_all()
    await session.refresh(space)
    await session.refresh(user)
    return await ContentHealthService(session).report(space, user, **kwargs)


# -- stale ---------------------------------------------------------------------------------


async def test_an_old_page_whose_neighbour_was_edited_since_is_stale(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    old = await pages.create(
        space, PageCreate(title="VPN setup", content="<p>Server is vpn1.</p>"), owner
    )
    await pages.create(
        space,
        PageCreate(
            title="Network changes",
            content=f'<p>We moved to <a href="/spaces/{space.key}/pages/{old.slug}">it</a>.</p>',
        ),
        owner,
    )
    untouched = await pages.create(
        space, PageCreate(title="Lonely old page", content="<p>Nothing new.</p>"), owner
    )
    await installed.commit()
    await builder.build_text_edges(installed)
    await _age(installed, old, 400)
    await _age(installed, untouched, 400)

    report = await _report(installed, space, owner)

    assert [item.page.title for item in report.stale] == ["VPN setup"]
    assert [newer.title for newer in report.stale[0].newer] == ["Network changes"]
    assert report.stale[0].newer_count == 1
    assert report.stale_total == 1


async def test_a_child_or_parent_counts_as_a_neighbour(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    parent = await pages.create(
        space, PageCreate(title="Office guide", content="<p>Floors and rooms.</p>"), owner
    )
    await pages.create(
        space,
        PageCreate(title="Parking", content="<p>New parking rules.</p>", parent_id=parent.id),
        owner,
    )
    await installed.commit()
    await _age(installed, parent, 365)

    report = await _report(installed, space, owner)

    assert [item.page.title for item in report.stale] == ["Office guide"]
    assert [newer.title for newer in report.stale[0].newer] == ["Parking"]


async def test_a_neighbour_edited_long_ago_does_not_make_a_page_stale(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    parent = await pages.create(
        space, PageCreate(title="Office guide", content="<p>Floors.</p>"), owner
    )
    child = await pages.create(
        space,
        PageCreate(title="Parking", content="<p>Rules.</p>", parent_id=parent.id),
        owner,
    )
    await installed.commit()
    await _age(installed, parent, 400)
    # Edited after the parent, but not recently.
    await _age(installed, child, 200)

    assert (await _report(installed, space, owner)).stale == []
    # Looking further back for recent edits finds it.
    wider = await _report(installed, space, owner, recent_days=365)
    assert [item.page.title for item in wider.stale] == ["Office guide"]


async def test_a_page_marked_still_correct_is_not_stale_until_it_ages_again(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    parent = await pages.create(
        space, PageCreate(title="Office guide", content="<p>Floors.</p>"), owner
    )
    await pages.create(
        space, PageCreate(title="Parking", content="<p>Rules.</p>", parent_id=parent.id), owner
    )
    await installed.commit()
    await _age(installed, parent, 400)
    assert (await _report(installed, space, owner)).stale_total == 1

    await ContentHealthService(installed).mark_reviewed(parent, owner)
    assert (await _report(installed, space, owner)).stale == []

    # A year later the mark is old too: flagged again, with when it was marked.
    await installed.execute(
        update(PageReview)
        .where(PageReview.page_id == parent.id)
        .values(reviewed_at=datetime.now(UTC) - timedelta(days=300))
    )
    await installed.commit()
    report = await _report(installed, space, owner)
    assert [item.page.title for item in report.stale] == ["Office guide"]
    assert report.stale[0].reviewed_at is not None

    # Marking again only updates the one row.
    await ContentHealthService(installed).mark_reviewed(parent, owner)
    assert await installed.scalar(text("SELECT count(*) FROM page_reviews")) == 1


async def test_an_empty_page_is_never_stale(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    parent = await pages.create(space, PageCreate(title="Section", content=""), owner)
    await pages.create(
        space, PageCreate(title="Parking", content="<p>Rules.</p>", parent_id=parent.id), owner
    )
    await installed.commit()
    await _age(installed, parent, 400)

    assert (await _report(installed, space, owner)).stale == []


async def test_a_newer_neighbour_the_reader_may_not_see_is_not_shown(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    admin = await _user(installed, "admin")
    await SpaceService(installed).set_member(space, owner, admin.id, SpaceRole.admin)
    old = await pages.create(
        space, PageCreate(title="Office guide", content="<p>Floors.</p>"), owner
    )
    private = await SpaceService(installed).create(
        SpaceCreate(
            key=f"P{uuid.uuid4().hex[:7]}", name="Board", visibility=SpaceVisibility.restricted
        ),
        owner,
    )
    await pages.create(
        private,
        PageCreate(
            title="Board notes",
            content=f'<a href="/spaces/{space.key}/pages/{old.slug}">guide</a>',
        ),
        owner,
    )
    await installed.commit()
    await builder.build_text_edges(installed)
    await _age(installed, old, 400)

    # The owner sees the newer page in the other space...
    as_owner = await _report(installed, space, owner)
    assert [newer.title for item in as_owner.stale for newer in item.newer] == ["Board notes"]
    # ...the space's administrator cannot open it, so for them nothing overtook the page.
    assert (await _report(installed, space, admin)).stale == []


async def test_a_page_linking_to_a_newer_one_is_stale_too(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    newer = await pages.create(
        space, PageCreate(title="Network changes", content="<p>vpn2.</p>"), owner
    )
    old = await pages.create(
        space,
        PageCreate(
            title="VPN setup",
            content=f'<p>See <a href="/spaces/{space.key}/pages/{newer.slug}">changes</a>.</p>',
        ),
        owner,
    )
    await installed.commit()
    await builder.build_text_edges(installed)
    await _age(installed, old, 400)

    report = await _report(installed, space, owner)

    assert [(item.page.title, [n.title for n in item.newer]) for item in report.stale] == [
        ("VPN setup", ["Network changes"])
    ]


# -- broken links --------------------------------------------------------------------------


async def test_broken_links_say_why(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    spaces = SpaceService(installed)
    other = await spaces.create(SpaceCreate(key=f"O{uuid.uuid4().hex[:7]}", name="Old"), owner)
    archived_page = await pages.create(
        other, PageCreate(title="Archived page", content="<p>x</p>"), owner
    )
    gone = await pages.create(space, PageCreate(title="Gone page", content="<p>x</p>"), owner)
    fine = await pages.create(space, PageCreate(title="Fine page", content="<p>x</p>"), owner)
    await pages.create(
        space,
        PageCreate(
            title="Hub",
            content=(
                f'<p><a href="/spaces/{space.key}/pages/{fine.slug}">ok</a> '
                f'<a href="/spaces/{space.key}/pages/never-was">missing</a> '
                f'<a href="/spaces/{space.key}/pages/{gone.slug}">trashed</a> '
                f'<a href="/spaces/{other.key}/pages/{archived_page.slug}">archived</a> '
                f'<a href="/spaces/NOSPACE/pages/whatever">no space</a> '
                '<a href="https://example.com/spaces/x">outside</a></p>'
            ),
        ),
        owner,
    )
    await pages.trash(space, gone, owner)
    await installed.commit()
    await spaces.archive(other, owner)
    await installed.commit()

    report = await _report(installed, space, owner)

    found = {(link.target_slug, link.reason) for link in report.broken_links}
    assert found == {
        ("never-was", "missing"),
        (gone.slug, "trashed"),
        (archived_page.slug, "archived_space"),
        ("whatever", "missing"),
    }
    assert report.broken_total == 4
    assert all(link.page.title == "Hub" for link in report.broken_links)
    trashed = next(link for link in report.broken_links if link.reason == "trashed")
    assert trashed.href == f"/spaces/{space.key}/pages/{gone.slug}"


async def test_a_link_with_the_space_key_in_another_case_is_not_broken(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    target = await pages.create(space, PageCreate(title="Target", content="<p>x</p>"), owner)
    await pages.create(
        space,
        PageCreate(
            title="Hub",
            content=f'<a href="/spaces/{space.key.lower()}/pages/{target.slug}">t</a>',
        ),
        owner,
    )
    await installed.commit()

    assert (await _report(installed, space, owner)).broken_links == []


# -- orphans -------------------------------------------------------------------------------


async def test_orphans_are_pages_nothing_links_to_or_names(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    root = await pages.create(space, PageCreate(title="Handbook", content="<p>Start.</p>"), owner)
    named = await pages.create(
        space,
        PageCreate(title="Expense claims", content="<p>Receipts.</p>", parent_id=root.id),
        owner,
    )
    linked = await pages.create(
        space,
        PageCreate(title="Travel booking", content="<p>Flights.</p>", parent_id=root.id),
        owner,
    )
    await pages.create(
        space,
        PageCreate(title="Forgotten corner", content="<p>Nobody.</p>", parent_id=root.id),
        owner,
    )
    await pages.create(space, PageCreate(title="Empty child", content="", parent_id=root.id), owner)
    await pages.create(
        space,
        PageCreate(
            title="Finance FAQ",
            content=(
                "<p>File your expense claims monthly. Book via "
                f'<a href="/spaces/{space.key}/pages/{linked.slug}">travel</a>.</p>'
            ),
            parent_id=root.id,
        ),
        owner,
    )
    await installed.commit()
    await builder.build_text_edges(installed)

    report = await _report(installed, space, owner)

    titles = {page.title for page in report.orphans}
    # Top-level pages are the tree's way in; empty pages say nothing.
    assert "Handbook" not in titles
    assert "Empty child" not in titles
    assert named.title not in titles
    assert linked.title not in titles
    assert {"Forgotten corner", "Finance FAQ"} <= titles
    assert report.orphans_total == len(report.orphans)


async def test_a_link_from_a_page_in_the_trash_does_not_count(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    root = await pages.create(space, PageCreate(title="Handbook", content="<p>Start.</p>"), owner)
    target = await pages.create(
        space, PageCreate(title="Expense claims", content="<p>x</p>", parent_id=root.id), owner
    )
    source = await pages.create(
        space,
        PageCreate(
            title="Finance FAQ",
            content=f'<a href="/spaces/{space.key}/pages/{target.slug}">e</a>',
            parent_id=root.id,
        ),
        owner,
    )
    await installed.commit()
    await builder.build_text_edges(installed)
    assert "Expense claims" not in {
        p.title for p in (await _report(installed, space, owner)).orphans
    }

    await pages.trash(space, source, owner)
    await installed.commit()

    assert "Expense claims" in {p.title for p in (await _report(installed, space, owner)).orphans}


# -- duplicates ----------------------------------------------------------------------------


async def test_copies_with_the_same_title_are_duplicates(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    await pages.create(space, PageCreate(title="Release checklist", content="<p>a</p>"), owner)
    await pages.create(space, PageCreate(title="Release checklist (2)", content="<p>b</p>"), owner)
    await pages.create(space, PageCreate(title="Release notes", content="<p>c</p>"), owner)
    await installed.commit()

    report = await _report(installed, space, owner)

    assert [(group.kind, sorted(p.title for p in group.pages)) for group in report.duplicates] == [
        ("title", ["Release checklist", "Release checklist (2)"])
    ]
    # No embedding model: content was not compared.
    assert report.semantic is False


async def test_pages_with_nearly_the_same_content_are_duplicates(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    await pages.create(space, PageCreate(title="Pay day", content="<p>salary payroll</p>"), owner)
    await pages.create(space, PageCreate(title="Wages", content="<p>salary wages</p>"), owner)
    await pages.create(space, PageCreate(title="Network", content="<p>ip address</p>"), owner)
    await installed.commit()
    await indexer.index_pending(installed, config)

    report = await _report(installed, space, owner)

    assert report.semantic is True
    content = [group for group in report.duplicates if group.kind == "content"]
    assert [sorted(p.title for p in group.pages) for group in content] == [["Pay day", "Wages"]]
    assert content[0].similarity is not None and content[0].similarity >= 0.92


async def test_a_copy_listed_by_title_is_not_listed_again_by_content(
    installed: AsyncSession,
) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    await pages.create(space, PageCreate(title="Pay day", content="<p>salary</p>"), owner)
    await pages.create(space, PageCreate(title="Pay day (2)", content="<p>salary</p>"), owner)
    await installed.commit()
    await indexer.index_pending(installed, config)

    report = await _report(installed, space, owner)

    assert [group.kind for group in report.duplicates] == ["title"]


async def test_a_duplicate_the_reader_may_not_see_is_not_listed(installed: AsyncSession) -> None:
    owner, space, pages = await _wiki(installed)
    admin = await _user(installed, "admin")
    await SpaceService(installed).set_member(space, owner, admin.id, SpaceRole.admin)
    config = await _connect(installed)
    await pages.create(space, PageCreate(title="Pay day", content="<p>salary payroll</p>"), owner)
    private = await SpaceService(installed).create(
        SpaceCreate(
            key=f"P{uuid.uuid4().hex[:7]}", name="Board", visibility=SpaceVisibility.restricted
        ),
        owner,
    )
    await pages.create(private, PageCreate(title="Board pay", content="<p>salary wages</p>"), owner)
    await installed.commit()
    await indexer.index_pending(installed, config)

    as_owner = await _report(installed, space, owner)
    assert [sorted(p.title for p in g.pages) for g in as_owner.duplicates] == [
        ["Board pay", "Pay day"]
    ]
    assert (await _report(installed, space, admin)).duplicates == []


async def test_duplicates_by_content_are_skipped_when_the_index_cannot_be_read(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _wiki(installed)
    config = await _connect(installed)
    await pages.create(space, PageCreate(title="Pay day", content="<p>salary payroll</p>"), owner)
    await pages.create(space, PageCreate(title="Wages", content="<p>salary wages</p>"), owner)
    await installed.commit()
    await indexer.index_pending(installed, config)
    # The index cannot be read (a half-applied migration, say): the report still comes back.
    monkeypatch.setattr(health_module, "text", lambda _: text("SELECT * FROM no_such_index"))

    report = await _report(installed, space, owner)

    assert report.semantic is False
    assert report.duplicates == []


# -- the AI check --------------------------------------------------------------------------


async def _stale_pair(session: AsyncSession):
    owner, space, pages = await _wiki(session)
    old = await pages.create(
        space, PageCreate(title="VPN setup", content="<p>Connect to vpn1.example.</p>"), owner
    )
    await pages.create(
        space,
        PageCreate(
            title="Network changes",
            content="<p>vpn1 is retired; use vpn2.example.</p>",
            parent_id=old.id,
        ),
        owner,
    )
    await session.commit()
    await _age(session, old, 400)
    session.expire_all()
    await session.refresh(owner)
    await session.refresh(space)
    await session.refresh(old)
    return owner, space, old


async def test_the_ai_check_compares_a_page_with_its_newer_neighbours(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, old = await _stale_pair(installed)
    await _connect(installed)
    sent: list[list[dict[str, str]]] = []

    async def fake_chat(config, messages, *, max_tokens=2000):
        sent.append(messages)
        return ChatReply(
            text='- "vpn1.example" - **Network changes** says vpn2.example.', usage=None
        )

    async def no_usage(**_: object) -> None:
        return None

    redis = FakeRedis()
    monkeypatch.setattr(ai_service, "chat_with_usage", fake_chat)
    monkeypatch.setattr(ai_service, "record_ai_usage", no_usage)
    monkeypatch.setattr(ai_service, "get_redis", lambda: redis)

    async def no_limit(*_: object) -> None:
        return None

    monkeypatch.setattr(ai_service.rate_limit, "enforce", no_limit)

    result = await AIService(installed, owner).check_stale(space.key, old.slug, "vi")

    assert "vpn2.example" in result.result
    assert [page.title for page in result.compared] == ["Network changes"]
    assert result.cached is False
    system, user_message = sent[0]
    assert "Vietnamese" in system["content"]
    assert "<older_page" in user_message["content"] and "vpn1.example" in user_message["content"]
    assert "<newer_page" in user_message["content"] and "vpn2.example" in user_message["content"]

    # The same pages again: the saved answer, no second call.
    again = await AIService(installed, owner).check_stale(space.key, old.slug, "vi")
    assert again.cached is True
    assert len(sent) == 1


async def test_the_ai_check_with_no_newer_page_calls_no_model(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _wiki(installed)
    await _connect(installed)
    alone = await pages.create(space, PageCreate(title="Alone", content="<p>x</p>"), owner)
    await installed.commit()

    async def boom(*_: object, **__: object):
        raise AssertionError("the model must not be called")

    monkeypatch.setattr(ai_service, "chat_with_usage", boom)

    result = await AIService(installed, owner).check_stale(space.key, alone.slug, "en")

    assert result.result == "" and result.compared == []


async def test_the_ai_check_needs_the_assistant_and_a_space_admin(
    installed: AsyncSession,
) -> None:
    owner, space, old = await _stale_pair(installed)
    with pytest.raises(ServiceUnavailableError):
        await AIService(installed, owner).check_stale(space.key, old.slug, "en")

    await _connect(installed)
    viewer = await _user(installed, "viewer")
    await SpaceService(installed).set_member(space, owner, viewer.id, SpaceRole.viewer)
    await installed.commit()

    with pytest.raises(PermissionDeniedError):
        await AIService(installed, viewer).check_stale(space.key, old.slug, "en")
