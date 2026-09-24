"""Integration coverage for the permission service's less-travelled branches:
per-user Global Access overrides, space-owner guards, page-level blocks and the
page-access rosters."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError, PermissionDeniedError
from app.models.permission import (
    GlobalPermission,
    Group,
    GroupGlobalPermission,
    GroupMember,
    Permission,
    SpaceUserPermission,
)
from app.models.restriction import PageRestrictionPermission
from app.models.space import Space, SpaceVisibility
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.pages.service import PageService
from app.modules.permissions.service import PermissionService
from app.modules.spaces.service import SpaceService
from app.schemas.page import PageCreate
from app.schemas.space import SpaceCreate
from app.schemas.user import UserCreate

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


async def _group(session: AsyncSession, owner: User, *members: User) -> Group:
    group = Group(name=_name("group"), description="", owner_id=owner.id)
    session.add(group)
    await session.flush()
    for member in (owner, *members):
        session.add(GroupMember(group_id=group.id, user_id=member.id))
    await session.flush()
    return group


async def _space(
    session: AsyncSession, owner: User, *, visibility: SpaceVisibility = SpaceVisibility.open
) -> Space:
    return await SpaceService(session).create(
        SpaceCreate(key=f"E{uuid.uuid4().hex[:8]}", name="Edges", visibility=visibility), owner
    )


async def test_a_user_override_can_withdraw_and_then_be_cleared(session: AsyncSession) -> None:
    owner = await _user(session, "owner")
    member = await _user(session, "member")
    group = await _group(session, owner, member)
    session.add(GroupGlobalPermission(group_id=group.id, permission=GlobalPermission.manage_groups))
    await session.flush()
    permissions = PermissionService(session)

    assert GlobalPermission.manage_groups in await permissions.global_permissions(member)

    await permissions.set_user_permission_overrides(member, {})  # nothing to do
    await permissions.set_user_permission_overrides(member, {GlobalPermission.manage_groups: False})
    await session.flush()
    # The override beats the group's vote.
    assert GlobalPermission.manage_groups not in await permissions.global_permissions(member)

    await permissions.set_user_permission_overrides(member, {GlobalPermission.manage_groups: True})
    await session.flush()
    assert GlobalPermission.manage_groups in await permissions.global_permissions(member)

    await permissions.set_user_permission_overrides(member, {GlobalPermission.manage_groups: None})
    await session.flush()
    # Clearing an override that is already gone is harmless too.
    await permissions.set_user_permission_overrides(member, {GlobalPermission.manage_groups: None})
    assert GlobalPermission.manage_groups in await permissions.global_permissions(member)


async def test_a_superuser_with_a_system_admin_override_is_listed_once(
    session: AsyncSession,
) -> None:
    admin = await _user(session, "root", superuser=True)
    permissions = PermissionService(session)
    await permissions.set_user_permission_overrides(admin, {GlobalPermission.system_admin: True})
    await session.flush()

    listed = [
        (account.id, source)
        for account, source, _by, _group_name in await permissions.list_effective_system_admins()
        if account.id == admin.id
    ]

    assert listed == [(admin.id, "superuser")]


async def test_an_admin_group_still_applies_over_a_users_direct_grant(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    member = await _user(session, "member")
    space = await _space(session, owner, visibility=SpaceVisibility.restricted)
    group = await _group(session, owner, member)
    permissions = PermissionService(session)
    await permissions.set_space_permission(
        space, group.id, Permission.admin, owner, group=True, present=True
    )
    await permissions.set_space_permission(
        space, member.id, Permission.view, owner, group=False, present=True
    )

    assert Permission.admin in await permissions.effective_permissions(space, member)


async def test_only_owners_and_system_admins_pass_the_owner_guards(session: AsyncSession) -> None:
    owner = await _user(session, "owner")
    outsider = await _user(session, "outsider")
    space = await _space(session, owner)
    permissions = PermissionService(session)

    await permissions.require_owner(space, owner)  # the space's own Owner
    with pytest.raises(PermissionDeniedError):
        await permissions.require_owner(space, outsider)

    with pytest.raises(PermissionDeniedError):
        await permissions.set_space_owners(space, [outsider.id], outsider)
    with pytest.raises(ConflictError) as no_owner:
        await permissions.set_space_owners(space, [], owner)
    assert no_owner.value.code == "last_space_owner"
    with pytest.raises(NotFoundError):
        await permissions.set_space_owners(space, [uuid.uuid4()], owner)


async def test_view_cannot_be_removed_while_another_permission_depends_on_it(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    member = await _user(session, "member")
    space = await _space(session, owner, visibility=SpaceVisibility.restricted)
    group = await _group(session, owner, member)
    permissions = PermissionService(session)

    for permission in (Permission.view, Permission.add):
        await permissions.set_space_permission(
            space, group.id, permission, owner, group=True, present=True
        )
    with pytest.raises(ConflictError) as space_error:
        await permissions.set_space_permission(
            space, group.id, Permission.view, owner, group=True, present=False
        )
    assert space_error.value.code == "view_required"

    await permissions.set_space_permission(
        space, member.id, Permission.view, owner, group=False, present=True
    )
    page = await PageService(session).create(space, PageCreate(title="Guarded"), owner)
    for permission in (PageRestrictionPermission.view, PageRestrictionPermission.edit):
        await permissions.set_page_restriction(
            page, member.id, permission, owner, group=False, present=True
        )
    with pytest.raises(ConflictError) as page_error:
        await permissions.set_page_restriction(
            page, member.id, PageRestrictionPermission.view, owner, group=False, present=False
        )
    assert page_error.value.code == "view_required"


async def test_page_blocks_apply_to_viewing_editing_and_validation(session: AsyncSession) -> None:
    owner = await _user(session, "owner")
    member = await _user(session, "member")
    space = await _space(session, owner)
    pages = PageService(session)
    parent = await pages.create(space, PageCreate(title="Parent"), owner)
    child = await pages.create(space, PageCreate(title="Child", parent_id=parent.id), owner)
    permissions = PermissionService(session)

    assert await permissions.can_view_page(child, member) is True
    assert await permissions.can_edit_page(child, member) is True

    # A block on an *ancestor's* View closes every page beneath it.
    await permissions.set_page_permission_denial(
        parent, member.id, PageRestrictionPermission.view, owner, group=False, denied=True
    )
    assert await permissions.can_view_page(child, member) is False
    await permissions.set_page_permission_denial(
        parent, member.id, PageRestrictionPermission.view, owner, group=False, denied=False
    )

    # A block on the page's own Edit keeps them reading but not writing.
    await permissions.set_page_permission_denial(
        child, member.id, PageRestrictionPermission.edit, owner, group=False, denied=True
    )
    assert await permissions.can_view_page(child, member) is True
    assert await permissions.can_edit_page(child, member) is False

    with pytest.raises(NotFoundError):
        await permissions.set_page_permission_denial(
            child, uuid.uuid4(), PageRestrictionPermission.view, owner, group=False, denied=True
        )


async def test_blocking_a_principal_with_an_allow_list_row_turns_it_into_a_block(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    member = await _user(session, "member")
    space = await _space(session, owner)
    permissions = PermissionService(session)
    await permissions.set_space_permission(
        space, member.id, Permission.view, owner, group=False, present=True
    )
    page = await PageService(session).create(space, PageCreate(title="Listed"), owner)
    await permissions.set_page_restriction(
        page, member.id, PageRestrictionPermission.view, owner, group=False, present=True
    )

    await permissions.set_page_permission_denial(
        page, member.id, PageRestrictionPermission.view, owner, group=False, denied=True
    )

    roster = {
        account.id: view
        for account, view, _edit, _view_locked, _edit_locked in (
            await permissions.list_page_access_roster_users(page, space)
        )
    }
    assert roster[member.id] is False


async def test_rosters_reflect_direct_and_group_blocks(session: AsyncSession) -> None:
    owner = await _user(session, "owner")
    direct = await _user(session, "direct")
    via_group = await _user(session, "viagroup")
    space = await _space(session, owner, visibility=SpaceVisibility.restricted)
    group = await _group(session, owner, via_group)
    permissions = PermissionService(session)
    for principal, is_group in ((direct.id, False), (via_group.id, False), (group.id, True)):
        for permission in (Permission.view, Permission.add):
            await permissions.set_space_permission(
                space, principal, permission, owner, group=is_group, present=True
            )
    page = await PageService(session).create(space, PageCreate(title="Roster"), owner)

    await permissions.set_page_permission_denial(
        page, direct.id, PageRestrictionPermission.edit, owner, group=False, denied=True
    )
    await permissions.set_page_permission_denial(
        page, group.id, PageRestrictionPermission.view, owner, group=True, denied=True
    )

    users = {
        account.id: (view, edit, view_locked, edit_locked)
        for account, view, edit, view_locked, edit_locked in (
            await permissions.list_page_access_roster_users(page, space)
        )
    }
    # A direct block wins for that user; a block on the group reaches its members.
    assert users[direct.id][:2] == (True, False)
    assert users[via_group.id][:2] == (False, False)
    assert users[owner.id] == (True, True, True, True)  # an admin's boxes are locked on

    groups = {
        found.id: (view, edit, view_locked, edit_locked)
        for found, view, edit, view_locked, edit_locked in (
            await permissions.list_page_access_roster_groups(page, space)
        )
    }
    assert groups[group.id] == (False, False, False, True)


async def test_rosters_are_empty_when_nobody_holds_space_access(session: AsyncSession) -> None:
    owner = await _user(session, "owner")
    space = await _space(session, owner, visibility=SpaceVisibility.restricted)
    page = await PageService(session).create(space, PageCreate(title="Empty"), owner)
    await session.execute(delete(SpaceUserPermission).where(SpaceUserPermission.space_id == space.id))
    permissions = PermissionService(session)

    assert await permissions.list_page_access_roster_users(page, space) == []
    assert await permissions.list_page_access_roster_groups(page, space) == []
