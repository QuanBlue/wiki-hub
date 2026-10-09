"""Page restriction inheritance and additive access rules."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError, NotFoundError, PermissionDeniedError
from app.models.permission import Group, GroupMember, Permission
from app.models.restriction import PageRestrictionPermission
from app.models.space import SpaceRole, SpaceVisibility
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.pages.service import PageService
from app.modules.permissions.service import PermissionService
from app.modules.search.service import SearchService
from app.modules.spaces.service import SpaceService
from app.schemas.page import PageCreate, PageMove, PageUpdate
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


async def test_view_and_edit_restrictions_inherit_to_children(
    session: AsyncSession,
) -> None:
    # Restricted, not the SpaceCreate default of Open - the final assertion
    # downgrades viewer's role specifically to prove that away, which an
    # Open space's automatic Add-for-everyone (OPEN_SPACE_PERMISSIONS) would
    # otherwise paper over.
    owner = await _user(session, "owner")
    viewer = await _user(session, "viewer")
    editor = await _user(session, "editor")
    spaces = SpaceService(session)
    space = await spaces.create(
        SpaceCreate(key="REST", name="Restrictions", visibility=SpaceVisibility.restricted), owner
    )
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

    # View-only on the parent: the child, with no restrictions of its own,
    # follows the parent - viewable but not editable.
    assert not await permissions.can_edit_page(parent, viewer)
    assert not await permissions.can_edit_page(child, viewer)

    # Edit on the parent reaches the child without a separate grant there.
    await permissions.set_page_restriction(
        parent, viewer.id, PageRestrictionPermission.edit, owner, group=False, present=True
    )
    assert await permissions.can_edit_page(parent, viewer)
    assert await permissions.can_edit_page(child, viewer)
    assert not await permissions.can_edit_page(child, editor)

    # A child can still narrow further on its own: an Edit allow-list there
    # that leaves this user out takes Edit away on the child only.
    await permissions.set_page_restriction(
        child, owner.id, PageRestrictionPermission.edit, owner, group=False, present=True
    )
    assert await permissions.can_edit_page(parent, viewer)
    assert not await permissions.can_edit_page(child, viewer)
    await permissions.set_page_restriction(
        child, viewer.id, PageRestrictionPermission.edit, owner, group=False, present=True
    )
    assert await permissions.can_edit_page(child, viewer)

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
    # A group must have space access of its own before it can be named in a
    # page restriction - otherwise the restriction would "grant" access to a
    # group still locked out at the space door.
    await permissions.set_space_permission(
        space, group.id, Permission.view, owner, group=True, present=True
    )

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
    """An edit *denial* narrows who may write, not who may read."""
    owner = await _user(session, "owner")
    editor = await _user(session, "editor")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key="EDITF", name="Edit flags"), owner)
    await spaces.set_member(space, owner, editor.id, SpaceRole.editor)

    pages = PageService(session)
    page = await pages.create(space, PageCreate(title="Locked for editing"), owner)
    permissions = PermissionService(session)
    await permissions.set_page_permission_denial(
        page, editor.id, PageRestrictionPermission.edit, owner, group=False, denied=True
    )

    assert (await pages.to_read_for_user(page, owner)).is_restricted is False


async def test_an_edit_allow_list_entry_also_restricts_reading(
    session: AsyncSession,
) -> None:
    """Granting Edit implies View, so an Edit allow-list entry puts the page
    into Restricted mode - unlike an edit denial, which only narrows writes."""
    owner = await _user(session, "owner")
    editor = await _user(session, "editor")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key="EDITG", name="Edit grants"), owner)
    await spaces.set_member(space, owner, editor.id, SpaceRole.editor)

    pages = PageService(session)
    page = await pages.create(space, PageCreate(title="Edit allow-list"), owner)
    await PermissionService(session).set_page_restriction(
        page, editor.id, PageRestrictionPermission.edit, owner, group=False, present=True
    )

    assert (await pages.to_read_for_user(page, owner)).is_restricted is True


async def test_create_cannot_nest_a_page_under_a_parent_the_creator_cannot_view(
    session: AsyncSession,
) -> None:
    """Space-wide Add doesn't bypass a restricted parent's own View allow-list -
    otherwise the new child, inheriting that same restriction, would come out
    invisible to the very person who just created it."""
    owner = await _user(session, "owner")
    editor = await _user(session, "editor")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key="NESTV", name="Nesting"), owner)
    await spaces.set_member(space, owner, editor.id, SpaceRole.editor)

    pages = PageService(session)
    secret = await pages.create(space, PageCreate(title="Secret"), owner)
    await PermissionService(session).set_page_restriction(
        secret, owner.id, PageRestrictionPermission.view, owner, group=False, present=True
    )

    with pytest.raises(NotFoundError):
        await pages.create(
            space, PageCreate(title="Child", parent_id=secret.id), editor
        )

    # Owner, who can see the parent, has no trouble nesting under it.
    child = await pages.create(space, PageCreate(title="Child", parent_id=secret.id), owner)
    assert child.parent_id == secret.id


async def test_move_cannot_land_under_a_parent_the_actor_cannot_view(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    editor = await _user(session, "editor")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key="MOVEV", name="Move visibility"), owner)
    await spaces.set_member(space, owner, editor.id, SpaceRole.editor)

    permissions = PermissionService(session)
    await permissions.set_space_permission(
        space, editor.id, Permission.move, owner, group=False, present=True
    )
    pages = PageService(session)
    secret = await pages.create(space, PageCreate(title="Secret"), owner)
    await permissions.set_page_restriction(
        secret, owner.id, PageRestrictionPermission.view, owner, group=False, present=True
    )
    movable = await pages.create(space, PageCreate(title="Movable"), editor)

    with pytest.raises(NotFoundError):
        await pages.move(
            space,
            movable,
            PageMove(destination_space_key=space.key, parent_id=secret.id),
            editor,
        )


async def test_restriction_pickers_only_offer_principals_with_space_access(
    session: AsyncSession,
) -> None:
    """Naming someone in a page's allow-list who has no space access of their
    own would restrict the page to someone still locked out at the space
    door - so the pickers this dialog searches, and the write path itself,
    both refuse anyone the space hasn't already let in."""
    owner = await _user(session, "owner")
    member = await _user(session, "member")
    outsider = await _user(session, "outsider")
    spaces = SpaceService(session)
    space = await spaces.create(
        SpaceCreate(key="ACCPICK", name="Access pickers", visibility=SpaceVisibility.restricted),
        owner,
    )
    await spaces.set_member(space, owner, member.id, SpaceRole.viewer)
    group = Group(name=_username("has-access"), description="", owner_id=owner.id)
    outside_group = Group(name=_username("no-access"), description="", owner_id=owner.id)
    session.add_all([group, outside_group])
    await session.flush()

    permissions = PermissionService(session)
    await permissions.set_space_permission(
        space, group.id, Permission.view, owner, group=True, present=True
    )

    users = {u.username for u in await permissions.list_users_with_space_access(space)}
    assert owner.username in users
    assert member.username in users
    assert outsider.username not in users

    groups = {g.name for g in await permissions.list_groups_with_space_access(space)}
    assert group.name in groups
    assert outside_group.name not in groups

    # The picker the dialog actually searches lists *everyone* active, not
    # just the space-access subset - hiding an outsider outright makes
    # searching their name look like they don't exist. It flags each row
    # with whether the space grants them access instead, so the UI can grey
    # the row out and explain why rather than pretending it isn't there.
    user_flags = {
        u.username: has_access
        for u, has_access in await permissions.list_users_for_page_restriction_picker(space)
    }
    assert user_flags[owner.username] is True
    assert user_flags[member.username] is True
    assert user_flags[outsider.username] is False

    group_flags = {
        g.name: has_access
        for g, has_access in await permissions.list_groups_for_page_restriction_picker(space)
    }
    assert group_flags[group.name] is True
    assert group_flags[outside_group.name] is False

    # Eligible principals lead the list - scanning past a long roster of
    # "not added to space" rows to find the handful anyone could actually
    # pick would defeat the point of surfacing them at all.
    user_names = [u.username for u, _ in await permissions.list_users_for_page_restriction_picker(space)]
    assert user_names.index(outsider.username) > max(
        user_names.index(owner.username), user_names.index(member.username)
    )
    group_names = [g.name for g, _ in await permissions.list_groups_for_page_restriction_picker(space)]
    assert group_names.index(outside_group.name) > group_names.index(group.name)

    pages = PageService(session)
    page = await pages.create(space, PageCreate(title="Some page"), owner)
    with pytest.raises(BadRequestError):
        await permissions.set_page_restriction(
            page, outsider.id, PageRestrictionPermission.view, owner, group=False, present=True
        )
    with pytest.raises(BadRequestError):
        await permissions.set_page_restriction(
            page, outside_group.id, PageRestrictionPermission.view, owner, group=True, present=True
        )
    # A principal the space does grant access to is unaffected.
    await permissions.set_page_restriction(
        page, member.id, PageRestrictionPermission.view, owner, group=False, present=True
    )


