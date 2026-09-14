"""Integration coverage for additive groups and Space permissions."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.groups import group_read, group_usage
from app.core.exceptions import ConflictError, PermissionDeniedError
from app.models.permission import (
    GlobalPermission,
    Group,
    GroupGlobalPermission,
    GroupMember,
    Permission,
)
from app.models.restriction import PageRestrictionPermission
from app.models.space import Space, SpaceRole, SpaceStatus, SpaceVisibility
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.pages.service import PageService
from app.modules.permissions.service import PermissionService
from app.modules.spaces.service import SpaceService
from app.schemas.page import PageCreate
from app.schemas.permission import GroupCreate, GroupUpdate
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


async def test_multiple_group_permissions_are_additive(
    session: AsyncSession,
) -> None:
    """A user in several groups gets the union of what each group grants -
    unaffected by the direct-grant override below, since this member has no
    permission row of their own on the space."""
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

    # Export follows View automatically now, so it's implied here too.
    assert await permissions.effective_permissions(space, member) == {
        Permission.view,
        Permission.delete,
        Permission.export,
    }

    await permissions.set_space_permission(
        space, first.id, Permission.view, owner, group=True, present=False
    )
    assert Permission.delete in await permissions.effective_permissions(space, member)
    assert Permission.view not in await permissions.effective_permissions(space, member)


async def test_a_direct_user_grant_overrides_group_permissions_entirely(
    session: AsyncSession,
) -> None:
    """A direct grant on a user is authoritative for that user, not just
    another additive source - it's how an otherwise-broad group (say, a
    default "everyone" group with View + Add) can be narrowed for one
    specific member, by giving them their own, smaller row."""
    owner = await _user(session, "owner")
    member = await _user(session, "member")
    space = await SpaceService(session).create(
        SpaceCreate(
            key=f"PERM{uuid.uuid4().hex[:5]}",
            name="Direct override",
            visibility=SpaceVisibility.restricted,
        ),
        owner,
    )
    everyone = await _group(session, owner, member)
    permissions = PermissionService(session)
    await permissions.set_space_permission(
        space, everyone.id, Permission.view, owner, group=True, present=True
    )
    await permissions.set_space_permission(
        space, everyone.id, Permission.add, owner, group=True, present=True
    )

    # No direct row yet: member inherits the group's View + Add in full.
    assert await permissions.effective_permissions(space, member) == {
        Permission.view,
        Permission.add,
        Permission.export,
    }

    # Give member their own, narrower row - it now decides everything for
    # them; the group's Add no longer carries through.
    await permissions.set_space_permission(
        space, member.id, Permission.view, owner, group=False, present=True
    )
    assert await permissions.effective_permissions(space, member) == {
        Permission.view,
        Permission.export,
    }

    # Dropping the direct row again restores the group-derived permissions.
    await permissions.set_space_permission(
        space, member.id, Permission.view, owner, group=False, present=False
    )
    assert await permissions.effective_permissions(space, member) == {
        Permission.view,
        Permission.add,
        Permission.export,
    }


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
    session.add(GroupGlobalPermission(group_id=group.id, permission=GlobalPermission.system_admin))
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


async def test_list_effective_system_admins_covers_every_path_and_dedupes_groups(
    session: AsyncSession,
) -> None:
    """`list_effective_system_admins` backs the Administrators tab - it must
    run against a real database, not mocks: the group-granted branch selects
    full `User` rows and originally deduplicated them with `.distinct()`,
    which PostgreSQL rejects once `social_links` (a plain `json` column, no
    equality operator) is among the selected columns. A user in *two*
    system_admin groups is what triggers that dedup path at all."""
    owner = await _user(session, "owner")
    superuser = await _user(session, "superuser", superuser=True)
    group_admin = await _user(session, "groupadmin")
    override_admin = await _user(session, "overrideadmin")
    denied_admin = await _user(session, "deniedadmin")

    first_group = await _group(session, owner, group_admin)
    session.add(
        GroupGlobalPermission(group_id=first_group.id, permission=GlobalPermission.system_admin)
    )
    # A second group granting the same permission to the same user is what
    # would have produced a duplicate row for `group_admin` pre-`group_by`.
    second_group = await _group(session, owner, group_admin)
    session.add(
        GroupGlobalPermission(group_id=second_group.id, permission=GlobalPermission.system_admin)
    )
    denied_group = await _group(session, owner, denied_admin)
    session.add(
        GroupGlobalPermission(group_id=denied_group.id, permission=GlobalPermission.system_admin)
    )
    await session.flush()

    permissions = PermissionService(session)
    await permissions.set_user_permission_overrides(
        override_admin, {GlobalPermission.system_admin: True}
    )
    # A deny override beats the group grant above - `denied_admin` must not
    # appear at all despite being a member of `denied_group`.
    await permissions.set_user_permission_overrides(
        denied_admin, {GlobalPermission.system_admin: False}
    )

    admins = await permissions.list_effective_system_admins()
    by_id = {user.id: (source, granted_by, granted_via_group)
             for user, source, granted_by, granted_via_group in admins}

    assert by_id[superuser.id][0] == "superuser"
    assert by_id[group_admin.id][0] == "group"
    assert by_id[override_admin.id][0] == "override"
    assert denied_admin.id not in by_id
    # Exactly one row for `group_admin`, not one per system_admin group.
    assert sum(1 for user, *_ in admins if user.id == group_admin.id) == 1

    # `superuser` was made one at creation, via `AuthService.create_user` -
    # that *is* audited (a `user_created` row), but the fixture builds its
    # own unauthenticated `AuthService(session)` with no actor, so the actor
    # on that row is the audit trail's fallback: "system".
    assert by_id[superuser.id][1] == "system"
    # `override_admin` got their override through
    # `set_user_permission_overrides` directly, bypassing `update_user` (and
    # so the audit trail) entirely - nothing to attribute it to at all.
    assert by_id[override_admin.id][1] is None
    # `group_admin` has no per-user actor to name, but both groups that grant
    # it are named.
    assert by_id[group_admin.id][2] is not None
    assert first_group.name in by_id[group_admin.id][2]
    assert second_group.name in by_id[group_admin.id][2]


async def test_list_effective_system_admins_reports_who_granted_it(
    session: AsyncSession,
) -> None:
    """The actual feature: promote/override *through* `AuthService`, as a
    named actor, and confirm the Administrators tab can say who did it -
    not just that it happened."""
    protected, _created, _rotated, _changed = await AuthService(session).ensure_bootstrap_admin(
        username=_name("root"),
        password="password-1234",
        email=f"{_name('root')}@example.com",
        full_name="root",
    )
    member = await _user(session, "member")
    other = await _user(session, "other")

    acting_service = AuthService(session, actor=protected)
    await acting_service.update_user(member.id, UserUpdate(is_superuser=True))
    await acting_service.update_user(
        other.id, UserUpdate(global_permission_overrides={GlobalPermission.system_admin: True})
    )

    by_id = {
        user.id: (source, granted_by, granted_via_group)
        for user, source, granted_by, granted_via_group in (
            await PermissionService(session).list_effective_system_admins()
        )
    }

    assert by_id[member.id] == ("superuser", protected.username, None)
    assert by_id[other.id] == ("override", protected.username, None)

    # Demote `member` back to Member, then re-promote as a *different* actor
    # - the report must follow the most recent grant, not the first one.
    # Postgres's `now()` is frozen for the life of a transaction, so without
    # a commit in between, these two audit rows would land with an
    # identical timestamp and the ordering this relies on would be
    # accidental - `get_db` commits once per request in production, which is
    # what actually keeps sequential grants ordered there.
    await acting_service.update_user(member.id, UserUpdate(is_superuser=False))
    await session.commit()
    await AuthService(session, actor=other).update_user(
        member.id, UserUpdate(is_superuser=True)
    )

    by_id = {
        user.id: (source, granted_by)
        for user, source, granted_by, _ in (
            await PermissionService(session).list_effective_system_admins()
        )
    }
    assert by_id[member.id] == ("superuser", other.username)


async def test_group_read_and_usage_report_every_space_and_page_it_grants(
    session: AsyncSession,
) -> None:
    """`GroupRead.space_count`/`page_count` (the Directory table's "used in"
    numbers) and `group_usage` (the Edit Group dialog's "Used in" tab) must
    agree, and both must survive a group holding *more than one* permission
    on the same Space or Page - the exact shape that would double-count with
    a naive `len(rows)` instead of counting distinct spaces/pages, the same
    class of bug `list_effective_system_admins` had with `.distinct()` on a
    `json` column (not applicable here - space/page ids are plain UUID
    columns - but the multi-row-per-entity shape is the same trap)."""
    owner = await _user(session, "owner")
    member = await _user(session, "member")
    group = await _group(session, owner, member)
    permissions = PermissionService(session)

    space = await SpaceService(session).create(
        SpaceCreate(key=f"USAGE{uuid.uuid4().hex[:5]}", name="Usage tracking"), owner
    )
    # Two permissions on the *same* space - must count as one space, not two.
    await permissions.set_space_permission(
        space, group.id, Permission.view, owner, group=True, present=True
    )
    await permissions.set_space_permission(
        space, group.id, Permission.add, owner, group=True, present=True
    )

    page = await PageService(session).create(space, PageCreate(title="Restricted"), owner)
    # An allow-list grant and a block, both on the same page - must count as
    # one page, not two, and both entries must show up distinctly.
    await permissions.set_page_restriction(
        page, group.id, PageRestrictionPermission.view, owner, group=True, present=True
    )
    await permissions.set_page_permission_denial(
        page, group.id, PageRestrictionPermission.edit, owner, group=True, denied=True
    )

    read = await group_read(session, group)
    assert read.space_count == 1
    assert read.page_count == 1

    usage = await group_usage(session, group)
    assert len(usage.spaces) == 1
    assert usage.spaces[0].space_id == space.id
    assert usage.spaces[0].space_key == space.key
    assert set(usage.spaces[0].permissions) == {Permission.view, Permission.add}

    assert len(usage.pages) == 1
    assert usage.pages[0].page_id == page.id
    assert usage.pages[0].page_slug == page.slug
    assert usage.pages[0].space_id == space.id
    entries = {(entry.permission, entry.denied) for entry in usage.pages[0].entries}
    assert entries == {
        (PageRestrictionPermission.view, False),
        (PageRestrictionPermission.edit, True),
    }

    # Dropping one of the two space permissions - but not both - must still
    # count as one space (not zero), now with just the remaining permission.
    # Dropping *every* permission is covered by
    # `test_multiple_group_permissions_are_additive` and friends already;
    # `set_space_permission` also purges any now-orphaned page restriction
    # for the group at that point, which is a separate, already-covered
    # behaviour this test isn't about.
    await permissions.set_space_permission(
        space, group.id, Permission.view, owner, group=True, present=False
    )
    read = await group_read(session, group)
    assert read.space_count == 1
    usage = await group_usage(session, group)
    assert usage.spaces[0].permissions == [Permission.add]
    # The page restriction is untouched - the group still has space access.
    assert read.page_count == 1


async def test_superuser_is_owner_of_a_space_that_was_never_given_one(
    session: AsyncSession,
) -> None:
    """A space created outside `SpaceService.create` entirely - the shape an
    import, restore, or seed script produces - has no `SpaceOwner` row at
    all. A system administrator must still be able to administer it and show
    up as its Owner (see `PermissionService.is_space_owner`/
    `list_space_owners`), rather than the space silently having nobody who
    can."""
    admin = await _user(session, "sysadmin", superuser=True)
    outsider = await _user(session, "outsider")
    imported = Space(
        key=f"IMPORT{uuid.uuid4().hex[:5]}",
        name="Imported space",
        description="",
        icon="",
        status=SpaceStatus.active,
        visibility=SpaceVisibility.restricted,
        created_by_id=admin.id,
    )
    session.add(imported)
    await session.flush()
    permissions = PermissionService(session)

    assert await permissions.is_space_owner(imported, admin)
    assert not await permissions.is_space_owner(imported, outsider)
    owners = await permissions.list_space_owners(imported)
    assert [owner.id for owner in owners] == [admin.id]
    assert await permissions.effective_permissions(imported, admin) == set(Permission)

    # Owner-only actions (see `require_owner`) work for the admin too, purely
    # from being a system administrator - no explicit `SpaceOwner` row
    # needed to flip this space's own access mode.
    await SpaceService(session).update(
        imported, SpaceUpdate(visibility=SpaceVisibility.open), admin
    )


async def test_group_admin_permission_is_freely_revocable_once_the_space_has_an_owner(
    session: AsyncSession,
) -> None:
    """`_has_space_admin`'s "keep at least one administrator" guard used to
    be the only thing standing between a space and total unmanageability -
    so revoking the last admin-permission row anywhere would raise. An
    Owner (see SpaceOwner) is now that guarantee instead: the creator is
    always the space's first Owner, so revoking every ordinary admin grant
    down to zero is harmless - `effective_permissions` still grants them
    everything unconditionally, independent of the permission tables."""
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

    # The group's admin grant is now the only admin-permission row left in
    # the tables - revoking it no longer raises.
    await permissions.set_space_permission(
        space, group.id, Permission.admin, owner, group=True, present=False
    )
    assert await service.role_of(space, owner) is SpaceRole.admin

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
    # A principal must have space access before it can be named in a page
    # restriction - see test_restriction_pickers_only_offer_principals_with_space_access.
    await permissions.set_space_permission(
        space, member.id, Permission.view, owner, group=False, present=True
    )
    await permissions.set_page_restriction(
        page, member.id, PageRestrictionPermission.edit, owner, group=False, present=True
    )

    assert await permissions.can_view_page(page, member)
    assert await permissions.can_edit_page(page, member) is False
    await permissions.set_space_permission(
        space, member.id, Permission.add, owner, group=False, present=True
    )
    assert await permissions.can_edit_page(page, member)
    page_read = await PageService(session).to_read_for_user(page, member)
    assert page_read.can_edit
    # Export follows View automatically - anyone who can already read a page
    # can save a copy of it, with no separate Export grant to opt into.
    assert page_read.can_export


async def test_delete_own_is_limited_to_pages_created_by_the_actor(
    session: AsyncSession,
) -> None:
    # Restricted, not the SpaceCreate default of Open - Open now hands
    # everyone full `delete` regardless of their own grants
    # (OPEN_SPACE_PERMISSIONS), so member's narrower delete_own-only grant
    # would never be the binding constraint there.
    owner = await _user(session, "owner")
    member = await _user(session, "member")
    spaces = SpaceService(session)
    space = await spaces.create(
        SpaceCreate(
            key=f"DELO{uuid.uuid4().hex[:5]}", name="Delete own", visibility=SpaceVisibility.restricted
        ),
        owner,
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
    # `assert_user_can_be_removed` now leans on the Owner guarantee first
    # (see SpaceOwner): the creator is the space's sole Owner, so merely
    # promoting another Admin role is no longer enough on its own -
    # ownership itself has to be transferred before deactivation is safe.
    owner = await _user(session, "owner")
    second_admin = await _user(session, "admin")
    actor = await _user(session, "root", superuser=True)
    spaces = SpaceService(session)
    space = await spaces.create(
        SpaceCreate(key=f"DEAC{uuid.uuid4().hex[:5]}", name="Deactivation safety"), owner
    )
    account_service = AuthService(session, actor=actor)
    permissions = PermissionService(session)

    with pytest.raises(ConflictError, match="ownership"):
        await account_service.update_user(owner.id, UserUpdate(is_active=False))

    await spaces.set_member(space, owner, second_admin.id, SpaceRole.admin)
    with pytest.raises(ConflictError, match="ownership"):
        await account_service.update_user(owner.id, UserUpdate(is_active=False))

    await permissions.set_space_owners(space, [second_admin.id], owner)
    updated = await account_service.update_user(owner.id, UserUpdate(is_active=False))
    assert not updated.is_active


async def test_legacy_membership_role_changes_are_unblocked_once_the_space_has_an_owner(
    session: AsyncSession,
) -> None:
    """The old "last admin" guard on `set_member`/`remove_member` is now
    permanently inert wherever a space has an Owner - every space created
    through `SpaceService.create` does (see `SpaceOwner`) - since the Owner
    already guarantees the space stays manageable regardless of what
    happens to any particular Admin role or permission row."""
    owner = await _user(session, "owner")
    second_admin = await _user(session, "admin")
    spaces = SpaceService(session)
    space = await spaces.create(
        SpaceCreate(key=f"ROLE{uuid.uuid4().hex[:5]}", name="Role safety"), owner
    )

    await spaces.set_member(space, owner, owner.id, SpaceRole.viewer)
    # Demoting the creator's legacy role is harmless - they keep full
    # access as the space's Owner regardless.
    assert await spaces.role_of(space, owner) is SpaceRole.admin

    await spaces.set_member(space, owner, second_admin.id, SpaceRole.admin)
    await spaces.remove_member(space, second_admin, second_admin.id)
    assert await spaces.role_of(space, owner) is SpaceRole.admin


async def test_group_lifecycle_owner_permissions_and_page_restrictions(
    session: AsyncSession,
) -> None:
    owner = await _user(session, "owner")
    member = await _user(session, "member")
    admin = await _user(session, "admin", superuser=True)
    permissions = PermissionService(session)
    payload = GroupCreate(name=_name("team"), description=" Team ", owner_id=owner.id)
    group = await permissions.create_group(payload, admin)
    assert group.owner_id == owner.id
    assert await permissions.can_manage_group(group, owner)

    await permissions.update_group(
        group,
        GroupUpdate(name=" renamed ", description=" updated ", owner_id=member.id, is_active=True),
        owner,
    )
    assert group.name == "renamed" and group.owner_id == member.id and group.is_active
    await permissions.set_group_member(group, owner.id, admin, True)
    await permissions.set_group_member(group, owner.id, admin, False)
    await permissions.set_group_global_permission(group, GlobalPermission.manage_users, admin, True)
    assert await permissions.has_global(member, GlobalPermission.manage_users)
    await permissions.set_group_global_permission(
        group, GlobalPermission.manage_users, admin, False
    )

    space = await SpaceService(session).create(
        SpaceCreate(key=f"RESTR{uuid.uuid4().hex[:5]}", name="Restrictions"), owner
    )
    page = await PageService(session).create(space, PageCreate(title="Restricted"), owner)
    # A principal must have space access before it can be named in a page
    # restriction.
    await permissions.set_space_permission(
        space, member.id, Permission.view, owner, group=False, present=True
    )
    await permissions.set_space_permission(
        space, group.id, Permission.view, owner, group=True, present=True
    )
    await permissions.set_page_restriction(
        page, member.id, PageRestrictionPermission.view, owner, group=False, present=True
    )
    await permissions.set_page_restriction(
        page, group.id, PageRestrictionPermission.edit, owner, group=True, present=True
    )
    rows = await permissions.list_page_restrictions(page, owner)
    assert {row["principal_type"] for row in rows} == {"user", "group"}
    await permissions.set_page_restriction(
        page, member.id, PageRestrictionPermission.view, owner, group=False, present=False
    )
    await permissions.set_page_restriction(
        page, group.id, PageRestrictionPermission.edit, owner, group=True, present=False
    )
    await permissions.set_space_permission(
        space, group.id, Permission.view, owner, group=True, present=False
    )
    await permissions.delete_group(group, admin)
