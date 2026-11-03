"""Integration tests for fast search filters (space, author, label, type, updated)."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attachment import PageAttachment
from app.models.user_page_label import UserPageLabel
from app.modules.pages.service import PageService
from app.modules.search.service import SearchService
from app.modules.spaces.service import SpaceService
from app.schemas.page import PageCreate
from app.schemas.space import SpaceCreate
from tests.integration.test_hybrid_semantic_search import _user

pytestmark = pytest.mark.integration


async def test_search_filters_space(session: AsyncSession) -> None:
    owner = await _user(session, "owner_sf1")
    spaces = SpaceService(session)
    sp_eng = await spaces.create(SpaceCreate(key="SFENG", name="SF Engineering"), owner)
    sp_hr = await spaces.create(SpaceCreate(key="SFHR", name="SF Human Resources"), owner)

    pages = PageService(session)
    page_eng = await pages.create(
        sp_eng,
        PageCreate(title="Microservices architecture", content="<p>Cluster deployment notes</p>"),
        owner,
    )
    page_hr = await pages.create(
        sp_hr,
        PageCreate(title="Benefits and architecture", content="<p>HR cluster handbook</p>"),
        owner,
    )

    search = SearchService(session)

    # 1. Plain search finds both
    all_res = await search.search("architecture", owner)
    page_ids = [p.id for p in all_res.pages]
    assert page_eng.id in page_ids
    assert page_hr.id in page_ids

    # 2. Filtered with space:SFENG finds only eng
    eng_res = await search.search("space:SFENG architecture", owner)
    eng_ids = [p.id for p in eng_res.pages]
    assert page_eng.id in eng_ids
    assert page_hr.id not in eng_ids

    # 2b. A fragment of the space name is enough, as with key SFENG / name "SF Engineering"
    part_res = await search.search("space:engineering architecture", owner)
    assert page_eng.id in [p.id for p in part_res.pages]
    assert page_hr.id not in [p.id for p in part_res.pages]

    # 3. Filter only (no keyword) lists pages in that space
    list_res = await search.search("space:SFENG", owner)
    list_ids = [p.id for p in list_res.pages]
    assert page_eng.id in list_ids
    assert page_hr.id not in list_ids


async def test_search_filters_author(session: AsyncSession) -> None:
    alice = await _user(session, "alice_sf")
    bob = await _user(session, "bob_sf")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key="SFAUTH", name="Author Space"), alice)

    pages = PageService(session)
    page_alice = await pages.create(
        space,
        PageCreate(title="Alice Guideline", content="<p>Detailed team guidelines</p>"),
        alice,
    )
    page_bob = await pages.create(
        space,
        PageCreate(title="Bob Guideline", content="<p>Detailed team guidelines</p>"),
        bob,
    )

    search = SearchService(session)

    # Search author:alice_sf
    res = await search.search("author:alice_sf guidelines", alice)
    ids = [p.id for p in res.pages]
    assert page_alice.id in ids
    assert page_bob.id not in ids


async def test_search_filters_label(session: AsyncSession) -> None:
    owner = await _user(session, "owner_lbl")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key="SFLBL", name="Label Space"), owner)

    pages = PageService(session)
    page_runbook = await pages.create(
        space,
        PageCreate(title="Incident Playbook", content="<p>Production steps</p>"),
        owner,
    )
    page_other = await pages.create(
        space,
        PageCreate(title="Meeting Playbook", content="<p>Production steps</p>"),
        owner,
    )

    session.add(UserPageLabel(user_id=owner.id, page_id=page_runbook.id, name="runbook"))
    await session.flush()

    search = SearchService(session)
    res = await search.search("label:runbook Playbook", owner)
    ids = [p.id for p in res.pages]
    assert page_runbook.id in ids
    assert page_other.id not in ids


async def test_search_filters_type_and_updated(session: AsyncSession) -> None:
    owner = await _user(session, "owner_type")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key="SFTYPE", name="Type Space"), owner)

    pages = PageService(session)
    page_with_pdf = await pages.create(
        space,
        PageCreate(title="Annual Overview", content="<p>Report overview</p>"),
        owner,
    )
    page_plain = await pages.create(
        space,
        PageCreate(title="Quarterly Overview", content="<p>Report overview</p>"),
        owner,
    )

    # Attach a PDF to page_with_pdf
    session.add(
        PageAttachment(
            page_id=page_with_pdf.id,
            filename="financial_summary.pdf",
            content_type="application/pdf",
            object_key=f"tests/{uuid.uuid4()}/financial_summary.pdf",
            size_bytes=1024,
        )
    )
    await session.flush()

    search = SearchService(session)

    # 1. Filter type:pdf
    res_type = await search.search("type:pdf Overview", owner)
    ids = [p.id for p in res_type.pages]
    assert page_with_pdf.id in ids
    assert page_plain.id not in ids
    assert res_type.pages[0].file_name == "financial_summary.pdf"

    # 2. Filter updated range
    # Both pages were just created with updated_at in current year (2026)
    res_updated = await search.search("updated:>2025-01 Overview", owner)
    up_ids = [p.id for p in res_updated.pages]
    assert page_with_pdf.id in up_ids

    # Query before 2020 should yield no results
    res_old = await search.search("updated:<2020-01 Overview", owner)
    assert len(res_old.pages) == 0


async def test_search_filters_treat_wildcards_literally_and_type_by_extension(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner_wild")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key="SFWILD", name="Wild Space"), owner)
    pages = PageService(session)
    labelled = await pages.create(
        space, PageCreate(title="Run book one", content="<p>alpha</p>"), owner
    )
    other = await pages.create(
        space, PageCreate(title="Run book two", content="<p>alpha</p>"), owner
    )
    session.add(UserPageLabel(page_id=labelled.id, user_id=owner.id, name="run_book"))
    session.add(UserPageLabel(page_id=other.id, user_id=owner.id, name="runxbook"))
    session.add(
        PageAttachment(
            page_id=other.id,
            filename="notes.docx",
            content_type=(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ),
            object_key=f"tests/{uuid.uuid4()}/notes.docx",
            size_bytes=10,
        )
    )
    await session.flush()

    search = SearchService(session)

    # Another member's private label never matches for me.
    stranger = await _user(session, "stranger_wild")
    assert (await search.search("label:run_book", stranger)).pages == []

    # "_" is a literal underscore, not "any character".
    ids = [p.id for p in (await search.search("label:run_book", owner)).pages]
    assert ids == [labelled.id]

    # type:doc must not match a .docx merely because its MIME type contains "document".
    assert (await search.search("type:doc", owner)).pages == []
    assert [p.id for p in (await search.search("type:docx", owner)).pages] == [other.id]

    # A date that cannot exist is ignored rather than raising.
    res = await search.search("updated:2026-13-45 alpha", owner)
    assert res.filters is None