async def test_open_space_lets_every_user_and_group_be_named_on_a_page(
    session: AsyncSession,
) -> None:
    """An Open space already lets every signed-in user in, so nobody there is
    "not added to space" - every active user and group is pickable and the
    write path accepts them without a space permission row."""
    owner = await _user(session, "owner")
    outsider = await _user(session, "outsider")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key=_username("OPN").upper()[:10], name="Open"), owner)
    group = Group(name=_username("any-group"), description="", owner_id=owner.id)
    session.add(group)
    await session.flush()
    permissions = PermissionService(session)

    user_flags = {
        u.id: has_access
        for u, has_access in await permissions.list_users_for_page_restriction_picker(space)
    }
    assert user_flags[outsider.id] is True
    group_flags = {
        g.id: has_access
        for g, has_access in await permissions.list_groups_for_page_restriction_picker(space)
    }
    assert group_flags[group.id] is True

    page = await PageService(session).create(space, PageCreate(title="Open page"), owner)
    await permissions.set_page_restriction(
        page, outsider.id, PageRestrictionPermission.view, owner, group=False, present=True
    )
    await permissions.set_page_restriction(
        page, group.id, PageRestrictionPermission.view, owner, group=True, present=True
    )
    assert await permissions.can_view_page(page, outsider)


