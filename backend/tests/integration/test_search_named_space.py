# ruff: noqa: F811
"""A question that names a space ("how many servers does dms4 have") is about that space's
pages first, whatever else happens to mention the name."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.pages.service import PageService
from app.modules.search.query import build_concepts
from app.modules.search.service import SearchService, _names_space
from app.modules.spaces.service import SpaceService
from app.schemas.page import PageCreate
from app.schemas.space import SpaceCreate
from tests.integration.test_hybrid_semantic_search import (  # noqa: F401 - fixture
    _user,
    installed,
)

pytestmark = pytest.mark.integration


def test_a_word_names_a_space_by_its_key_or_name() -> None:
    assert _names_space("dms4", "3DMS40", "3.dms.saas")
    assert _names_space("voffice", "3VOF", "3.voffice")
    assert _names_space("devops", "DEVSECOPS", "2.team_devops")
    # Too common, or merely a part of a longer name.
    assert not _names_space("team", "2TEAM", "2.team_frontend")
    assert not _names_space("dms", "3DMS40", "3.dms.saas")
    assert not _names_space("server", "3DSP", "3.dsp")


def test_filler_words_are_not_ideas() -> None:
    words = [c.words for c in build_concepts("Hệ thống dms4 đang có bao nhiêu server")]
    assert ("dang",) not in words and ("dms4",) in words
    # "đăng ký" and "đăng nhập" are still ideas.
    assert ("dang", "ky") in [c.words for c in build_concepts("đăng ký tài khoản")]
    assert ("dang",) in [c.words for c in build_concepts("Đặng Văn Hùng")]


async def test_the_named_space_comes_first(installed: AsyncSession) -> None:
    owner = await _user(installed, "owner")
    spaces = SpaceService(installed)
    named = await spaces.create(SpaceCreate(key="ZIRCON40", name="Zircon ops"), owner)
    other = await spaces.create(SpaceCreate(key="OTHERX", name="Other notes"), owner)
    pages = PageService(installed)
    await pages.create(
        other,
        PageCreate(title="zircon4 notes", content="<p>zircon4 server migration plan</p>"),
        owner,
    )
    await pages.create(
        named,
        PageCreate(title="VM list", content="<p>server app-1, server app-2, server db-1</p>"),
        owner,
    )

    found = (await SearchService(installed).search("zircon4 có bao nhiêu server", owner)).pages

    assert found[0].title == "VM list"
    assert "zircon4 notes" in [page.title for page in found]
