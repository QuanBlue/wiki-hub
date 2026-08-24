from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.core.exceptions import ConflictError, NotFoundError
from app.models.permission import Permission
from app.models.space import SpaceRole, SpaceStatus, SpaceVisibility
from app.modules.spaces.service import SpaceService
from app.schemas.space import SpaceCreate, SpaceUpdate


def make_service() -> SpaceService:
    result = SpaceService(Mock())
    result.session.flush = AsyncMock()
    result.session.refresh = AsyncMock()
    # `.all()` must resolve synchronously - a bare `AsyncMock()` return value
    # makes it a coroutine, which `dict(...)` in to_read_many() can't iterate.
    result.session.execute = AsyncMock(return_value=Mock(all=Mock(return_value=[])))
    result.session.scalar = AsyncMock()
    result.session.add = Mock()
    result.session.add_all = Mock()
    result.permissions = Mock()
    result.permissions.require = AsyncMock()
    result.permissions.role_of = AsyncMock(return_value=SpaceRole.admin)
    result.permissions.effective_permissions = AsyncMock(
        return_value={Permission.view, Permission.add, Permission.admin}
    )
    result.permissions._has_space_admin = AsyncMock(return_value=True)
    result.spaces = Mock()
    result.users = Mock()
    return result


def space():
    return SimpleNamespace(
        id=uuid.uuid4(),
        key="ENG",
        name="Engineering",
        description="Docs",
        icon="book",
        font_family="inherit",
        status=SpaceStatus.active,
        visibility=SpaceVisibility.open,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
        created_by=SimpleNamespace(username="alice"),
        members=[],
    )


@pytest.mark.asyncio
async def test_space_reads_serialization_and_listing() -> None:
    service = make_service()
    actor = SimpleNamespace(id=uuid.uuid4())
    current = space()
    await service.require_view(current, actor)
    await service.require_add(current, actor)
    await service.require_admin(current, actor)
    service.spaces.is_favorite = AsyncMock(return_value=True)
    result = await service.to_read(current, actor)
    assert result.key == "ENG" and result.is_favorite is True and result.my_role is SpaceRole.admin
    service.spaces.favorite_ids = AsyncMock(return_value={current.id})
    assert len(await service.to_read_many([current], actor)) == 1

    service.spaces.get_by_key = AsyncMock(return_value=current)
    assert await service.get_by_key("ENG") is current
    service.spaces.get_by_key = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        await service.get_by_key("MISSING")

    service.spaces.list_spaces = AsyncMock(return_value=[current])
    assert len(await service.list_spaces(actor)) == 1
    service.spaces.list_recent = AsyncMock(return_value=[current])
    assert len(await service.list_recent(actor)) == 1
    service.spaces.list_favorites = AsyncMock(return_value=[current])
    assert len(await service.list_favorites(actor)) == 1
    member = SimpleNamespace(
        user_id=actor.id,
        user=SimpleNamespace(username="alice", full_name="Alice"),
        role=SpaceRole.viewer,
    )
    service.spaces.list_members = AsyncMock(return_value=[member])
    assert (await service.list_members(current))[0].username == "alice"


@pytest.mark.asyncio
async def test_space_create_update_archive_delete_and_favourites() -> None:
    service = make_service()
    actor = SimpleNamespace(id=uuid.uuid4(), username="alice")
    service.spaces.get_by_key = AsyncMock(return_value=None)
    created = await service.create(
        SpaceCreate(key="ENG", name=" Engineering ", description=" Docs ", icon=" book"), actor
    )
    assert created.name == "Engineering"
    service.spaces.get_by_key = AsyncMock(return_value=created)
    with pytest.raises(ConflictError):
        await service.create(SpaceCreate(key="ENG", name="Again"), actor)

    await service.update(created, SpaceUpdate(description=" New "), actor)
    await service.update(created, SpaceUpdate(font_family=" Inter "), actor)
    assert created.font_family == "inter"
    await service.update(created, SpaceUpdate(font_family=None), actor)
    assert created.font_family is None
    await service.update(
        created,
        SpaceUpdate(name="New", icon="x", status="archived", visibility="restricted"),
        actor,
    )
    assert created.status is SpaceStatus.archived
    await service.archive(created, actor)
    await service.unarchive(created, actor)
    service.spaces.delete = AsyncMock()
    await service.delete(created, actor)
    service.spaces.add_favorite = AsyncMock()
    service.spaces.remove_favorite = AsyncMock()
    await service.set_favorite(created, actor, True)
    await service.set_favorite(created, actor, False)