async def test_child_roster_reflects_access_inherited_from_restricted_parent(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    allowed = await _user(session, "allowed")
    other = await _user(session, "other")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key=_username("INH").upper()[:10], name="Inherit"), owner)
    pages = PageService(session)
    parent = await pages.create(space, PageCreate(title="Locked parent"), owner)
    child = await pages.create(space, PageCreate(title="Child", parent_id=parent.id), owner)
    permissions = PermissionService(session)
    await permissions.set_page_restriction(
        parent, allowed.id, PageRestrictionPermission.view, owner, group=False, present=True
    )

    ancestor = await permissions.nearest_restricting_ancestor(child)
    assert ancestor is not None and ancestor.id == parent.id
    assert await permissions.nearest_restricting_ancestor(parent) is None

    roster = {
        account.id: (view, edit, view_locked, inherited)
        for account, view, edit, view_locked, _edit_locked, inherited in (
            await permissions.list_page_access_roster_users(child, space)
        )
    }
    # Can view the parent, not edit it -> same on the child, Edit inherited away.
    assert roster[allowed.id] == (True, False, False, True)
    # Not on the parent's list at all -> locked out of the child too.
    assert roster[other.id] == (False, False, True, True)
    assert roster[owner.id][:2] == (True, True)


async def test_roster_locks_both_boxes_for_a_space_admin_but_only_edit_for_a_viewer(
    session: AsyncSession,
) -> None:
    """`can_view_page`/`can_edit_page` bypass every page-level restriction
    for a space Admin, so the Open-mode roster locks both their View and
    Edit boxes - toggling either would silently do nothing. A plain viewer
    only has Edit locked (their space role never grants it), View stays
    togglable. A group holding space Admin gets the same double lock as a
    user would."""
    # Restricted, not the SpaceCreate default of Open - Open's automatic
    # Add-for-everyone (OPEN_SPACE_PERMISSIONS) would give the plain viewer
    # Edit too, defeating the point of this test.
    owner = await _user(session, "owner")
    space_admin = await _user(session, "space-admin")
    viewer = await _user(session, "viewer")
    spaces = SpaceService(session)
    space = await spaces.create(
        SpaceCreate(key="ADMLOCK", name="Admin lock", visibility=SpaceVisibility.restricted), owner
    )
    await spaces.set_member(space, owner, space_admin.id, SpaceRole.admin)
    await spaces.set_member(space, owner, viewer.id, SpaceRole.viewer)
    group = Group(name=_username("admin-group"), description="", owner_id=owner.id)
    session.add(group)
    await session.flush()

    permissions = PermissionService(session)
    await permissions.set_space_permission(
        space, group.id, Permission.admin, owner, group=True, present=True
    )

    pages = PageService(session)
    page = await pages.create(space, PageCreate(title="Some page"), owner)

    users_by_username = {
        user.username: (view, edit, view_locked, edit_locked)
        for user, view, edit, view_locked, edit_locked, _inherited in await permissions.list_page_access_roster_users(
            page, space
        )
    }
    assert users_by_username[space_admin.username] == (True, True, True, True)
    assert users_by_username[viewer.username] == (True, False, False, True)

    groups_by_name = {
        g.name: (view, edit, view_locked, edit_locked)
        for g, view, edit, view_locked, edit_locked, _inherited in await permissions.list_page_access_roster_groups(
            page, space
        )
    }
    assert groups_by_name[group.name] == (True, True, True, True)


