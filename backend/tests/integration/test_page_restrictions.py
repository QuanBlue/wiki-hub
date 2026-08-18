"""Page restriction inheritance and additive access rules."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import PermissionDeniedError
from app.models.permission import Group, GroupMember
from app.models.restriction import PageRestrictionPermission
from app.models.space import SpaceRole
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.pages.service import PageService
from app.modules.permissions.service import PermissionService
from app.modules.search.service import SearchService
from app.modules.spaces.service import SpaceService
from app.schemas.page import PageCreate, PageUpdate
from app.schemas.space import SpaceCreate
from app.schemas.user import UserCreate

pytestmark = pytest.mark.integration


def _username(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


async def _user(session: AsyncSession, prefix: str) -> User:
    return await AuthService(session).create_user(
        UserCreate(
            username=_username(prefix),
            email=f"{_username(prefix)}@example.com",
            full_name=prefix,
            password="password-1234",
        )
    )


async def test_view_restrictions_inherit_to_children_but_edit_does_not(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    viewer = await _user(session, "viewer")
    editor = await _user(session, "editor")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key="REST", name="Restrictions"), owner)
    await spaces.set_member(space, owner, viewer.id, SpaceRole.editor)
    await spaces.set_member(space, owner, editor.id, SpaceRole.editor)

    pages = PageService(session)
    parent = await pages.create(space, PageCreate(title="Private parent"), owner)
    child = await pages.create(space, PageCreate(title="Child", parent_id=parent.id), owner)
    permissions = PermissionService(session)

    await permissions.set_page_restriction(
        parent, viewer.id, PageRestrictionPermission.view, owner, group=False, present=True
    )
    assert await permissions.can_view_page(parent, viewer)
    assert await permissions.can_view_page(child, viewer)
    assert not await permissions.can_view_page(parent, editor)
    assert not await permissions.can_view_page(child, editor)
    assert await permissions.can_view_page(parent, owner)

    await permissions.set_page_restriction(
        child, viewer.id, PageRestrictionPermission.edit, owner, group=False, present=True
    )
    assert await permissions.can_edit_page(child, viewer)
    assert not await permissions.can_edit_page(child, editor)

    # Edit restriction cannot grant the container's Add capability.
    await spaces.set_member(space, owner, viewer.id, SpaceRole.viewer)
    assert not await permissions.can_edit_page(child, viewer)


async def test_group_restriction_is_additive_and_inherits(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    member = await _user(session, "member")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key="GRP", name="Group restrictions"), owner)
    await spaces.set_member(space, owner, member.id, SpaceRole.editor)
    group = Group(name=_username("docs"), description="", owner_id=owner.id)
    session.add(group)
    await session.flush()
    session.add(GroupMember(group_id=group.id, user_id=member.id))
    pages = PageService(session)
    parent = await pages.create(space, PageCreate(title="Group parent"), owner)
    child = await pages.create(space, PageCreate(title="Group child", parent_id=parent.id), owner)
    permissions = PermissionService(session)

    await permissions.set_page_restriction(
        parent, group.id, PageRestrictionPermission.view, owner, group=True, present=True
    )
    assert await permissions.can_view_page(parent, member)
    assert await permissions.can_view_page(child, member)


async def test_page_restriction_blocks_read_update_and_list_results(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    outsider = await _user(session, "outsider")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key="REST", name="Restrictions"), owner)
    await spaces.set_member(space, owner, outsider.id, SpaceRole.editor)
    pages = PageService(session)
    page = await pages.create(space, PageCreate(title="Secret"), owner)
    permissions = PermissionService(session)
    await permissions.set_page_restriction(
        page, owner.id, PageRestrictionPermission.view, owner, group=False, present=True
    )

    visible_ids = [item.id for item in await pages.list_for_space(space, outsider)]
    assert page.id not in visible_ids
    with pytest.raises(PermissionDeniedError):
        await pages.require_page_view(page, outsider)
    with pytest.raises(PermissionDeniedError):
        await pages.update(space, page, PageUpdate(content="blocked"), outsider)


async def test_page_restriction_is_respected_by_search_and_recent(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    outsider = await _user(session, "outsider")
    spaces = SpaceService(session)
    space = await spaces.create(
        SpaceCreate(key=f"IDX{uuid.uuid4().hex[:6]}", name="Indexed restrictions"), owner
    )
    await spaces.set_member(space, owner, outsider.id, SpaceRole.editor)

    pages = PageService(session)
    public_page = await pages.create(
        space, PageCreate(title="Public indexed page", content="phase-two-token"), owner
    )
    private_page = await pages.create(
        space, PageCreate(title="Private indexed page", content="phase-two-token"), owner
    )
    await PermissionService(session).set_page_restriction(
        private_page,
        owner.id,
        PageRestrictionPermission.view,
        owner,
        group=False,
        present=True,
    )

    search_results = await SearchService(session).search("phase-two-token", outsider)
    assert [item.id for item in search_results.pages] == [public_page.id]

    recent_ids = {item.id for item in await pages.list_recent_pages(outsider)}
    assert public_page.id in recent_ids
    assert private_page.id not in recent_ids


async def test_is_restricted_reports_inherited_view_restrictions(
    session: AsyncSession,
) -> None:
    """The flag answers "is this page closed", not "may this user read it".

    An owner who can read everything still needs to see that a page is
    restricted, and a child inherits its parent's restriction without owning
    any rows of its own.
    """
    owner = await _user(session, "owner")
    reader = await _user(session, "reader")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key="FLAG", name="Flags"), owner)
    await spaces.set_member(space, owner, reader.id, SpaceRole.editor)

    pages = PageService(session)
    parent = await pages.create(space, PageCreate(title="Parent"), owner)
    child = await pages.create(space, PageCreate(title="Child", parent_id=parent.id), owner)
    sibling = await pages.create(space, PageCreate(title="Sibling"), owner)

    assert (await pages.to_read_for_user(parent, owner)).is_restricted is False
    assert (await pages.to_read_for_user(child, owner)).is_restricted is False

    permissions = PermissionService(session)
    await permissions.set_page_restriction(
        parent, reader.id, PageRestrictionPermission.view, owner, group=False, present=True
    )

    assert (await pages.to_read_for_user(parent, owner)).is_restricted is True
    # Inherited: the child carries no restriction rows of its own.
    assert (await pages.to_read_for_user(child, owner)).is_restricted is True
    assert (await pages.to_read_for_user(sibling, owner)).is_restricted is False


async def test_is_restricted_ignores_edit_only_restrictions(
    session: AsyncSession,
) -> None:
    """An edit restriction narrows who may write, not who may read."""
    owner = await _user(session, "owner")
    editor = await _user(session, "editor")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key="EDITF", name="Edit flags"), owner)
    await spaces.set_member(space, owner, editor.id, SpaceRole.editor)

    pages = PageService(session)
    page = await pages.create(space, PageCreate(title="Locked for editing"), owner)
    permissions = PermissionService(session)
    await permissions.set_page_restriction(
        page, editor.id, PageRestrictionPermission.edit, owner, group=False, present=True
    )

    assert (await pages.to_read_for_user(page, owner)).is_restricted is False
