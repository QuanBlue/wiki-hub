# ruff: noqa: F811
"""Quick search finds a space, a page or a person however their name is typed: "dms 1",
"dms_1", "DMs1", "dms1" and "DMS10" all mean the space "dms1.0"; "quan nguyen" and "quân"
find Nguyễn Văn Quân."""

from __future__ import annotations

import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.space import Space, SpaceStatus
from app.models.user import User
from app.modules.pages.service import PageService
from app.modules.search.service import SearchService
from app.modules.spaces.service import SpaceService
from app.schemas.page import PageCreate
from app.schemas.space import SpaceCreate
from tests.integration.test_hybrid_semantic_search import (  # noqa: F401 - fixture
    _user,
    installed,
)

pytestmark = pytest.mark.integration

TYPINGS = ["dms1.0", "dms1", "DMs1", "Dms1", "dms 1", "dms_1", "DMS10", "dms-1.0"]


@pytest.mark.parametrize("typed", TYPINGS)
async def test_a_space_is_found_however_its_name_is_typed(
    installed: AsyncSession, typed: str
) -> None:
    owner = await _user(installed, "owner")
    await SpaceService(installed).create(SpaceCreate(key="DMS10", name="dms1.0"), owner)

    spaces = (await SearchService(installed).search(typed, owner)).spaces

    assert [space.key for space in spaces] == ["DMS10"]


@pytest.mark.parametrize("typed", ["dms1", "dms 1", "DMS_1", "dms10"])
async def test_a_space_named_with_spaces_is_found_typed_without_them(
    installed: AsyncSession, typed: str
) -> None:
    owner = await _user(installed, "owner")
    await SpaceService(installed).create(SpaceCreate(key="PRJDMS", name="DMS 1.0"), owner)

    spaces = (await SearchService(installed).search(typed, owner)).spaces

    assert [space.name for space in spaces] == ["DMS 1.0"]


async def test_accents_do_not_matter_for_a_space(installed: AsyncSession) -> None:
    owner = await _user(installed, "owner")
    await SpaceService(installed).create(SpaceCreate(key="KTHT", name="Kỹ thuật hạ tầng"), owner)

    spaces = (await SearchService(installed).search("ky thuat", owner)).spaces

    assert [space.key for space in spaces] == ["KTHT"]


async def test_the_closest_space_comes_first(installed: AsyncSession) -> None:
    owner = await _user(installed, "owner")
    spaces = SpaceService(installed)
    await spaces.create(
        SpaceCreate(key="NOTES", name="Notes", description="dms1 migration notes"), owner
    )
    await spaces.create(SpaceCreate(key="DMS1ARCH", name="dms1.0 archive"), owner)
    await spaces.create(SpaceCreate(key="DMS10", name="dms1.0"), owner)

    found = (await SearchService(installed).search("dms1", owner)).spaces

    # The exact name, then a longer one starting with it, then a description mentioning it.
    assert [space.key for space in found] == ["DMS10", "DMS1ARCH", "NOTES"]


async def test_a_typo_still_finds_the_space(installed: AsyncSession) -> None:
    owner = await _user(installed, "owner")
    await SpaceService(installed).create(SpaceCreate(key="VOFFICE", name="voffice"), owner)

    found = (await SearchService(installed).search("vofice", owner)).spaces

    assert [space.key for space in found] == ["VOFFICE"]


async def test_an_archived_or_hidden_space_is_not_listed(installed: AsyncSession) -> None:
    owner = await _user(installed, "owner")
    stranger = await _user(installed, "stranger")
    spaces = SpaceService(installed)
    archived = await spaces.create(SpaceCreate(key="DMSOLD", name="dms1.0 old"), owner)
    await spaces.create(
        SpaceCreate(key="DMSPRIV", name="dms1.0 private", visibility="restricted"), owner
    )
    await installed.execute(
        update(Space).where(Space.id == archived.id).values(status=SpaceStatus.archived)
    )

    for_owner = (await SearchService(installed).search("dms1", owner)).spaces
    for_stranger = (await SearchService(installed).search("dms1", stranger)).spaces

    assert [space.key for space in for_owner] == ["DMSPRIV"]
    assert for_stranger == []