async def test_removing_a_users_last_space_permission_purges_their_page_restrictions(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    member = await _user(session, "member")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key="PURGEU", name="Purge on removal", visibility=SpaceVisibility.restricted), owner)
    permissions = PermissionService(session)
    await permissions.set_space_permission(
        space, member.id, Permission.view, owner, group=False, present=True
    )

    pages = PageService(session)
    page = await pages.create(space, PageCreate(title="Restricted"), owner)
    await permissions.set_page_restriction(
        page, member.id, PageRestrictionPermission.view, owner, group=False, present=True
    )
    rows = await permissions.list_page_restrictions(page, owner)
    assert any(row["principal_id"] == member.id for row in rows)

    # Member's only space permission goes away - their page restriction
    # should not survive as a dangling, unreachable grant.
    await permissions.set_space_permission(
        space, member.id, Permission.view, owner, group=False, present=False
    )
    rows = await permissions.list_page_restrictions(page, owner)
    assert not any(row["principal_id"] == member.id for row in rows)


async def test_removing_a_groups_last_space_permission_purges_its_page_restrictions(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    member = await _user(session, "member")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key="PURGEG", name="Purge group on removal", visibility=SpaceVisibility.restricted), owner)
    group = Group(name=_username("team"), description="", owner_id=owner.id)
    session.add(group)
    await session.flush()
    session.add(GroupMember(group_id=group.id, user_id=member.id))
    await session.flush()

    permissions = PermissionService(session)
    await permissions.set_space_permission(
        space, group.id, Permission.view, owner, group=True, present=True
    )
    pages = PageService(session)
    page = await pages.create(space, PageCreate(title="Restricted"), owner)
    await permissions.set_page_restriction(
        page, group.id, PageRestrictionPermission.view, owner, group=True, present=True
    )
    rows = await permissions.list_page_restrictions(page, owner)
    assert any(row["principal_id"] == group.id for row in rows)

    await permissions.set_space_permission(
        space, group.id, Permission.view, owner, group=True, present=False
    )
    rows = await permissions.list_page_restrictions(page, owner)
    assert not any(row["principal_id"] == group.id for row in rows)


async def test_removing_a_member_via_the_legacy_endpoint_purges_their_page_restrictions(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    member = await _user(session, "member")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key="PURGEM", name="Purge via member removal", visibility=SpaceVisibility.restricted), owner)
    await spaces.set_member(space, owner, member.id, SpaceRole.viewer)

    permissions = PermissionService(session)
    pages = PageService(session)
    page = await pages.create(space, PageCreate(title="Restricted"), owner)
    await permissions.set_page_restriction(
        page, member.id, PageRestrictionPermission.view, owner, group=False, present=True
    )

    await spaces.remove_member(space, owner, member.id)
    rows = await permissions.list_page_restrictions(page, owner)
    assert not any(row["principal_id"] == member.id for row in rows)


