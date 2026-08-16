from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, Mock

import pytest

from app.repositories.audit import AuditLogRepository
from app.repositories.page import PageRepository
from app.repositories.revision import PageRevisionRepository
from app.repositories.space import SpaceRepository
from app.repositories.user import UserRepository


def _scalars(values=()):
    scalars = Mock(all=Mock(return_value=list(values)))
    scalars.unique.return_value = scalars
    return Mock(scalars=Mock(return_value=scalars))


@pytest.mark.asyncio
async def test_page_and_revision_repositories_cover_reads_and_writes() -> None:
    session = Mock()
    session.get = AsyncMock(return_value="entity")
    session.execute = AsyncMock(
        side_effect=[
            Mock(scalar_one_or_none=Mock(return_value="slug")),
            Mock(scalar_one_or_none=Mock(return_value="slug")),
            _scalars(["page"]),
            _scalars(["all"]),
            _scalars(["child"]),
            Mock(scalar_one=Mock(return_value=3)),
            Mock(scalar_one_or_none=Mock(return_value=None)),
            _scalars(["recent"]),
        ]
    )
    session.delete = AsyncMock()
    pages = PageRepository(session)
    page_id, user_id = uuid.uuid4(), uuid.uuid4()
    assert await pages.get(page_id) == "entity"
    assert await pages.get_by_slug(page_id, " Slug ") == "slug"
    assert await pages.slug_exists(page_id, "slug")
    assert list(await pages.list_for_space(page_id)) == ["page"]
    assert list(await pages.list_all_for_space(page_id)) == ["all"]
    assert list(await pages.list_children(page_id)) == ["child"]
    assert await pages.like_count(page_id) == 3
    assert await pages.is_liked(page_id, user_id) is True
    session.get = AsyncMock(return_value=None)
    await pages.set_like(page_id, user_id, True)
    session.get = AsyncMock(return_value=Mock())
    await pages.set_like(page_id, user_id, False)
    session.execute = AsyncMock(return_value=_scalars(["recent"]))
    assert list(await pages.list_recent_pages(limit=2)) == ["recent"]
    page = Mock()
    session.add.reset_mock()
    assert pages.add(page) is page
    await pages.delete(page)
    session.add.assert_called_once_with(page)

    revision_session = Mock()
    revision_session.execute = AsyncMock(
        side_effect=[_scalars(["revision"]), Mock(scalar_one_or_none=Mock(return_value="one")), Mock(scalar_one_or_none=Mock(return_value=2))]
    )
    revisions = PageRevisionRepository(revision_session)
    assert list(await revisions.list_for_page(page_id)) == ["revision"]
    assert await revisions.get_by_version(page_id, 1) == "one"
    assert await revisions.get_max_version(page_id) == 2
    assert revisions.add(page) is page


@pytest.mark.asyncio
async def test_space_repository_covers_memberships_favourites_and_listing() -> None:
    session = Mock()
    session.get = AsyncMock(return_value="space")
    session.execute = AsyncMock(
        side_effect=[
            Mock(scalar_one_or_none=Mock(return_value="by-key")),
            _scalars(["spaces"]), _scalars(["recent"]), _scalars(["favorite"]),
            Mock(scalar_one=Mock(return_value=4)),
            Mock(scalar_one_or_none=Mock(return_value="member")), _scalars(["member"]),
            Mock(),
            Mock(scalar_one_or_none=Mock(return_value=None)),
            _scalars(["id-1"]),
            Mock(scalar_one_or_none=Mock(return_value=None)),
            Mock(),
        ]
    )
    session.delete = AsyncMock()
    spaces = SpaceRepository(session)
    space_id, user_id = uuid.uuid4(), uuid.uuid4()
    assert await spaces.get(space_id) == "space"
    assert await spaces.get_by_key(" eng ") == "by-key"
    assert list(await spaces.list_spaces()) == ["spaces"]
    assert list(await spaces.list_recent()) == ["recent"]
    assert list(await spaces.list_favorites(user_id)) == ["favorite"]
    assert await spaces.count_members(space_id) == 4
    assert await spaces.get_member(space_id, user_id) == "member"
    assert list(await spaces.list_members(space_id)) == ["member"]
    await spaces.remove_member(space_id, user_id)
    assert await spaces.is_favorite(space_id, user_id) is False
    assert await spaces.favorite_ids(user_id) == {"id-1"}
    await spaces.add_favorite(space_id, user_id)
    await spaces.remove_favorite(space_id, user_id)
    space = Mock()
    assert spaces.add(space) is space
    await spaces.delete(space)


@pytest.mark.asyncio
async def test_user_and_audit_repositories_cover_filters_and_pagination() -> None:
    session = Mock()
    session.get = AsyncMock(return_value="user")
    session.execute = AsyncMock(
        side_effect=[
            Mock(scalar_one_or_none=Mock(return_value="username")),
            Mock(scalar_one_or_none=Mock(return_value="email")),
            Mock(scalar_one_or_none=Mock(return_value="identifier")),
            Mock(scalar_one_or_none=Mock(return_value="protected")),
            _scalars(["user"]), Mock(scalar_one=Mock(return_value=2)),
            Mock(scalar_one=Mock(return_value=1)), Mock(scalar_one=Mock(return_value=1)), _scalars(["user"]),
        ]
    )
    users = UserRepository(session)
    user_id = uuid.uuid4()
    assert await users.get(user_id) == "user"
    assert await users.get_by_username(" USER ") == "username"
    assert await users.get_by_email(" E@X ") == "email"
    assert await users.get_by_identifier(" login ") == "identifier"
    assert await users.get_protected() == "protected"
    assert list(await users.list_all()) == ["user"]
    assert await users.count() == 2
    assert await users.count_active_superusers() == 1
    assert await users.search(q="x", status="active", role="admin") == (["user"], 1)
    session.execute = AsyncMock(
        side_effect=[Mock(scalar_one=Mock(return_value=0)), _scalars([])]
    )
    assert await users.search(status="disabled", role="member") == ([], 0)
    user = Mock()
    assert users.add(user) is user

    audit_session = Mock()
    audit_session.execute = AsyncMock(
        side_effect=[Mock(scalar_one=Mock(return_value=5)), _scalars(["audit"])]
    )
    audit = AuditLogRepository(audit_session)
    assert await audit.search(action="login", entity_type="user", q="admin", limit=1) == (["audit"], 5)
    assert audit.add(user) is user
