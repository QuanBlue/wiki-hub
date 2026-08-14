"""Integration coverage for additive groups and Space permissions."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, PermissionDeniedError
from app.models.permission import (
    GlobalPermission,
    Group,
    GroupGlobalPermission,
    GroupMember,
    Permission,
)
from app.models.restriction import PageRestrictionPermission
from app.models.space import SpaceRole, SpaceVisibility
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.pages.service import PageService
from app.modules.permissions.service import PermissionService
from app.modules.spaces.service import SpaceService
from app.schemas.page import PageCreate
from app.schemas.space import SpaceCreate, SpaceUpdate
from app.schemas.user import UserCreate, UserUpdate

pytestmark = pytest.mark.integration


def _name(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


async def _user(session: AsyncSession, prefix: str, *, superuser: bool = False) -> User:
    return await AuthService(session).create_user(
        UserCreate(
            username=_name(prefix),
            email=f"{_name(prefix)}@example.com",
            full_name=prefix,
            password="password-1234",
            is_superuser=superuser,
        )
    )


async def _group(session: AsyncSession, owner: User, member: User) -> Group:
    group = Group(name=_name("group"), description="", owner_id=owner.id)
    session.add(group)
    await session.flush()
    session.add(GroupMember(group_id=group.id, user_id=owner.id))
    session.add(GroupMember(group_id=group.id, user_id=member.id))
    await session.flush()
    return group


async def test_direct_and_multiple_group_permissions_are_additive(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    member = await _user(session, "member")
    space = await SpaceService(session).create(
        SpaceCreate(
            key=f"PERM{uuid.uuid4().hex[:5]}",
            name="Permission union",
            visibility=SpaceVisibility.restricted,
        ),
        owner,
    )
    first = await _group(session, owner, member)
    second = await _group(session, owner, member)
    permissions = PermissionService(session)

    await permissions.set_space_permission(
        space, first.id, Permission.view, owner, group=True, present=True
    )
    await permissions.set_space_permission(
        space, second.id, Permission.delete, owner, group=True, present=True
    )
    await permissions.set_space_permission(
        space, member.id, Permission.add, owner, group=False, present=True
    )

    assert await permissions.effective_permissions(space, member) == {
        Permission.view,
        Permission.add,
        Permission.delete,
    }

    await permissions.set_space_permission(
        space, first.id, Permission.view, owner, group=True, present=False
    )
    assert Permission.delete in await permissions.effective_permissions(space, member)
    assert Permission.view not in await permissions.effective_permissions(space, member)


async def test_restricted_space_needs_view_assignment_and_open_space_is_readable(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    outsider = await _user(session, "outsider")
    service = SpaceService(session)
    open_space = await service.create(
        SpaceCreate(key=f"OPEN{uuid.uuid4().hex[:5]}", name="Open"), owner
    )
    restricted_space = await service.create(
        SpaceCreate(
            key=f"REST{uuid.uuid4().hex[:5]}",
            name="Restricted",
            visibility=SpaceVisibility.restricted,
        ),
        owner,
    )
    permissions = PermissionService(session)

    assert Permission.view in await permissions.effective_permissions(open_space, outsider)
    assert Permission.view not in await permissions.effective_permissions(
        restricted_space, outsider
    )

    await permissions.set_space_permission(
        restricted_space, outsider.id, Permission.view, owner, group=False, present=True
    )
    assert Permission.view in await permissions.effective_permissions(restricted_space, outsider)


async def test_system_admin_group_bypasses_space_and_global_checks(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    system_admin = await _user(session, "system")
    space = await SpaceService(session).create(
        SpaceCreate(
            key=f"SYS{uuid.uuid4().hex[:5]}",
            name="System-admin access",
            visibility=SpaceVisibility.restricted,
        ),
        owner,
    )
    group = await _group(session, owner, system_admin)
    session.add(
        GroupGlobalPermission(group_id=group.id, permission=GlobalPermission.system_admin)
    )
    await session.flush()
    permissions = PermissionService(session)

    assert await permissions.is_system_admin(system_admin)
    assert set(await permissions.global_permissions(system_admin)) == {
        GlobalPermission.system_admin
    }
    assert await permissions.has_global(system_admin, GlobalPermission.manage_users)
    assert await permissions.effective_permissions(space, system_admin) == set(Permission)

    page = await PageService(session).create(space, PageCreate(title="Private"), owner)
    await permissions.set_page_restriction(
        page,
        owner.id,
        PageRestrictionPermission.view,
        owner,
        group=False,
        present=True,
    )
    assert await permissions.can_view_page(page, system_admin)
    await SpaceService(session).update(space, SpaceUpdate(name="Renamed"), system_admin)


async def test_space_keeps_an_admin_and_groups_cannot_be_deleted_when_assigned(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    member = await _user(session, "member")
    service = SpaceService(session)
    space = await service.create(
        SpaceCreate(key=f"SAFE{uuid.uuid4().hex[:5]}", name="Safety"), owner
    )
    group = await _group(session, owner, member)
    permissions = PermissionService(session)
    await permissions.set_space_permission(
        space, group.id, Permission.admin, owner, group=True, present=True
    )
    await permissions.set_space_permission(
        space, owner.id, Permission.admin, owner, group=False, present=True
    )
    await permissions.set_space_permission(
        space, owner.id, Permission.admin, owner, group=False, present=False
    )

    with pytest.raises(ConflictError, match="administrator"):
        await permissions.set_space_permission(
            space, group.id, Permission.admin, owner, group=True, present=False
        )

    await permissions.set_space_permission(
        space, owner.id, Permission.admin, owner, group=False, present=True
    )
    await permissions.set_space_permission(
        space, group.id, Permission.admin, owner, group=True, present=False
    )
    await permissions.set_space_permission(
        space, group.id, Permission.view, owner, group=True, present=True
    )

    with pytest.raises(ConflictError, match="permission assignments"):
        await permissions.delete_group(group, owner)

    await permissions.set_space_permission(
        space, group.id, Permission.view, owner, group=True, present=False
    )
    await permissions.delete_group(group, owner)


async def test_edit_restriction_grants_view_but_not_space_add(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    member = await _user(session, "member")
    service = SpaceService(session)
    space = await service.create(
        SpaceCreate(
            key=f"EDIT{uuid.uuid4().hex[:5]}",
            name="Edit restrictions",
            visibility=SpaceVisibility.restricted,
        ),
        owner,
    )
    page = await PageService(session).create(space, PageCreate(title="Restricted edit"), owner)
    permissions = PermissionService(session)
    await permissions.set_page_restriction(
        page, owner.id, PageRestrictionPermission.view, owner, group=False, present=True
    )
    await permissions.set_page_restriction(
        page, member.id, PageRestrictionPermission.edit, owner, group=False, present=True
    )

    assert await permissions.can_view_page(page, member) is False
    await permissions.set_space_permission(
        space, member.id, Permission.view, owner, group=False, present=True
    )
    assert await permissions.can_view_page(page, member)
    assert await permissions.can_edit_page(page, member) is False
    await permissions.set_space_permission(
        space, member.id, Permission.add, owner, group=False, present=True
    )
    assert await permissions.can_edit_page(page, member)
    page_read = await PageService(session).to_read_for_user(page, member)
    assert page_read.can_edit
    assert not page_read.can_export
    await permissions.set_space_permission(
        space, member.id, Permission.export, owner, group=False, present=True
    )
    assert (await PageService(session).to_read_for_user(page, member)).can_export


async def test_delete_own_is_limited_to_pages_created_by_the_actor(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    member = await _user(session, "member")
    spaces = SpaceService(session)
    space = await spaces.create(
        SpaceCreate(key=f"DELO{uuid.uuid4().hex[:5]}", name="Delete own"), owner
    )
    permissions = PermissionService(session)
    for permission in (Permission.view, Permission.add, Permission.delete_own):
        await permissions.set_space_permission(
            space, member.id, permission, owner, group=False, present=True
        )
    pages = PageService(session)
    owner_page = await pages.create(space, PageCreate(title="Owner page"), owner)
    member_page = await pages.create(space, PageCreate(title="Member page"), member)

    with pytest.raises(PermissionDeniedError):
        await pages.delete(space, owner_page, member)
    await pages.delete(space, member_page, member)


async def test_deactivating_last_space_admin_is_rejected(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    second_admin = await _user(session, "admin")
    actor = await _user(session, "root", superuser=True)
    spaces = SpaceService(session)
    space = await spaces.create(
        SpaceCreate(key=f"DEAC{uuid.uuid4().hex[:5]}", name="Deactivation safety"), owner
    )
    account_service = AuthService(session, actor=actor)

    with pytest.raises(ConflictError, match="administrator"):
        await account_service.update_user(owner.id, UserUpdate(is_active=False))

    await spaces.set_member(space, owner, second_admin.id, SpaceRole.admin)
    updated = await account_service.update_user(owner.id, UserUpdate(is_active=False))
    assert not updated.is_active


async def test_legacy_membership_cannot_remove_the_last_space_admin(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    second_admin = await _user(session, "admin")
    spaces = SpaceService(session)
    space = await spaces.create(
        SpaceCreate(key=f"ROLE{uuid.uuid4().hex[:5]}", name="Role safety"), owner
    )

    with pytest.raises(ConflictError, match="administrator"):
        await spaces.set_member(space, owner, owner.id, SpaceRole.viewer)

    await spaces.set_member(space, owner, second_admin.id, SpaceRole.admin)
    await spaces.set_member(space, owner, owner.id, SpaceRole.viewer)

    with pytest.raises(ConflictError, match="administrator"):
        await spaces.remove_member(space, second_admin, second_admin.id)
