from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.core.exceptions import ConflictError, NotFoundError, PermissionDeniedError
from app.models.permission import GlobalPermission, Permission
from app.models.restriction import PageRestrictionPermission
from app.models.space import SpaceRole, SpaceVisibility
from app.modules.permissions.service import PermissionService
from app.schemas.permission import GroupCreate, GroupUpdate


def svc() -> PermissionService:
    service = PermissionService(Mock())
    service.session.scalar = AsyncMock()
    service.session.scalars = AsyncMock()
    service.session.get = AsyncMock()
    service.session.execute = AsyncMock()
    service.session.flush = AsyncMock()
    service.session.delete = AsyncMock()
    service.session.add = Mock()
    return service


def user(**values):
    defaults = {"id": uuid.uuid4(), "is_superuser": False, "is_active": True, "username": "u"}
    defaults.update(values)
    return SimpleNamespace(**defaults)


@pytest.mark.asyncio
async def test_permission_resolution_and_guards() -> None:
    service = svc()
    admin = user(is_superuser=True)
    regular = user()
    space = SimpleNamespace(id=uuid.uuid4(), visibility=SpaceVisibility.open)
    assert await service.is_system_admin(admin) is True
    assert await service.global_permissions(admin)
    assert await service.effective_permissions(space, admin)
    assert await service.role_of(space, admin) is SpaceRole.admin

    service.session.scalar.return_value = None
    service.session.scalars.side_effect = [[], []]
    assert await service.is_system_admin(regular) is False
    permissions = await service.effective_permissions(space, regular)
    assert permissions == {Permission.view}
    service.session.scalars.side_effect = [[], []]
    assert await service.role_of(space, regular) is SpaceRole.viewer
    service.session.scalars.side_effect = [[], []]
    with pytest.raises(PermissionDeniedError):
        await service.require(space, regular, Permission.delete)
    with pytest.raises(PermissionDeniedError):
        await service.require_global(regular, GlobalPermission.manage_groups)

    service.session.scalars.side_effect = None
    service.session.scalars.return_value = [GlobalPermission.manage_groups]
    assert await service.global_permissions(regular) == [GlobalPermission.manage_groups]
    service.effective_permissions = AsyncMock(return_value={Permission.add})
    assert await service.role_of(space, regular) is SpaceRole.editor
    service.effective_permissions = AsyncMock(return_value=set())
    assert await service.role_of(space, regular) is None


@pytest.mark.asyncio
async def test_group_and_removal_rules() -> None:
    service = svc()
    actor = user(is_superuser=True)
    owner = user()
    service.session.get.return_value = owner
    service.session.scalar.side_effect = [None, None]
    group = await service.create_group(
        GroupCreate(name=" Team ", description=" Desc ", owner_id=owner.id), actor
    )
    assert group.name == "Team"
    service.session.get.return_value = group
    assert await service.get_group(group.id) is group
    assert await service.can_manage_group(group, actor) is True
    await service.update_group(group, GroupUpdate(name="Renamed", description="D", is_active=False), actor)
    assert group.name == "Renamed" and group.is_active is False

    service.session.scalar.side_effect = [None, None, None]
    await service.delete_group(group, actor)
    service.session.delete.assert_awaited_once_with(group)

    service.session.scalar = AsyncMock(return_value=object())
    with pytest.raises(ConflictError):
        await service.assert_user_can_be_removed(owner)


@pytest.mark.asyncio
async def test_page_visibility_and_restriction_helpers() -> None:
    service = svc()
    actor = user()
    space = SimpleNamespace(id=uuid.uuid4(), visibility=SpaceVisibility.open)
    page = SimpleNamespace(id=uuid.uuid4(), space_id=space.id, parent_id=None)
    service.session.get.return_value = space
    service.is_system_admin = AsyncMock(return_value=False)
    service.effective_permissions = AsyncMock(return_value={Permission.view, Permission.add})
    service._restriction_rows_exist = AsyncMock(return_value=False)
    service._principal_has_restriction = AsyncMock(return_value=False)
    assert await service.can_view_page(page, actor) is True
    assert await service.can_edit_page(page, actor) is True

    service._restriction_rows_exist = AsyncMock(return_value=True)
    assert await service.can_edit_page(page, actor) is False
    service._principal_has_restriction = AsyncMock(return_value=True)
    assert await service.can_edit_page(page, actor) is True

    service.effective_permissions = AsyncMock(return_value={Permission.view, Permission.restrictions})
    await service.require_page_restriction_admin(page, actor)
    service.effective_permissions = AsyncMock(return_value={Permission.view})
    with pytest.raises(PermissionDeniedError):
        await service.require_page_restriction_admin(page, actor)

    service.session.scalar.side_effect = [None, None]
    assert await PermissionService._restriction_rows_exist(
        service, page.id, PageRestrictionPermission.view
    ) is False
    service.session.scalar.side_effect = [object(), None]
    assert await PermissionService._restriction_rows_exist(
        service, page.id, PageRestrictionPermission.view
    ) is True