async def test_child_can_stop_inheriting_starting_from_a_copy_of_its_parents_access(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    allowed = await _user(session, "allowed")
    other = await _user(session, "other")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key=_username("BRK").upper()[:10], name="Break"), owner)
    pages = PageService(session)
    parent = await pages.create(space, PageCreate(title="Locked parent"), owner)
    child = await pages.create(space, PageCreate(title="Child", parent_id=parent.id), owner)
    grandchild = await pages.create(
        space, PageCreate(title="Grandchild", parent_id=child.id), owner
    )
    permissions = PermissionService(session)
    await permissions.set_page_restriction(
        parent, allowed.id, PageRestrictionPermission.edit, owner, group=False, present=True
    )
    assert not await permissions.can_view_page(child, other)

    # Turning inheritance off copies the parent's list - nothing changes yet.
    await permissions.set_page_inheritance(child, owner, inherit=False)
    assert child.inherit_restrictions is False
    assert await permissions.page_view_is_restricted(child)
    assert await permissions.nearest_restricting_ancestor(child) is None
    assert await permissions.can_view_page(child, allowed)
    assert await permissions.can_edit_page(child, allowed)
    assert not await permissions.can_view_page(child, other)
    assert {row["principal_id"] for row in await permissions.list_page_restrictions(child, owner)} == {
        allowed.id
    }

    # Now the child can let in someone the parent never did, and its own
    # children follow the child, not the grandparent.
    await permissions.set_page_restriction(
        child, other.id, PageRestrictionPermission.view, owner, group=False, present=True
    )
    assert await permissions.can_view_page(child, other)
    assert await permissions.can_view_page(grandchild, other)
    assert not await permissions.can_view_page(parent, other)

    # Inheriting again drops the child's own settings and follows the parent.
    await permissions.set_page_inheritance(child, owner, inherit=True)
    assert child.inherit_restrictions is True
    assert await permissions.list_page_restrictions(child, owner) == []
    assert not await permissions.can_view_page(child, other)
    assert await permissions.can_view_page(child, allowed)

    with pytest.raises(BadRequestError):
        await permissions.set_page_inheritance(parent, owner, inherit=False)



async def test_a_childs_own_restricted_list_decides_for_itself_even_while_inheriting(
    session: AsyncSession,
) -> None:
    """"Restricted (own list)" must mean what it says: whoever the child's own
    list names can use the page, whatever the parent's list says - and the
    reverse, the parent's people are not let in just because the parent
    lists them. The parent itself is untouched."""
    owner = await _user(session, "owner")
    parents_editor = await _user(session, "pareditor")
    childs_editor = await _user(session, "kideditor")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key=_username("OWN").upper()[:10], name="Own"), owner)
    pages = PageService(session)
    parent = await pages.create(space, PageCreate(title="Closed parent"), owner)
    child = await pages.create(space, PageCreate(title="Child", parent_id=parent.id), owner)
    grandchild = await pages.create(
        space, PageCreate(title="Grandchild", parent_id=child.id), owner
    )
    permissions = PermissionService(session)
    edit = PageRestrictionPermission.edit
    await permissions.set_page_restriction(
        parent, parents_editor.id, edit, owner, group=False, present=True
    )
    # Until the child has its own list it follows the parent.
    assert await permissions.can_edit_page(child, parents_editor)
    assert not await permissions.can_view_page(child, childs_editor)

    # Own list: "kideditor" (never on the parent's list) can view and edit it.
    await permissions.set_page_restriction(
        child, childs_editor.id, edit, owner, group=False, present=True
    )
    assert child.inherit_restrictions is True  # still inheriting - no toggle needed
    assert await permissions.can_view_page(child, childs_editor)
    assert await permissions.can_edit_page(child, childs_editor)
    assert await permissions.can_edit_page(grandchild, childs_editor)
    # The parent's own list does not leak into a page that has its own.
    assert not await permissions.can_view_page(child, parents_editor)
    assert not await permissions.can_edit_page(grandchild, parents_editor)
    # And the child's list grants nothing on the parent.
    assert not await permissions.can_view_page(parent, childs_editor)
    assert await permissions.can_edit_page(parent, parents_editor)