async def test_a_space_filter_names_the_space_however_typed(installed: AsyncSession) -> None:
    owner = await _user(installed, "owner")
    spaces = SpaceService(installed)
    dms = await spaces.create(SpaceCreate(key="DMS10", name="dms1.0"), owner)
    other = await spaces.create(SpaceCreate(key="OTHERX", name="Other"), owner)
    pages = PageService(installed)
    await pages.create(dms, PageCreate(title="Server list", content="<p>server a</p>"), owner)
    await pages.create(other, PageCreate(title="Server list", content="<p>server b</p>"), owner)

    found = (await SearchService(installed).search("server space:dms_1", owner)).pages

    assert [page.space_key for page in found] == ["DMS10"]


@pytest.mark.parametrize("typed", ["DMS10", "dms_1", "dms 1.0", "dms1"])
async def test_a_page_title_is_found_however_its_name_is_typed(
    installed: AsyncSession, typed: str
) -> None:
    owner = await _user(installed, "owner")
    space = await SpaceService(installed).create(SpaceCreate(key="ZZPAGES", name="Pages"), owner)
    await PageService(installed).create(
        space, PageCreate(title="dms1.0 overview", content="<p>what the system does</p>"), owner
    )

    found = (await SearchService(installed).search(typed, owner)).pages

    assert [page.title for page in found][:1] == ["dms1.0 overview"]


async def _person(session: AsyncSession, username: str, full_name: str) -> User:
    member = await _user(session, username)
    member.username = username
    member.full_name = full_name
    await session.flush()
    return member


@pytest.mark.parametrize(
    "typed", ["quân", "quan", "Quan Nguyen", "nguyen quan", "nguyễn văn quân", "quannv", "nguyen q"]
)
async def test_a_person_is_found_however_their_name_is_typed(
    installed: AsyncSession, typed: str
) -> None:
    viewer = await _user(installed, "viewer")
    await _person(installed, "quannv", "Nguyễn Văn Quân")
    await _person(installed, "lanpt", "Phạm Thị Lan")

    users = (await SearchService(installed).search(typed, viewer)).users

    assert [user.username for user in users] == ["quannv"]
    assert users[0].full_name == "Nguyễn Văn Quân"


async def test_a_username_with_breaks_is_found_typed_without_them(
    installed: AsyncSession,
) -> None:
    viewer = await _user(installed, "viewer")
    await _person(installed, "dms.bot_1", "DMS bot")

    users = (await SearchService(installed).search("dmsbot1", viewer)).users

    assert [user.username for user in users] == ["dms.bot_1"]


async def test_a_disabled_account_is_not_listed(installed: AsyncSession) -> None:
    viewer = await _user(installed, "viewer")
    gone = await _person(installed, "quannv", "Nguyễn Văn Quân")
    gone.is_active = False
    await installed.flush()

    assert (await SearchService(installed).search("quan", viewer)).users == []


async def test_people_are_not_listed_for_a_filtered_search(installed: AsyncSession) -> None:
    viewer = await _user(installed, "viewer")
    await _person(installed, "quannv", "Nguyễn Văn Quân")

    assert (await SearchService(installed).search("quan type:pdf", viewer)).users == []


async def test_an_author_filter_matches_the_name_without_accents(installed: AsyncSession) -> None:
    author = await _person(installed, "quannv", "Nguyễn Văn Quân")
    other = await _user(installed, "other")
    space = await SpaceService(installed).create(SpaceCreate(key="AUTHX", name="Auth"), author)
    pages = PageService(installed)
    await pages.create(space, PageCreate(title="Runbook one", content="<p>runbook</p>"), author)
    await pages.create(space, PageCreate(title="Runbook two", content="<p>runbook</p>"), other)

    found = (await SearchService(installed).search("runbook author:quan", author)).pages

    assert [page.title for page in found] == ["Runbook one"]


async def test_at_most_six_spaces_are_listed(installed: AsyncSession) -> None:
    owner = await _user(installed, "owner")
    spaces = SpaceService(installed)
    for index in range(8):
        await spaces.create(SpaceCreate(key=f"DMSX{index}", name=f"dms1.0 part {index}"), owner)

    found = (await SearchService(installed).search("dms1", owner)).spaces

    assert len(found) == 6


async def test_too_short_or_too_long_a_name_looks_for_no_one(installed: AsyncSession) -> None:
    service = SearchService(installed)

    assert await service._match_users("q") == []
    assert await service._compact_title_pages("x1" * 40, 10) == []