@pytest.mark.asyncio
async def test_page_restriction_listing_and_missing_space() -> None:
    service = svc()
    actor = user()
    page = SimpleNamespace(id=uuid.uuid4(), space_id=uuid.uuid4(), parent_id=None)
    service.session.get.return_value = None
    with pytest.raises(NotFoundError):
        await service.require_page_restriction_admin(page, actor)

    space = SimpleNamespace(id=page.space_id, visibility=SpaceVisibility.open)
    service.session.get.return_value = space
    service.effective_permissions = AsyncMock(return_value={Permission.view, Permission.restrictions})
    service.session.execute.side_effect = [
        Mock(all=Mock(return_value=[
            (SimpleNamespace(permission=PageRestrictionPermission.view), SimpleNamespace(id="u", username="user"))
        ])),
        Mock(all=Mock(return_value=[
            (SimpleNamespace(permission=PageRestrictionPermission.edit), SimpleNamespace(id="g", name="group"))
        ])),
    ]
    rows = await service.list_page_restrictions(page, actor)
    assert {row["principal_type"] for row in rows} == {"user", "group"}


@pytest.mark.asyncio
async def test_group_members_and_global_permissions() -> None:
    service = svc()
    actor = user(is_superuser=True)
    group = SimpleNamespace(id=uuid.uuid4(), owner_id=uuid.uuid4())
    target = user()
    service.session.get = AsyncMock(return_value=target)
    service.session.scalar = AsyncMock(return_value=None)
    await service.set_group_member(group, target.id, actor, True)
    assert service.session.add.called

    existing = SimpleNamespace()
    service.session.scalar = AsyncMock(return_value=existing)
    await service.set_group_member(group, target.id, actor, False)
    service.session.delete.assert_awaited_with(existing)

    group.owner_id = target.id
    with pytest.raises(ConflictError):
        await service.set_group_member(group, target.id, actor, False)
    service.session.get = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        await service.set_group_member(group, target.id, actor, True)

    denied = svc()
    denied.can_manage_group = AsyncMock(return_value=False)
    with pytest.raises(PermissionDeniedError):
        await denied.set_group_member(group, target.id, actor, True)
    denied.is_system_admin = AsyncMock(return_value=False)
    with pytest.raises(PermissionDeniedError):
        await denied.set_group_global_permission(group, GlobalPermission.manage_groups, actor, True)

    service.session.get = AsyncMock(return_value=group)
    service.session.scalar = AsyncMock(return_value=None)
    await service.set_group_global_permission(group, GlobalPermission.manage_groups, actor, True)
    service.session.scalar = AsyncMock(return_value=existing)
    await service.set_group_global_permission(group, GlobalPermission.manage_groups, actor, False)
    service.session.delete.assert_awaited_with(existing)


@pytest.mark.asyncio
async def test_space_and_page_permission_assignments() -> None:
    service = svc()
    actor = user(is_superuser=True)
    space = SimpleNamespace(id=uuid.uuid4(), visibility=SpaceVisibility.open)
    page = SimpleNamespace(id=uuid.uuid4(), space_id=space.id)
    principal = SimpleNamespace(id=uuid.uuid4(), is_active=True)
    service.require = AsyncMock()
    service.session.get = AsyncMock(return_value=principal)
    service.session.scalar = AsyncMock(return_value=None)
    await service.set_space_permission(
        space, principal.id, Permission.view, actor, group=False, present=True
    )
    service.session.scalar = AsyncMock(return_value=SimpleNamespace())
    await service.set_space_permission(
        space, principal.id, Permission.view, actor, group=False, present=False
    )

    service._has_space_admin = AsyncMock(return_value=False)
    service.session.scalar = AsyncMock(return_value=SimpleNamespace())
    with pytest.raises(ConflictError):
        await service.set_space_permission(
            space, principal.id, Permission.admin, actor, group=False, present=False
        )
    service.session.get = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        await service.set_space_permission(
            space, principal.id, Permission.view, actor, group=False, present=True
        )

    service.require_page_restriction_admin = AsyncMock()
    service.session.get = AsyncMock(return_value=principal)
    service.session.scalar = AsyncMock(return_value=None)
    await service.set_page_restriction(
        page, principal.id, PageRestrictionPermission.view, actor, group=False, present=True
    )
    service.session.scalar = AsyncMock(return_value=SimpleNamespace())
    await service.set_page_restriction(
        page, principal.id, PageRestrictionPermission.view, actor, group=False, present=False
    )