async def test_audience_counts_who_can_actually_read_a_page(session: AsyncSession) -> None:
    owner = await _user(session, "owner")
    allowed = await _user(session, "allowed")
    await _user(session, "outsider")
    spaces = SpaceService(session)
    space = await spaces.create(SpaceCreate(key=_username("AUD").upper()[:10], name="Audience"), owner)
    pages = PageService(session)
    parent = await pages.create(space, PageCreate(title="Locked"), owner)
    child = await pages.create(space, PageCreate(title="Child", parent_id=parent.id), owner)
    open_page = await pages.create(space, PageCreate(title="Open"), owner)
    group = Group(name=_username("aud-group"), description="", owner_id=owner.id)
    session.add(group)
    await session.flush()
    permissions = PermissionService(session)

    everyone_users, everyone_groups, everyone = await permissions.space_audience(space)
    assert everyone
    # Open space: every active user and group.
    assert everyone_users >= 3 and everyone_groups >= 1

    await permissions.set_page_restriction(
        parent, allowed.id, PageRestrictionPermission.view, owner, group=False, present=True
    )
    # Only the listed user, plus anyone who bypasses restrictions (the
    # owner); the child inherits that; an unrestricted page keeps everyone.
    parent_users, parent_groups, parent_everyone = await permissions.page_audience(parent, space)
    assert not parent_everyone
    assert parent_groups == 0 and 2 <= parent_users < everyone_users
    assert await permissions.page_audience(child, space) == (parent_users, parent_groups, False)
    assert await permissions.page_audience(open_page, space) == (
        everyone_users,
        everyone_groups,
        True,
    )


async def test_group_blocks_and_edit_only_lists_flow_down_the_chain(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    member = await _user(session, "member")
    spaces = SpaceService(session)
    space = await spaces.create(
        SpaceCreate(key=_username("CHN").upper()[:10], name="Chains"), owner
    )
    blocked_group = Group(name=_username("blocked"), description="", owner_id=owner.id)
    other_group = Group(name=_username("other"), description="", owner_id=owner.id)
    session.add_all([blocked_group, other_group])
    await session.flush()
    session.add(GroupMember(group_id=blocked_group.id, user_id=member.id))
    pages = PageService(session)
    parent = await pages.create(space, PageCreate(title="Parent"), owner)
    child = await pages.create(space, PageCreate(title="Child", parent_id=parent.id), owner)
    edit_only = await pages.create(space, PageCreate(title="Edit only"), owner)
    below = await pages.create(space, PageCreate(title="Below", parent_id=edit_only.id), owner)
    permissions = PermissionService(session)

    # No page in the space is restricted yet: the space's own audience.
    assert await permissions.page_audience(child, space) == await permissions.space_audience(
        space
    )

    # A block on the parent for a whole group reaches its members on the
    # child, though neither page is in Restricted mode.
    await permissions.set_page_permission_denial(
        parent,
        blocked_group.id,
        PageRestrictionPermission.view,
        owner,
        group=True,
        denied=True,
    )
    await permissions.set_page_permission_denial(
        parent,
        blocked_group.id,
        PageRestrictionPermission.edit,
        owner,
        group=True,
        denied=True,
    )
    assert not await permissions.can_view_page(child, member)
    assert await permissions._group_inherited_access([parent.id], blocked_group.id) == (
        False,
        False,
    )
    _users, groups, everyone = await permissions.page_audience(child, space)
    _space_users, space_groups, _ = await permissions.space_audience(space)
    assert everyone is False
    assert groups == space_groups - 1
    # A page whose own chain carries nothing follows nobody, even though
    # another page in the space is restricted.
    assert await permissions.nearest_restricting_ancestor(below) is None

    # An Edit allow-list on a page switched back to Open still keeps Edit
    # from every group not on it, down the chain.
    await permissions.set_page_restriction(
        edit_only, owner.id, PageRestrictionPermission.edit, owner, group=False, present=True
    )
    await permissions.set_page_view_mode(edit_only, owner, restricted=False)
    assert (await permissions.nearest_restricting_ancestor(below)).id == edit_only.id
    roster = {
        group.id: (view, edit)
        for group, view, edit, *_rest in await permissions.list_page_access_roster_groups(
            below, space
        )
    }
    assert roster[other_group.id] == (True, False)

    # Asking a page to keep inheriting when it already does changes nothing.
    await permissions.set_page_inheritance(child, owner, inherit=True)
    assert child.inherit_restrictions is True
    # Stopping inheritance copies the parent's block, without doubling one
    # the child already carries for the same group.
    await permissions.set_page_permission_denial(
        child,
        blocked_group.id,
        PageRestrictionPermission.view,
        owner,
        group=True,
        denied=True,
    )
    await permissions.set_page_inheritance(child, owner, inherit=False)
    assert not await permissions.can_view_page(child, member)