@pytest.mark.asyncio
async def test_membership_updates_and_last_admin_guards() -> None:
    service = make_service()
    actor = SimpleNamespace(id=uuid.uuid4())
    target = SimpleNamespace(id=uuid.uuid4(), username="bob", full_name="Bob")
    current = space()
    service.users.get = AsyncMock(return_value=target)
    service.spaces.get_member = AsyncMock(return_value=None)
    service.session.scalar.return_value = None
    result = await service.set_member(current, actor, target.id, SpaceRole.editor)
    assert result.username == "bob"

    existing = SimpleNamespace(user_id=target.id, role=SpaceRole.editor)
    service.spaces.get_member = AsyncMock(return_value=existing)
    result = await service.set_member(current, actor, target.id, SpaceRole.viewer)
    assert result.role is SpaceRole.viewer

    service.spaces.get_member = AsyncMock(return_value=SimpleNamespace(role=SpaceRole.admin))
    service.session.scalar.return_value = object()
    service.permissions._has_space_admin = AsyncMock(return_value=False)
    with pytest.raises(ConflictError):
        await service.set_member(current, actor, target.id, SpaceRole.viewer)

    service.spaces.remove_member = AsyncMock()
    service.spaces.get_member = AsyncMock(return_value=existing)
    service.session.scalar.return_value = None
    service.permissions._has_space_admin = AsyncMock(return_value=True)
    await service.remove_member(current, actor, target.id)
    await service.session.flush()

    service.spaces.get_member = AsyncMock(return_value=SimpleNamespace(role=SpaceRole.admin))
    service.permissions._has_space_admin = AsyncMock(return_value=False)
    with pytest.raises(ConflictError):
        await service.remove_member(current, actor, target.id)

    service.users.get = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        await service.set_member(current, actor, target.id, SpaceRole.viewer)


@pytest.mark.asyncio
async def test_personal_spaces_are_not_directory_listed_for_other_users() -> None:
    """A Confluence personal space (key "~username") stays viewable by a
    direct visit for anyone the archive granted access to, but must not show
    up in list_spaces()/list_recent()/list_favorites() for anyone but its
    owner or a system administrator - Confluence itself never lists another
    person's personal space in the Space Directory either.
    """
    service = make_service()
    personal = SimpleNamespace(key="~alice", visibility=SpaceVisibility.open)

    owner = SimpleNamespace(id=uuid.uuid4(), username="alice")
    service.permissions.is_system_admin = AsyncMock(return_value=False)
    assert await service._is_listable(personal, owner) is True

    other = SimpleNamespace(id=uuid.uuid4(), username="bob")
    service.permissions.is_system_admin = AsyncMock(return_value=False)
    assert await service._is_listable(personal, other) is False

    admin = SimpleNamespace(id=uuid.uuid4(), username="root")
    service.permissions.is_system_admin = AsyncMock(return_value=True)
    assert await service._is_listable(personal, admin) is True

    # A regular team space is unaffected regardless of who is asking.
    team = SimpleNamespace(key="ENG", visibility=SpaceVisibility.open)
    service.permissions.is_system_admin = AsyncMock(return_value=False)
    assert await service._is_listable(team, other) is True


@pytest.mark.asyncio
async def test_record_visit_and_list_top_visited() -> None:
    service = make_service()
    current = space()
    actor = SimpleNamespace(id=uuid.uuid4())
    service.spaces.record_visit = AsyncMock()
    await service.record_visit(current, actor)
    service.spaces.record_visit.assert_awaited_once_with(current.id, actor.id)

    service.spaces.top_visited = AsyncMock(return_value=[current])
    service.spaces.favorite_ids = AsyncMock(return_value=set())
    result = await service.list_top_visited(actor, limit=5)
    assert [space_read.key for space_read in result] == ["ENG"]
    service.spaces.top_visited.assert_awaited_once_with(actor.id, limit=5)