@pytest.mark.asyncio
async def test_group_lifecycle_and_space_admin_removal_checks() -> None:
    service = svc()
    actor = user(is_superuser=True)
    owner = user()
    service.require_global = AsyncMock()
    service.session.get = AsyncMock(return_value=owner)
    service.session.scalar = AsyncMock(return_value=None)
    group = await service.create_group(GroupCreate(name="Team", owner_id=owner.id), actor)
    assert group.owner_id == owner.id

    service.session.get = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        await service.create_group(GroupCreate(name="Other", owner_id=owner.id), actor)
    service.session.get = AsyncMock(return_value=owner)
    service.session.scalar = AsyncMock(return_value=SimpleNamespace())
    with pytest.raises(ConflictError):
        await service.create_group(GroupCreate(name="Team", owner_id=owner.id), actor)
    service.session.get = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        await service.get_group(uuid.uuid4())

    service.can_manage_group = AsyncMock(return_value=True)
    service.session.get = AsyncMock(return_value=owner)
    service.session.scalar = AsyncMock(side_effect=[None, None])
    await service.update_group(group, GroupUpdate(owner_id=owner.id, name="Renamed", is_active=False), actor)
    assert group.name == "Renamed"
    service.session.scalar = AsyncMock(return_value=SimpleNamespace())
    with pytest.raises(ConflictError):
        await service.update_group(group, GroupUpdate(name="Taken"), actor)
    service.session.scalar = AsyncMock(return_value=SimpleNamespace())
    with pytest.raises(ConflictError):
        await service.delete_group(group, actor)

    service.can_manage_group = AsyncMock(return_value=False)
    with pytest.raises(PermissionDeniedError):
        await service.update_group(group, GroupUpdate(name="Denied"), actor)
    with pytest.raises(PermissionDeniedError):
        await service.delete_group(group, actor)

    service.can_manage_group = AsyncMock(return_value=True)
    service.session.get = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        await service.update_group(group, GroupUpdate(owner_id=uuid.uuid4()), actor)

    space_id = uuid.uuid4()
    service.session.scalar = AsyncMock(side_effect=[None, None, None, None])
    service.session.scalars = AsyncMock(side_effect=[{space_id}, set()])
    with pytest.raises(ConflictError):
        await service.assert_user_can_be_removed(owner)
    service.session.scalar = AsyncMock(side_effect=[None, object(), None, None])
    service.session.scalars = AsyncMock(side_effect=[{space_id}, set()])
    await service.assert_user_can_be_removed(owner)

    service.session.scalar = AsyncMock(side_effect=[object(), None])
    assert await service._has_space_admin(SimpleNamespace(id=space_id), excluding={"user_id": owner.id})
    service.session.scalar = AsyncMock(side_effect=[None, object()])
    assert await service._has_space_admin(SimpleNamespace(id=space_id), excluding={"group_id": uuid.uuid4()})
    service.session.scalar = AsyncMock(side_effect=[None, None])
    assert not await service._has_space_admin(SimpleNamespace(id=space_id), excluding={})


@pytest.mark.asyncio
async def test_page_restriction_principal_and_visibility_branches() -> None:
    service = svc()
    actor = user()
    page = SimpleNamespace(id=uuid.uuid4(), space_id=uuid.uuid4(), parent_id=None)
    space = SimpleNamespace(id=page.space_id, visibility=SpaceVisibility.open)

    service.session.scalar = AsyncMock(side_effect=[object(), None])
    assert await service._principal_has_restriction(
        page.id, actor, PageRestrictionPermission.view
    )
    service.session.scalar = AsyncMock(side_effect=[None, object()])
    assert await service._principal_has_restriction(
        page.id, actor, PageRestrictionPermission.edit
    )

    parent = SimpleNamespace(id=uuid.uuid4(), parent_id=None)
    page.parent_id = parent.id
    service.session.get = AsyncMock(side_effect=[parent, None])
    assert await service._page_chain(page) == [parent, page]

    service.session.get = AsyncMock(return_value=space)
    service.is_system_admin = AsyncMock(return_value=True)
    assert await service.can_view_page(page, actor)
    service.is_system_admin = AsyncMock(return_value=False)
    service.effective_permissions = AsyncMock(return_value=set())
    assert not await service.can_view_page(page, actor)
    service.session.get = AsyncMock(return_value=None)
    assert not await service.can_view_page(page, actor)

    service.session.get = AsyncMock(return_value=space)
    page.parent_id = None
    service.effective_permissions = AsyncMock(return_value={Permission.view, Permission.admin})
    assert await service.can_view_page(page, actor)
    service.effective_permissions = AsyncMock(return_value={Permission.view})
    service._restriction_rows_exist = AsyncMock(return_value=False)
    service._principal_has_restriction = AsyncMock(return_value=False)
    assert not await service.can_edit_page(page, actor)
    service.effective_permissions = AsyncMock(return_value={Permission.view, Permission.add})
    service._restriction_rows_exist = AsyncMock(return_value=True)
    service._principal_has_restriction = AsyncMock(return_value=False)
    assert not await service.can_edit_page(page, actor)


@pytest.mark.asyncio
async def test_group_restriction_missing_principal() -> None:
    service = svc()
    actor = user(is_superuser=True)
    page = SimpleNamespace(id=uuid.uuid4(), space_id=uuid.uuid4())
    service.require_page_restriction_admin = AsyncMock()
    service.session.get = AsyncMock(return_value=None)
    with pytest.raises(NotFoundError):
        await service.set_page_restriction(
            page, uuid.uuid4(), PageRestrictionPermission.view, actor, group=True, present=True
        )
