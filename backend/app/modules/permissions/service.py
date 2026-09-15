"""Permission resolution shared by all content services.

Groups combine additively with each other, but a user's own direct grant on a
space - once they have one - overrides every group they belong to rather than
adding to them (Admin is the one exception: see `effective_permissions`).

A space's own General access (`Space.visibility`) works differently from a
page's: Open there means "everyone gets full read/write" rather than just
"everyone can read". An Open space hands every signed-in user - member or
not - `OPEN_SPACE_PERMISSIONS` (everything except `admin` and `restrictions`)
so day-to-day editing never needs anyone individually promoted; Restricted
withdraws that, so a member only has what the permission tables (or a role)
explicitly grant. `admin`/`restrictions` are never handed out for free in
either mode - only an Owner (see `SpaceOwner`) or an explicitly promoted
Admin holds them, since those two are what let someone reconfigure the space
itself rather than merely use it. An Owner is a protected Admin:
`effective_permissions` grants one every permission unconditionally, and
`set_space_owners` refuses to ever leave a space with none - the same
guarantee `Group.owner_id`/`GroupOwner` gives a group, so a space can never
end up with nobody able to administer it even if every ordinary Admin grant
is revoked. A system administrator is also always an Owner of every space by
default (`is_space_owner`), with no `SpaceOwner` row needed - this is what
still covers a space created outside `SpaceService.create` entirely (an
older space from before this table existed, or one produced by an import,
restore, or seed path), and `list_space_owners` falls back to showing every
such administrator there so it never reads as ownerless in the UI either.

Page-level access layers two independent mechanisms, both covered above:
a page's own "Open" vs "Restricted" state is an allow-list (a `denied=False`
row grants a listed principal access once any such row exists at all -
`_restriction_rows_exist`/`_principal_has_restriction`), for narrowing a page
to a handful of people. A `denied=True` row is the opposite: an explicit
block on one principal that applies regardless of that state, for excluding
someone from an otherwise-Open page without having to list everyone else
(`_principal_permission_denied`). The two never interact: a block never
counts toward "is this page Restricted", and a grant is never affected by
someone else's block."""

from __future__ import annotations

import inspect
from collections.abc import Sequence
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value


async def _safe_refresh(session: Any, instance: Any) -> None:
    refresh = getattr(session, "refresh", None)
    if refresh is not None:
        try:
            res = refresh(instance)
            if inspect.isawaitable(res):
                await res
        except Exception:
            pass


def _safe_set_committed_value(instance: Any, key: str, value: Any) -> None:
    """Sets an already-persisted value in place without marking it dirty -
    unlike plain attribute assignment, which would make the next flush
    write it again (and, for a column with `onupdate`, drag unrelated
    columns like `updated_at` along for the ride). Falls back to a plain
    setattr for the lightweight fakes unit tests build in place of a real
    mapped instance, which `set_committed_value` doesn't recognize."""
    try:
        set_committed_value(instance, key, value)
    except Exception:
        setattr(instance, key, value)

from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
)
from app.models.audit import AuditAction, AuditLog
from app.models.page import WikiPage
from app.models.permission import (
    GlobalPermission,
    Group,
    GroupGlobalPermission,
    GroupMember,
    GroupOwner,
    Permission,
    SpaceGroupPermission,
    SpaceUserPermission,
    UserGlobalPermissionOverride,
)
from app.models.restriction import (
    PageGroupRestriction,
    PageRestrictionPermission,
    PageUserRestriction,
)
from app.models.space import Space, SpaceMember, SpaceOwner, SpaceRole, SpaceVisibility
from app.models.user import User
from app.schemas.permission import GroupCreate, GroupUpdate

ALL_SPACE_PERMISSIONS = frozenset(Permission)
ROLE_PERMISSIONS: dict[SpaceRole, frozenset[Permission]] = {
    SpaceRole.viewer: frozenset({Permission.view}),
    SpaceRole.editor: frozenset({Permission.view, Permission.add}),
    SpaceRole.admin: ALL_SPACE_PERMISSIONS,
}
#: What an Open space hands to *everyone*, member or not - every permission
#: except the two that would let a random signed-in user damage the space
#: itself rather than just its content: `admin` (manage permissions/owners,
#: delete the space) and `restrictions` (lock other people out of a page).
#: Those two stay opt-in, granted only to an Owner or an explicitly
#: promoted Admin - see `effective_permissions` and the module docstring.
OPEN_SPACE_PERMISSIONS = ALL_SPACE_PERMISSIONS - {Permission.admin, Permission.restrictions}


class PermissionService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _user_permission_overrides(self, user: User) -> dict[GlobalPermission, bool]:
        """This user's own grant/deny rows, keyed by permission.

        Never consulted for a superuser - `global_permissions`/`is_system_admin`
        both short-circuit on `user.is_superuser` before this runs, so an
        override can never claw capability back from that account."""
        rows = await self.session.execute(
            select(
                UserGlobalPermissionOverride.permission, UserGlobalPermissionOverride.enabled
            ).where(UserGlobalPermissionOverride.user_id == user.id)
        )
        return {permission: enabled for permission, enabled in rows}

    async def is_system_admin(self, user: User) -> bool:
        """Return whether the user has the instance-wide admin capability."""
        if user.is_superuser:
            return True
        return GlobalPermission.system_admin in await self.global_permissions(user)

    async def group_derived_global_permissions(self, user: User) -> list[GlobalPermission]:
        """The global permissions ``user``'s groups grant, before any of
        their own overrides are applied.

        Split out of `global_permissions` so the Edit User dialog's Global
        Access tab can show what each override choice would *actually* do
        the moment it is picked - `Inherit from groups` reverting to this
        list, `Force enabled`/`Force disabled` pinning it regardless of this
        list - without needing a round-trip to find out, and without the
        override already in effect masking what "inherit" would fall back
        to."""
        return list(
            set(
                await self.session.scalars(
                    select(GroupGlobalPermission.permission)
                    .join(GroupMember, GroupMember.group_id == GroupGlobalPermission.group_id)
                    .join(Group, Group.id == GroupMember.group_id)
                    .where(GroupMember.user_id == user.id, Group.is_active.is_(True))
                    .distinct()
                )
            )
        )

    async def global_permissions(self, user: User) -> list[GlobalPermission]:
        """Return the effective global capabilities for the current user."""
        if user.is_superuser:
            return list(GlobalPermission)
        from_groups = set(await self.group_derived_global_permissions(user))
        # A user-level override beats whichever way the groups voted: it adds
        # a permission no group grants, or withdraws one a group does.
        for permission, enabled in (await self._user_permission_overrides(user)).items():
            if enabled:
                from_groups.add(permission)
            else:
                from_groups.discard(permission)
        return list(from_groups)

    async def effective_permissions(self, space: Space, user: User) -> set[Permission]:
        if await self.is_system_admin(user):
            return set(ALL_SPACE_PERMISSIONS)
        if await self.is_space_owner(space, user):
            return set(ALL_SPACE_PERMISSIONS)

        permissions: set[Permission] = set()
        if space.visibility is SpaceVisibility.open:
            # Open hands out everything short of the two permissions that
            # could reconfigure or lock down the space itself - see
            # `OPEN_SPACE_PERMISSIONS` and the module docstring. This is not
            # additive with the per-user/group grants below in any special
            # way; it just seeds the set they build on top of, same as the
            # single `view` it used to seed before this permission existed.
            permissions.update(OPEN_SPACE_PERMISSIONS)

        direct = set(
            await self.session.scalars(
                select(SpaceUserPermission.permission).where(
                    SpaceUserPermission.space_id == space.id,
                    SpaceUserPermission.user_id == user.id,
                )
            )
        )
        group_permissions = set(
            await self.session.scalars(
                select(SpaceGroupPermission.permission)
                .join(GroupMember, GroupMember.group_id == SpaceGroupPermission.group_id)
                .join(Group, Group.id == GroupMember.group_id)
                .where(
                    SpaceGroupPermission.space_id == space.id,
                    GroupMember.user_id == user.id,
                    Group.is_active.is_(True),
                )
            )
        )
        if direct:
            # A direct grant on this user is authoritative, not merely
            # additive - once someone has been given their own row on this
            # space, group membership stops contributing anything beyond it.
            # Without this, unchecking a box in a user's own row (unlike a
            # group's) could never actually take a permission away from
            # someone still covered by a group grant.
            #
            # Admin is the one exception: it's what `_has_space_admin`'s
            # "a Space must retain at least one administrator" guarantee
            # relies on being reachable via a group regardless of a user's
            # other direct rows - without this carve-out, an admin group
            # covering someone who *also* happens to hold any other direct
            # permission (say, a leftover Restrictions grant) would silently
            # stop applying, potentially locking a space's own admin out of
            # administering it.
            permissions.update(direct)
            if Permission.admin in group_permissions:
                permissions.add(Permission.admin)
        else:
            permissions.update(group_permissions)
        # Export was previously its own opt-in grant, but reading a page and
        # exporting it carry the same risk - anyone who can already view a
        # space's content can save a copy of it. It is implied by View
        # rather than stored, so nothing needs a direct Export row any more
        # and the space-permission matrix no longer offers a checkbox for it.
        if Permission.view in permissions:
            permissions.add(Permission.export)
        return permissions

    async def require(self, space: Space, user: User, permission: Permission) -> None:
        if permission not in await self.effective_permissions(space, user):
            raise PermissionDeniedError(
                f"You need the '{permission.value}' permission in this space.",
                code="space_permission_denied",
            )

    async def require_owner(self, space: Space, user: User) -> None:
        """Raise unless ``user`` is a system administrator or this space's Owner.

        Stricter than ``require(..., Permission.admin)``: an ordinary Admin
        grant (a per-user/group ``admin`` permission row) is not enough here.
        Flipping ``Space.visibility`` redefines what every Admin grant on the
        space even means - Open silently hands out most of that grant's
        permissions to everyone for free, Restricted takes them back - so
        only the Owner who is accountable for the space (or a system admin)
        may make that call.
        """
        if await self.is_system_admin(user):
            return
        if await self.is_space_owner(space, user):
            return
        raise PermissionDeniedError(
            "Only this space's Owner can change its access mode.",
            code="space_owner_required",
        )

    async def is_space_owner(self, space: Space, user: User) -> bool:
        # A superuser owns every space by default, this one included - no
        # `SpaceOwner` row required. This is what makes a space created (or
        # imported/restored) through any code path other than
        # `SpaceService.create` still administrable: even one that never
        # inserted a `SpaceOwner` row at all still has a real Owner in
        # practice, because a system administrator always does.
        if user.is_superuser:
            return True
        return (
            await self.session.scalar(
                select(SpaceOwner.user_id).where(
                    SpaceOwner.space_id == space.id, SpaceOwner.user_id == user.id
                )
            )
        ) is not None

    async def _list_system_admins(self) -> list[User]:
        """Every active superuser - the always-on fallback `list_space_owners`
        shows for a space with no explicit `SpaceOwner` row. Deliberately
        narrower than `is_system_admin` (which also honours a group's
        `system_admin` global permission): there is no single "list every
        user with this global permission via any group" query yet, and a
        superuser is already the common, intended case for this fallback."""
        return list(
            (
                await self.session.scalars(
                    select(User)
                    .where(User.is_active.is_(True), User.is_superuser.is_(True))
                    .order_by(User.username)
                )
            ).all()
        )

    async def list_space_owners(self, space: Space) -> list[User]:
        explicit = list(
            (
                await self.session.scalars(
                    select(User)
                    .join(SpaceOwner, SpaceOwner.user_id == User.id)
                    .where(SpaceOwner.space_id == space.id)
                    .order_by(User.username)
                )
            ).all()
        )
        if explicit:
            return explicit
        # No explicit Owner - a space from before `SpaceOwner` existed, or
        # created through an import/restore/seed path that never inserts one
        # - falls back to showing every system administrator, since
        # `is_space_owner` above already treats them as this space's Owner
        # regardless. Keeps a legacy or imported space from ever looking
        # ownerless instead of just being silently covered behind the scenes.
        return await self._list_system_admins()

    async def set_space_owners(
        self, space: Space, owner_ids: list[UUID], actor: User
    ) -> list[User]:
        """Replace-all, like `update_group`'s own `owner_ids` handling.

        Only an existing Owner (or a system administrator) may call this -
        an ordinary Admin, even one with the `admin` permission, cannot add
        or drop Owners. Without that carve-out, any Admin could quietly
        demote the real Owner and take over, which defeats the point of
        Owner being the one grant nobody else can revoke.

        Note this deliberately still allows an Owner to drop *themselves*
        in the same call, as long as someone else is left standing (see the
        empty-list check below) - that is exactly how a one-step ownership
        transfer works (compare `test_deactivating_last_space_admin_is_rejected`).
        `EditSpaceModal`'s own UI guards against the accidental version of
        this (a bare click removing your own chip) client-side; this method
        stays the same "replace the whole list" primitive `update_group`'s
        `owner_ids` already is, without a second opinion on *why* the caller
        chose the list they did."""
        if not await self.is_system_admin(actor) and not await self.is_space_owner(space, actor):
            raise PermissionDeniedError(
                "Only a space Owner or a system administrator can change its owners."
            )
        if not owner_ids:
            raise ConflictError("A Space must retain at least one Owner.", code="last_space_owner")
        unique_ids = list(dict.fromkeys(owner_ids))
        users: list[User] = []
        for owner_id in unique_ids:
            candidate = await self.session.get(User, owner_id)
            if candidate is None or not candidate.is_active:
                raise NotFoundError(f"User {owner_id} not found.")
            users.append(candidate)
        await self.session.execute(delete(SpaceOwner).where(SpaceOwner.space_id == space.id))
        self.session.add_all(
            SpaceOwner(space_id=space.id, user_id=owner_id) for owner_id in unique_ids
        )
        await self.session.flush()
        users.sort(key=lambda u: u.username)
        return users

    async def role_of(self, space: Space, user: User) -> SpaceRole | None:
        permissions = await self.effective_permissions(space, user)
        if permissions >= ALL_SPACE_PERMISSIONS:
            return SpaceRole.admin
        if Permission.add in permissions:
            return SpaceRole.editor
        if Permission.view in permissions:
            return SpaceRole.viewer
        return None

    async def has_global(self, user: User, permission: GlobalPermission) -> bool:
        if user.is_superuser:
            return True
        permissions = await self.global_permissions(user)
        # `system_admin` means "all of them", same as `is_superuser` above -
        # it must unlock every other global permission too, not just the one
        # literally named `system_admin`. `global_permissions` itself stays a
        # faithful list of what is actually granted (the Administrators tab
        # and the Edit User modal both need to show *that*, not the expanded
        # form), so the shortcut lives here instead.
        return GlobalPermission.system_admin in permissions or permission in permissions

    async def require_global(self, user: User, permission: GlobalPermission) -> None:
        if not await self.has_global(user, permission):
            raise PermissionDeniedError("This action requires a global permission.")

    async def require_any_global(
        self, user: User, permissions: Sequence[GlobalPermission]
    ) -> None:
        """Like `require_global`, but satisfied by any one of `permissions`.

        For an action two different admin capabilities both legitimately need
        - e.g. browsing the user directory, which both `manage_users` (to
        edit an account) and `manage_groups` (to pick who to add to a group)
        have a real reason to do - rather than that action silently reverting
        to whichever single permission happened to gate it first."""
        for permission in permissions:
            if await self.has_global(user, permission):
                return
        raise PermissionDeniedError("This action requires a global permission.")

    async def set_user_permission_overrides(
        self, user: User, overrides: dict[GlobalPermission, bool | None]
    ) -> None:
        """Upsert or clear this user's per-permission grant/deny rows.

        A `True`/`False` value replaces whatever row already exists (or adds
        one); `None` removes the row entirely, reverting that one permission
        to "inherit from groups". Permissions not present in `overrides` are
        left untouched - this is a partial update, not a replace-all, so the
        Edit User modal saving just the Role field never has to resend every
        permission's current override alongside it."""
        if not overrides:
            return
        existing = dict(
            (
                await self.session.execute(
                    select(
                        UserGlobalPermissionOverride.permission,
                        UserGlobalPermissionOverride,
                    ).where(UserGlobalPermissionOverride.user_id == user.id)
                )
            ).all()
        )
        for permission, enabled in overrides.items():
            row = existing.get(permission)
            if enabled is None:
                if row is not None:
                    await self.session.delete(row)
                continue
            if row is not None:
                row.enabled = enabled
            else:
                self.session.add(
                    UserGlobalPermissionOverride(
                        user_id=user.id, permission=permission, enabled=enabled
                    )
                )
        await self.session.flush()

    async def list_effective_system_admins(
        self,
    ) -> list[tuple[User, str, str | None, str | None]]:
        """Every active user who currently holds `system_admin`, with why -
        and, where it is knowable, *who* granted it.

        Three independent paths grant it - a direct `is_superuser` flag, a
        group's `system_admin` global permission, or a user-level override -
        and `global_permissions`/`is_system_admin` already resolve all three
        into one answer for authorization purposes. This is the one place
        that needs to tell them apart instead: the Administrators tab, so an
        operator can see *why* an account is on the list and, for a
        group-granted one, "Demote" means "add a deny override" rather than
        the no-op flipping `is_superuser` would be.

        Priority when more than one path applies, matching `is_superuser`'s
        unconditional precedence everywhere else: superuser first, then an
        explicit override, then group membership.

        Each result is `(user, source, granted_by, granted_via_group)`.
        `granted_by` is the *username* of whoever last flipped `is_superuser`
        on or added a `system_admin: true` override, read off the audit
        trail - `None` for an account that has always been this way (the
        bootstrap admin, or a fixture/import predating this feature).
        `granted_via_group` names the group(s) responsible for a `group`-
        sourced grant instead: group membership and a group's own permission
        grants are not audited per member, so there is no individual actor to
        name there, only the group itself."""
        superusers = list(
            (
                await self.session.scalars(
                    select(User)
                    .where(User.is_superuser.is_(True), User.is_active.is_(True))
                    .order_by(User.username)
                )
            ).all()
        )
        result: list[tuple[User, str]] = [(u, "superuser") for u in superusers]
        seen = {u.id for u in superusers}

        override_rows = (
            await self.session.execute(
                select(
                    UserGlobalPermissionOverride.user_id, UserGlobalPermissionOverride.enabled
                ).where(UserGlobalPermissionOverride.permission == GlobalPermission.system_admin)
            )
        ).all()
        forced_on = {user_id for user_id, enabled in override_rows if enabled}
        forced_off = {user_id for user_id, enabled in override_rows if not enabled}

        if forced_on:
            overridden = list(
                (
                    await self.session.scalars(
                        select(User)
                        .where(User.id.in_(forced_on), User.is_active.is_(True))
                        .order_by(User.username)
                    )
                ).all()
            )
            for u in overridden:
                if u.id in seen:
                    continue
                seen.add(u.id)
                result.append((u, "override"))

        group_admins = list(
            (
                await self.session.scalars(
                    select(User)
                    .join(GroupMember, GroupMember.user_id == User.id)
                    .join(Group, Group.id == GroupMember.group_id)
                    .join(GroupGlobalPermission, GroupGlobalPermission.group_id == Group.id)
                    .where(
                        GroupGlobalPermission.permission == GlobalPermission.system_admin,
                        Group.is_active.is_(True),
                        User.is_active.is_(True),
                    )
                    # `group_by(User.id)` rather than `.distinct()`: a user in
                    # more than one group granting system_admin would
                    # otherwise repeat once per group, but PostgreSQL can't
                    # DISTINCT a full `User` row - `social_links` is a plain
                    # `json` column with no equality operator. Grouping by
                    # the primary key sidesteps that and still lets every
                    # other column be selected unaggregated (functional
                    # dependency on the primary key).
                    .group_by(User.id)
                    .order_by(User.username)
                )
            ).all()
        )
        for u in group_admins:
            if u.id in seen or u.id in forced_off:
                continue
            seen.add(u.id)
            result.append((u, "group"))

        result.sort(key=lambda pair: pair[0].username)

        # `granted_by`, for the two paths where the actor is on the audit
        # trail: whichever of these rows for this user, across both possible
        # actions, most recently turned the flag/override *on* - a demote
        # then re-promote must point at the re-promotion, not the original
        # grant.
        grantable_ids = [u.id for u, source in result if source in ("superuser", "override")]
        grant_rows: dict[UUID, list[AuditLog]] = {}
        if grantable_ids:
            rows = list(
                (
                    await self.session.scalars(
                        select(AuditLog)
                        .where(
                            AuditLog.entity_type == "user",
                            AuditLog.entity_id.in_(grantable_ids),
                            AuditLog.action.in_(
                                [
                                    AuditAction.user_created,
                                    AuditAction.user_role_changed,
                                    AuditAction.user_permissions_changed,
                                ]
                            ),
                        )
                        .order_by(AuditLog.created_at.desc())
                    )
                ).all()
            )
            for row in rows:
                if row.entity_id is not None:
                    grant_rows.setdefault(row.entity_id, []).append(row)

        # `granted_via_group`, for the one path with no per-user actor to
        # name: every currently-active group that grants `system_admin` and
        # counts this user among its members right now.
        group_ids = [u.id for u, source in result if source == "group"]
        grant_groups: dict[UUID, list[str]] = {}
        if group_ids:
            group_rows = (
                await self.session.execute(
                    select(GroupMember.user_id, Group.name)
                    .join(Group, Group.id == GroupMember.group_id)
                    .join(GroupGlobalPermission, GroupGlobalPermission.group_id == Group.id)
                    .where(
                        GroupMember.user_id.in_(group_ids),
                        GroupGlobalPermission.permission == GlobalPermission.system_admin,
                        Group.is_active.is_(True),
                    )
                    .order_by(Group.name)
                )
            ).all()
            for user_id, name in group_rows:
                grant_groups.setdefault(user_id, []).append(name)

        enriched: list[tuple[User, str, str | None, str | None]] = []
        for user, source in result:
            granted_by: str | None = None
            granted_via_group: str | None = None
            if source == "superuser":
                for row in grant_rows.get(user.id, []):
                    if row.action in (
                        AuditAction.user_created,
                        AuditAction.user_role_changed,
                    ) and row.details.get("is_superuser") is True:
                        granted_by = row.actor_username
                        break
            elif source == "override":
                for row in grant_rows.get(user.id, []):
                    if (
                        row.action == AuditAction.user_permissions_changed
                        and row.details.get("overrides", {}).get("system_admin") is True
                    ):
                        granted_by = row.actor_username
                        break
            else:
                names = grant_groups.get(user.id)
                granted_via_group = ", ".join(names) if names else None
            enriched.append((user, source, granted_by, granted_via_group))
        return enriched

    async def assert_user_can_be_removed(self, user: User) -> None:
        """Protect group ownership, space ownership, and the last active
        Space administrator.

        Space ownership needs its own pass separate from the admin-grant
        loop below: `set_space_owners` lets an Owner's own additive
        `admin` permission row be revoked entirely (see `_has_space_admin`),
        so a long-standing Owner may hold no `SpaceUserPermission`/
        `SpaceMember` admin row at all by the time someone tries to
        deactivate them - the loop below would never even look at that
        space."""
        owned_group = await self.session.scalar(
            select(Group.id).where(Group.owner_id == user.id).limit(1)
        )
        if owned_group is not None:
            raise ConflictError(
                "Transfer group ownership before deactivating or deleting this user.",
                code="group_owner_required",
            )

        owned_spaces = set(
            await self.session.scalars(
                select(SpaceOwner.space_id).where(SpaceOwner.user_id == user.id)
            )
        )
        for space_id in owned_spaces:
            other_owner = await self.session.scalar(
                select(SpaceOwner.space_id)
                .join(User, User.id == SpaceOwner.user_id)
                .where(
                    SpaceOwner.space_id == space_id,
                    SpaceOwner.user_id != user.id,
                    User.is_active.is_(True),
                )
                .limit(1)
            )
            if other_owner is None:
                raise ConflictError(
                    "Transfer space ownership before deactivating or deleting this user.",
                    code="space_owner_required",
                )

        space_ids = set(
            await self.session.scalars(
                select(SpaceUserPermission.space_id).where(
                    SpaceUserPermission.user_id == user.id,
                    SpaceUserPermission.permission == Permission.admin,
                )
            )
        )
        space_ids.update(
            await self.session.scalars(
                select(SpaceMember.space_id).where(
                    SpaceMember.user_id == user.id,
                    SpaceMember.role == SpaceRole.admin,
                )
            )
        )
        for space_id in space_ids:
            other_direct = await self.session.scalar(
                select(SpaceUserPermission.space_id)
                .join(User, User.id == SpaceUserPermission.user_id)
                .where(
                    SpaceUserPermission.space_id == space_id,
                    SpaceUserPermission.permission == Permission.admin,
                    SpaceUserPermission.user_id != user.id,
                    User.is_active.is_(True),
                )
                .limit(1)
            )
            other_legacy = await self.session.scalar(
                select(SpaceMember.space_id)
                .join(User, User.id == SpaceMember.user_id)
                .where(
                    SpaceMember.space_id == space_id,
                    SpaceMember.role == SpaceRole.admin,
                    SpaceMember.user_id != user.id,
                    User.is_active.is_(True),
                )
                .limit(1)
            )
            other_group = await self.session.scalar(
                select(SpaceGroupPermission.space_id)
                .join(Group, Group.id == SpaceGroupPermission.group_id)
                .join(GroupMember, GroupMember.group_id == SpaceGroupPermission.group_id)
                .join(User, User.id == GroupMember.user_id)
                .where(
                    SpaceGroupPermission.space_id == space_id,
                    SpaceGroupPermission.permission == Permission.admin,
                    Group.is_active.is_(True),
                    GroupMember.user_id != user.id,
                    User.is_active.is_(True),
                )
                .limit(1)
            )
            if other_direct is None and other_legacy is None and other_group is None:
                raise ConflictError(
                    "Promote another active administrator before removing this user.",
                    code="last_space_admin",
                )

    async def create_group(self, payload: GroupCreate, actor: User) -> Group:
        await self.require_global(actor, GlobalPermission.manage_groups)
        owner = await self.session.get(User, payload.owner_id)
        if owner is None:
            raise NotFoundError("Group owner not found.")
        existing = await self.session.scalar(
            select(Group).where(func.lower(Group.name) == payload.name.strip().lower())
        )
        if existing:
            raise ConflictError("A group with this name already exists.", code="group_name_taken")
        group = Group(
            name=payload.name.strip(), description=payload.description.strip(), owner_id=owner.id
        )
        self.session.add(group)
        await self.session.flush()
        self.session.add(GroupMember(group_id=group.id, user_id=owner.id))
        self.session.add(GroupOwner(group_id=group.id, user_id=owner.id))
        await self.session.flush()
        await _safe_refresh(self.session, group)
        return group

    async def get_group(self, group_id: UUID) -> Group:
        group = await self.session.get(Group, group_id)
        if group is None:
            raise NotFoundError("Group not found.")
        return group

    async def can_manage_group(self, group: Group, actor: User) -> bool:
        return (
            await self.is_system_admin(actor)
            or group.owner_id == actor.id
            or await self.has_global(actor, GlobalPermission.manage_groups)
        )

    async def update_group(self, group: Group, payload: GroupUpdate, actor: User) -> Group:
        if not await self.can_manage_group(group, actor):
            raise PermissionDeniedError(
                "Only the group owner or a system administrator can manage this group."
            )
        data = payload.model_dump(exclude_unset=True)
        if "owner_ids" in data and data["owner_ids"] is not None:
            new_owner_ids = data["owner_ids"]
            if not new_owner_ids:
                raise ConflictError("Group must have at least one owner.")
            await self.session.execute(
                delete(GroupOwner).where(GroupOwner.group_id == group.id)
            )
            for o_id in new_owner_ids:
                u = await self.session.get(User, o_id)
                if u is None:
                    raise NotFoundError(f"User {o_id} not found.")
                self.session.add(GroupOwner(group_id=group.id, user_id=o_id))
                if not await self.session.scalar(
                    select(GroupMember).where(
                        GroupMember.group_id == group.id, GroupMember.user_id == o_id
                    )
                ):
                    self.session.add(GroupMember(group_id=group.id, user_id=o_id))
            group.owner_id = new_owner_ids[0]
        elif "owner_id" in data and data["owner_id"] is not None:
            owner = await self.session.get(User, data["owner_id"])
            if owner is None:
                raise NotFoundError("Group owner not found.")
            if not await self.session.scalar(
                select(GroupMember).where(
                    GroupMember.group_id == group.id, GroupMember.user_id == owner.id
                )
            ):
                self.session.add(GroupMember(group_id=group.id, user_id=owner.id))
            self.session.add(GroupOwner(group_id=group.id, user_id=owner.id))
            group.owner_id = owner.id
        if data.get("name") is not None:
            next_name = str(data["name"]).strip()
            existing = await self.session.scalar(
                select(Group).where(
                    func.lower(Group.name) == next_name.lower(), Group.id != group.id
                )
            )
            if existing:
                raise ConflictError(
                    "A group with this name already exists.", code="group_name_taken"
                )
            group.name = next_name
        if data.get("description") is not None:
            group.description = str(data["description"]).strip()
        if data.get("is_active") is not None:
            group.is_active = bool(data["is_active"])
        await self.session.flush()
        await _safe_refresh(self.session, group)
        return group

    async def delete_group(self, group: Group, actor: User) -> None:
        if not await self.can_manage_group(group, actor):
            raise PermissionDeniedError(
                "Only the group owner or a system administrator can manage this group."
            )
        if await self.session.scalar(
            select(SpaceGroupPermission.group_id)
            .where(SpaceGroupPermission.group_id == group.id)
            .limit(1)
        ) or await self.session.scalar(
            select(PageGroupRestriction.group_id)
            .where(PageGroupRestriction.group_id == group.id)
            .limit(1)
        ):
            raise ConflictError(
                "Remove this group's permission assignments before deleting it.",
                code="group_in_use",
            )
        await self.session.delete(group)
        await self.session.flush()

    async def set_group_member(
        self, group: Group, user_id: uuid.UUID, actor: User, present: bool
    ) -> None:
        if not await self.can_manage_group(group, actor):
            raise PermissionDeniedError(
                "Only the group owner or a system administrator can manage this group."
            )
        user = await self.session.get(User, user_id)
        if user is None:
            raise NotFoundError("User not found.")
        member = await self.session.scalar(
            select(GroupMember).where(
                GroupMember.group_id == group.id, GroupMember.user_id == user_id
            )
        )
        if present and member is None:
            self.session.add(GroupMember(group_id=group.id, user_id=user_id))
        elif not present and member is not None:
            if group.owner_id == user_id:
                raise ConflictError(
                    "Transfer group ownership before removing the owner.",
                    code="group_owner_required",
                )
            await self.session.delete(member)
        await self.session.flush()

    async def set_group_global_permission(
        self, group: Group, permission: GlobalPermission, actor: User, present: bool
    ) -> None:
        if not await self.is_system_admin(actor):
            raise PermissionDeniedError(
                "Only a system administrator can manage global permissions."
            )
        row = await self.session.scalar(
            select(GroupGlobalPermission).where(
                GroupGlobalPermission.group_id == group.id,
                GroupGlobalPermission.permission == permission,
            )
        )
        if present and row is None:
            self.session.add(GroupGlobalPermission(group_id=group.id, permission=permission))
        elif not present and row is not None:
            await self.session.delete(row)
        await self.session.flush()

    async def set_space_permission(
        self,
        space: Space,
        principal_id: uuid.UUID,
        permission: Permission,
        actor: User,
        *,
        group: bool,
        present: bool,
    ) -> None:
        await self.require(space, actor, Permission.admin)
        principal = (
            await self.session.get(Group, principal_id)
            if group
            else await self.session.get(User, principal_id)
        )
        if (
            principal is None
            or (group and isinstance(principal, Group) and not principal.is_active)
            or (not group and isinstance(principal, User) and not principal.is_active)
        ):
            raise NotFoundError("Permission principal not found.")
        model = SpaceGroupPermission if group else SpaceUserPermission
        key = {"space_id": space.id, "permission": permission}
        key["group_id" if group else "user_id"] = principal_id
        row = await self.session.scalar(select(model).filter_by(**key))
        if present and row is None:
            self.session.add(model(**key))
        elif not present and row is not None:
            if permission is Permission.admin and not await self._has_space_admin(
                space, excluding=key
            ):
                raise ConflictError(
                    "A Space must retain at least one administrator.", code="last_space_admin"
                )
            if permission is Permission.view and await self._has_other_space_permissions(
                space, principal_id, group=group, excluding=Permission.view
            ):
                raise ConflictError(
                    "View cannot be removed while this principal still holds another "
                    "permission on the space - every other permission is useless "
                    "without it. Remove those first.",
                    code="view_required",
                )
            await self.session.delete(row)
            await self.session.flush()
            if not await self._has_space_access(space.id, principal_id, group=group):
                await self._purge_page_restrictions_for_removed_principal(
                    space, principal_id, group=group
                )
        await self.session.flush()
        # Every permission is useless without View, so granting any of the
        # others implicitly grants it too - mirrors the removal guard above,
        # which keeps View from being dropped while a sibling permission
        # still depends on it.
        if present and permission is not Permission.view:
            view_key = dict(key, permission=Permission.view)
            view_row = await self.session.scalar(select(model).filter_by(**view_key))
            if view_row is None:
                self.session.add(model(**view_key))
                await self.session.flush()

    async def _has_other_space_permissions(
        self,
        space: Space,
        principal_id: uuid.UUID,
        *,
        group: bool,
        excluding: Permission,
    ) -> bool:
        model = SpaceGroupPermission if group else SpaceUserPermission
        principal_column = model.group_id if group else model.user_id
        return (
            await self.session.scalar(
                select(model.permission).where(
                    model.space_id == space.id,
                    principal_column == principal_id,
                    model.permission != excluding,
                )
            )
        ) is not None

    async def _purge_page_restrictions_for_removed_principal(
        self, space: Space, principal_id: uuid.UUID, *, group: bool
    ) -> None:
        """Once a principal has no space access left, any page-level
        restriction naming them is dead weight - a View/Edit allow-list entry
        for someone who can no longer even open the space. Without this, the
        page-access dialog keeps listing (and the restriction keeps
        "protecting" access for) someone the space itself has already shut
        out, which reads as the restriction just silently not working."""
        page_ids = select(WikiPage.id).where(WikiPage.space_id == space.id)
        if group:
            await self.session.execute(
                delete(PageGroupRestriction).where(
                    PageGroupRestriction.group_id == principal_id,
                    PageGroupRestriction.page_id.in_(page_ids),
                )
            )
        else:
            await self.session.execute(
                delete(PageUserRestriction).where(
                    PageUserRestriction.user_id == principal_id,
                    PageUserRestriction.page_id.in_(page_ids),
                )
            )

    async def _has_space_admin(self, space: Space, *, excluding: dict[str, object]) -> bool:
        """Whether *some* admin channel still covers this space: a direct or
        group `admin` grant, or an Owner. An Owner is never passed via
        `excluding` here - Owner removal has its own dedicated "at least one
        Owner" guard in `set_space_owners`, entirely separate from this
        one - so any existing Owner unconditionally satisfies this check."""
        owner_exists = (
            await self.session.scalar(select(SpaceOwner.user_id).where(SpaceOwner.space_id == space.id).limit(1))
        ) is not None
        if owner_exists:
            return True
        user_query = (
            select(SpaceUserPermission.space_id)
            .where(
                SpaceUserPermission.space_id == space.id,
                SpaceUserPermission.permission == Permission.admin,
            )
            .join(User, User.id == SpaceUserPermission.user_id)
            .where(User.is_active.is_(True))
        )
        group_query = (
            select(SpaceGroupPermission.space_id)
            .where(
                SpaceGroupPermission.space_id == space.id,
                SpaceGroupPermission.permission == Permission.admin,
            )
            .join(Group, Group.id == SpaceGroupPermission.group_id)
            .where(Group.is_active.is_(True))
        )
        if "user_id" in excluding:
            user_query = user_query.where(SpaceUserPermission.user_id != excluding["user_id"])
        if "group_id" in excluding:
            group_query = group_query.where(SpaceGroupPermission.group_id != excluding["group_id"])
        user_admin = await self.session.scalar(user_query.limit(1))
        group_admin = await self.session.scalar(group_query.limit(1))
        return user_admin is not None or group_admin is not None

    async def _page_chain(self, page: WikiPage) -> list[WikiPage]:
        chain: list[WikiPage] = []
        current: WikiPage | None = page
        while current is not None:
            chain.append(current)
            current = (
                await self.session.get(WikiPage, current.parent_id) if current.parent_id else None
            )
        chain.reverse()
        return chain

    async def _restriction_rows_exist(
        self, page_id: uuid.UUID, permission: PageRestrictionPermission
    ) -> bool:
        """Whether this page has any allow-list grant for `permission` - a
        `denied` row is a block, not a grant, and must never count here or
        this page would read as "Restricted" the moment anyone gets an
        ordinary per-principal block on an otherwise-Open page."""
        user_row = await self.session.scalar(
            select(PageUserRestriction.page_id)
            .where(
                PageUserRestriction.page_id == page_id,
                PageUserRestriction.permission == permission,
                PageUserRestriction.denied.is_(False),
            )
            .limit(1)
        )
        group_row = await self.session.scalar(
            select(PageGroupRestriction.page_id)
            .where(
                PageGroupRestriction.page_id == page_id,
                PageGroupRestriction.permission == permission,
                PageGroupRestriction.denied.is_(False),
            )
            .limit(1)
        )
        return user_row is not None or group_row is not None

    async def _principal_has_restriction(
        self, page_id: uuid.UUID, user: User, permission: PageRestrictionPermission
    ) -> bool:
        """Whether this user is on the page's allow-list for `permission` -
        only counts a `denied=False` grant, direct or via one of the user's
        groups; a `denied` row is handled separately, by
        `_principal_permission_denied`."""
        allowed_permissions = (
            (PageRestrictionPermission.view, PageRestrictionPermission.edit)
            if permission is PageRestrictionPermission.view
            else (PageRestrictionPermission.edit,)
        )
        direct = await self.session.scalar(
            select(PageUserRestriction.page_id)
            .where(
                PageUserRestriction.page_id == page_id,
                PageUserRestriction.user_id == user.id,
                PageUserRestriction.permission.in_(allowed_permissions),
                PageUserRestriction.denied.is_(False),
            )
            .limit(1)
        )
        if direct is not None:
            return True
        return (
            await self.session.scalar(
                select(PageGroupRestriction.page_id)
                .join(GroupMember, GroupMember.group_id == PageGroupRestriction.group_id)
                .join(Group, Group.id == GroupMember.group_id)
                .where(
                    PageGroupRestriction.page_id == page_id,
                    PageGroupRestriction.permission.in_(allowed_permissions),
                    PageGroupRestriction.denied.is_(False),
                    GroupMember.user_id == user.id,
                    Group.is_active.is_(True),
                )
                .limit(1)
            )
        ) is not None

    async def _principal_permission_denied(
        self, page_id: uuid.UUID, user: User, permission: PageRestrictionPermission
    ) -> bool:
        """An explicit per-principal block on this exact page, independent
        of whether the page itself is Open or Restricted (allow-list) - see
        the module-level precedence note. The user's own row, if any, wins
        outright over their groups'; among the groups, one explicit block
        beats another group's explicit grant, since a deliberate block
        should not be silently overridden by membership somewhere else."""
        direct = await self.session.scalar(
            select(PageUserRestriction.denied).where(
                PageUserRestriction.page_id == page_id,
                PageUserRestriction.user_id == user.id,
                PageUserRestriction.permission == permission,
            )
        )
        if direct is not None:
            return direct
        group_flags = list(
            await self.session.scalars(
                select(PageGroupRestriction.denied)
                .join(GroupMember, GroupMember.group_id == PageGroupRestriction.group_id)
                .join(Group, Group.id == GroupMember.group_id)
                .where(
                    PageGroupRestriction.page_id == page_id,
                    PageGroupRestriction.permission == permission,
                    GroupMember.user_id == user.id,
                    Group.is_active.is_(True),
                )
            )
        )
        return any(group_flags)

    async def page_view_is_restricted(self, page: WikiPage) -> bool:
        """True when this page's own General-access setting - or an
        ancestor's - is "Restricted".

        This is `WikiPage.view_restricted`, an explicit flag rather than
        something inferred from whether allow-list rows currently exist:
        switching a page back to Open is meant to be reversible without
        losing the allow-list it had, so the flag and the rows underneath it
        vary independently (see the module docstring). Restrictions inherit,
        so the whole ancestor chain counts: a child of a restricted page is
        every bit as closed even with its own flag left at Open. This
        answers "is this page restricted", not "may this user read it" -
        callers wanting the latter want :meth:`can_view_page`.
        """
        for ancestor in await self._page_chain(page):
            if await self._page_view_restricted_flag(ancestor.id):
                return True
        return False

    async def _page_view_restricted_flag(self, page_id: uuid.UUID) -> bool:
        """An explicit, freshly-queried read of one page's own flag - not an
        attribute access on whatever `WikiPage` instance a caller happens to
        be holding, which for a page fetched earlier in the same unit of
        work can be an identity-map hit with this column not yet loaded."""
        return bool(
            await self.session.scalar(select(WikiPage.view_restricted).where(WikiPage.id == page_id))
        )

    async def _set_page_view_restricted(self, page: WikiPage, value: bool) -> None:
        """A targeted UPDATE of just this one column, not the usual
        attribute-assignment-then-flush path: that would also fire
        `updated_at`'s `onupdate=func.now()` for the whole row, incorrectly
        bumping the page's "last modified" metadata for what is an access
        setting, not a content edit."""
        await self.session.execute(
            sa_update(WikiPage)
            .where(WikiPage.id == page.id)
            .values(view_restricted=value, updated_at=WikiPage.updated_at)
        )
        _safe_set_committed_value(page, "view_restricted", value)

    async def can_view_page(self, page: WikiPage, user: User) -> bool:
        if await self.is_system_admin(user):
            return True
        space = await self.session.get(Space, page.space_id)
        if space is None or Permission.view not in await self.effective_permissions(space, user):
            return False
        if Permission.admin in await self.effective_permissions(space, user):
            return True
        for ancestor in await self._page_chain(page):
            if await self._principal_permission_denied(
                ancestor.id, user, PageRestrictionPermission.view
            ):
                return False
            principal_is_allowed = await self._principal_has_restriction(
                ancestor.id, user, PageRestrictionPermission.view
            )
            if await self._page_view_restricted_flag(ancestor.id) and not principal_is_allowed:
                return False
        return True

    async def can_edit_page(self, page: WikiPage, user: User) -> bool:
        if not await self.can_view_page(page, user):
            return False
        space = await self.session.get(Space, page.space_id)
        permissions = await self.effective_permissions(space, user) if space else set()
        if space is None or Permission.add not in permissions:
            return False
        if Permission.admin in permissions:
            return True
        if await self._principal_permission_denied(page.id, user, PageRestrictionPermission.edit):
            return False
        # Once this page is closed to a named list of viewers - its own rows
        # or an inherited ancestor's - ambient space Edit no longer carries
        # through automatically: a plain space editor who only reaches the
        # page via the View allow-list (same as an explicit Edit allow-list)
        # needs their own Edit grant on it. Without this, checking someone's
        # View box but leaving Edit unchecked in the page-access dialog did
        # nothing for anyone who already held Edit at the space level - the
        # per-page restriction was decorative for them.
        if await self._restriction_rows_exist(
            page.id, PageRestrictionPermission.edit
        ) or await self.page_view_is_restricted(page):
            return await self._principal_has_restriction(
                page.id, user, PageRestrictionPermission.edit
            )
        return True

    async def require_page_restriction_admin(self, page: WikiPage, user: User) -> None:
        space = await self.session.get(Space, page.space_id)
        if space is None:
            raise NotFoundError("Page space not found.")
        permissions = await self.effective_permissions(space, user)
        if Permission.view in permissions and Permission.restrictions in permissions:
            return
        raise PermissionDeniedError("You need View and Restrictions permission in this space.")

    async def set_page_restriction(
        self,
        page: WikiPage,
        principal_id: uuid.UUID,
        permission: PageRestrictionPermission,
        actor: User,
        *,
        group: bool,
        present: bool,
    ) -> None:
        await self.require_page_restriction_admin(page, actor)
        principal = (
            await self.session.get(Group, principal_id)
            if group
            else await self.session.get(User, principal_id)
        )
        if (
            principal is None
            or (group and isinstance(principal, Group) and not principal.is_active)
            or (not group and isinstance(principal, User) and not principal.is_active)
        ):
            raise NotFoundError("Restriction principal not found.")
        if present and not await self._has_space_access(page.space_id, principal_id, group=group):
            raise BadRequestError(
                "This "
                + ("group" if group else "user")
                + " has no access to this space yet - add it in the space's own"
                " Access & Permissions before restricting a page to it.",
                code="principal_lacks_space_access",
            )
        model = PageGroupRestriction if group else PageUserRestriction
        key = {"page_id": page.id, "permission": permission}
        key["group_id" if group else "user_id"] = principal_id
        row = await self.session.scalar(select(model).filter_by(**key))
        if present and row is None:
            self.session.add(model(**key))
        elif not present and row is not None:
            if (
                permission is PageRestrictionPermission.view
                and await self._has_other_page_restriction(
                    page, principal_id, group=group, excluding=PageRestrictionPermission.view
                )
            ):
                raise ConflictError(
                    "View cannot be removed while this principal still has Edit "
                    "access on this page - Edit is useless without it. Remove "
                    "Edit first.",
                    code="view_required",
                )
            await self.session.delete(row)
        # Adding the first person to the allow-list is how this page becomes
        # "Restricted" through the dialog's own Add flow, same as before -
        # nobody has to separately flip a mode switch first. Removing rows
        # never flips it back, even down to zero: an allow-list emptied out
        # stays Restricted (closed to everyone but admins) until an admin
        # explicitly reopens it or hits Reset - see `set_page_view_mode`.
        if present and permission is PageRestrictionPermission.view and not page.view_restricted:
            await self._set_page_view_restricted(page, True)
        await self.session.flush()
        # Every other page permission is useless without View, same rule as
        # `set_space_permission` - granting Edit implicitly grants View too
        # (and, same as a direct View grant above, puts the page into
        # Restricted mode if it wasn't already).
        if present and permission is not PageRestrictionPermission.view:
            view_key = dict(key, permission=PageRestrictionPermission.view)
            view_row = await self.session.scalar(select(model).filter_by(**view_key))
            if view_row is None:
                self.session.add(model(**view_key))
                await self.session.flush()
                if not page.view_restricted:
                    await self._set_page_view_restricted(page, True)

    async def _has_other_page_restriction(
        self,
        page: WikiPage,
        principal_id: uuid.UUID,
        *,
        group: bool,
        excluding: PageRestrictionPermission,
    ) -> bool:
        model = PageGroupRestriction if group else PageUserRestriction
        principal_column = model.group_id if group else model.user_id
        return (
            await self.session.scalar(
                select(model.permission).where(
                    model.page_id == page.id,
                    principal_column == principal_id,
                    model.permission != excluding,
                    model.denied.is_(False),
                )
            )
        ) is not None

    async def set_page_view_mode(self, page: WikiPage, actor: User, *, restricted: bool) -> None:
        """Flips the page's own General-access setting without touching any
        restriction row - switching back and forth is meant to be free, so
        whatever allow-list or per-principal blocks were already configured
        come right back instead of having to be rebuilt from scratch."""
        await self.require_page_restriction_admin(page, actor)
        await self._set_page_view_restricted(page, restricted)
        await self.session.flush()

    async def reset_page_access(self, page: WikiPage, actor: User) -> None:
        """Wipes whichever configuration the page's *current* mode actually
        uses, back to that mode's own default - the deliberate, confirmed
        counterpart to freely switching modes (which preserves everything).
        Restricted resets to an empty allow-list (closed to everyone but
        admins, the same as a page that was just switched to Restricted and
        has had no one added yet); Open resets by clearing every explicit
        block, so everyone falls back to plain space-derived access. Each
        mode's own rows are left alone while the *other* mode is active, so
        switching to it still finds whatever was last configured there."""
        await self.require_page_restriction_admin(page, actor)
        await self.session.execute(
            delete(PageUserRestriction).where(
                PageUserRestriction.page_id == page.id,
                PageUserRestriction.denied.is_(not page.view_restricted),
            )
        )
        await self.session.execute(
            delete(PageGroupRestriction).where(
                PageGroupRestriction.page_id == page.id,
                PageGroupRestriction.denied.is_(not page.view_restricted),
            )
        )
        await self.session.flush()

    async def set_page_permission_denial(
        self,
        page: WikiPage,
        principal_id: uuid.UUID,
        permission: PageRestrictionPermission,
        actor: User,
        *,
        group: bool,
        denied: bool,
    ) -> None:
        """Blocks (or un-blocks) one principal on this exact page - the
        Open-page counterpart to `set_page_restriction`'s allow-list, for
        excluding a person/group from an otherwise-Open page without having
        to enumerate everyone else who should keep their access. Never
        touches an existing allow-list grant (`denied=False` row) for the
        same principal - clearing a block only ever falls back to whatever
        that principal would otherwise have (the space, an allow-list grant,
        ...), it never revokes one."""
        await self.require_page_restriction_admin(page, actor)
        principal = (
            await self.session.get(Group, principal_id)
            if group
            else await self.session.get(User, principal_id)
        )
        if (
            principal is None
            or (group and isinstance(principal, Group) and not principal.is_active)
            or (not group and isinstance(principal, User) and not principal.is_active)
        ):
            raise NotFoundError("Restriction principal not found.")
        model = PageGroupRestriction if group else PageUserRestriction
        key = {"page_id": page.id, "permission": permission}
        key["group_id" if group else "user_id"] = principal_id
        row = await self.session.scalar(select(model).filter_by(**key))
        if denied:
            if row is None:
                self.session.add(model(**key, denied=True))
            elif not row.denied:
                row.denied = True
        elif row is not None and row.denied:
            await self.session.delete(row)
        await self.session.flush()

    async def _has_space_access(
        self, space_id: uuid.UUID, principal_id: uuid.UUID, *, group: bool
    ) -> bool:
        model = SpaceGroupPermission if group else SpaceUserPermission
        principal_column = model.group_id if group else model.user_id
        return (
            await self.session.scalar(
                select(model.space_id)
                .where(model.space_id == space_id, principal_column == principal_id)
                .limit(1)
            )
        ) is not None

    async def list_users_with_space_access(self, space: Space) -> list[User]:
        """Users eligible to be named in a page restriction: only those the
        space itself already grants access to - anyone else would be added
        to a page's allow-list only to still be locked out at the space
        door.

        An `IN` subquery rather than a join + `DISTINCT`: a user can easily
        hold several permission rows on the same space (one join match
        each), and `User` carries a plain `json` column that Postgres has no
        equality operator for, so `SELECT DISTINCT` over the full entity
        fails outright."""
        return list(
            (
                await self.session.execute(
                    select(User)
                    .where(
                        User.id.in_(
                            select(SpaceUserPermission.user_id).where(
                                SpaceUserPermission.space_id == space.id
                            )
                        ),
                        User.is_active.is_(True),
                    )
                    .order_by(User.username)
                )
            ).scalars()
        )

    async def list_groups_with_space_access(self, space: Space) -> list[Group]:
        return list(
            (
                await self.session.execute(
                    select(Group)
                    .where(
                        Group.id.in_(
                            select(SpaceGroupPermission.group_id).where(
                                SpaceGroupPermission.space_id == space.id
                            )
                        ),
                        Group.is_active.is_(True),
                    )
                    .order_by(Group.name)
                )
            ).scalars()
        )

    async def list_users_for_page_restriction_picker(
        self, space: Space
    ) -> list[tuple[User, bool]]:
        """Every active user, paired with whether the space already grants
        them access. The page-restriction picker searches this - not just
        `list_users_with_space_access` - so someone who isn't a space member
        yet still turns up when an admin types their name; the picker greys
        that row out and explains why instead of making the search act like
        the person doesn't exist.

        Sorted with-access-first (each half still alphabetical) so the
        people actually eligible to be picked lead the list instead of
        being scattered among a much longer set of "not added to space"
        rows once the org has more than a handful of users."""
        with_access = {user.id for user in await self.list_users_with_space_access(space)}
        all_users = list(
            (
                await self.session.execute(
                    select(User).where(User.is_active.is_(True)).order_by(User.username)
                )
            ).scalars()
        )
        options = [(user, user.id in with_access) for user in all_users]
        options.sort(key=lambda item: not item[1])
        return options

    async def list_groups_for_page_restriction_picker(
        self, space: Space
    ) -> list[tuple[Group, bool]]:
        with_access = {group.id for group in await self.list_groups_with_space_access(space)}
        all_groups = list(
            (
                await self.session.execute(
                    select(Group).where(Group.is_active.is_(True)).order_by(Group.name)
                )
            ).scalars()
        )
        options = [(group, group.id in with_access) for group in all_groups]
        options.sort(key=lambda item: not item[1])
        return options

    async def list_page_access_roster_users(
        self, page: WikiPage, space: Space
    ) -> list[tuple[User, bool, bool, bool, bool]]:
        """Every user with space access, paired with their *current*
        View/Edit access to this page and whether each is locked. This is
        the Open-page counterpart to the Restricted allow-list table: rather
        than an empty list you add exceptions to, it shows everyone already
        eligible with their access pre-reflected, so unchecking one is a
        direct "block this person" action instead of a first, indirect step
        of naming who else must now be re-added to keep their access.

        Both boxes are locked - forced to View=Edit=True - for a space
        Admin: `can_view_page`/`can_edit_page` bypass every page-level
        restriction for one (see their own docstrings), so a block here
        would silently do nothing. Leaving the checkboxes clickable would
        read as "I've blocked this person" when nothing had actually
        changed, which is worse than not offering the control at all.

        Edit alone is additionally locked (not independently toggleable)
        for anyone lacking space Add/Edit outright, or currently without
        View - restricting a page only ever narrows who edits among people
        the space already lets edit, it never grants editing beyond that
        (matches `can_edit_page`); and nobody edits what they can't view."""
        users = await self.list_users_with_space_access(space)
        if not users:
            return []
        user_ids = [user.id for user in users]
        own_rows = (
            await self.session.execute(
                select(
                    PageUserRestriction.user_id,
                    PageUserRestriction.permission,
                    PageUserRestriction.denied,
                ).where(
                    PageUserRestriction.page_id == page.id,
                    PageUserRestriction.user_id.in_(user_ids),
                )
            )
        ).all()
        own_denied = {(row.user_id, row.permission): row.denied for row in own_rows}
        group_rows = (
            await self.session.execute(
                select(
                    GroupMember.user_id,
                    PageGroupRestriction.permission,
                    PageGroupRestriction.denied,
                )
                .join(PageGroupRestriction, PageGroupRestriction.group_id == GroupMember.group_id)
                .join(Group, Group.id == GroupMember.group_id)
                .where(
                    PageGroupRestriction.page_id == page.id,
                    GroupMember.user_id.in_(user_ids),
                    Group.is_active.is_(True),
                )
            )
        ).all()
        group_denied_flags: dict[tuple[uuid.UUID, PageRestrictionPermission], list[bool]] = {}
        for row in group_rows:
            group_denied_flags.setdefault((row.user_id, row.permission), []).append(row.denied)

        def denied_for(user_id: uuid.UUID, permission: PageRestrictionPermission) -> bool:
            direct = own_denied.get((user_id, permission))
            if direct is not None:
                return direct
            flags = group_denied_flags.get((user_id, permission))
            return any(flags) if flags else False

        result: list[tuple[User, bool, bool, bool, bool]] = []
        for user in users:
            perms = await self.effective_permissions(space, user)
            if Permission.admin in perms:
                result.append((user, True, True, True, True))
                continue
            base_view = Permission.view in perms
            base_edit = Permission.add in perms
            view = base_view and not denied_for(user.id, PageRestrictionPermission.view)
            edit = base_edit and view and not denied_for(user.id, PageRestrictionPermission.edit)
            result.append((user, view, edit, False, not base_edit or not view))
        return result

    async def list_page_access_roster_groups(
        self, page: WikiPage, space: Space
    ) -> list[tuple[Group, bool, bool, bool, bool]]:
        """The group-level counterpart to `list_page_access_roster_users` -
        a group's own space grant decides its base View/Edit, since a page
        restriction targets the group as a principal in its own right, not
        each of its members individually. Same admin-bypass lock on both
        boxes applies here too, for a group holding space Admin."""
        groups = await self.list_groups_with_space_access(space)
        if not groups:
            return []
        group_ids = [group.id for group in groups]
        space_perm_rows = (
            await self.session.execute(
                select(SpaceGroupPermission.group_id, SpaceGroupPermission.permission).where(
                    SpaceGroupPermission.space_id == space.id,
                    SpaceGroupPermission.group_id.in_(group_ids),
                )
            )
        ).all()
        space_perms: dict[uuid.UUID, set[Permission]] = {}
        for group_id, permission in space_perm_rows:
            space_perms.setdefault(group_id, set()).add(permission)
        own_rows = (
            await self.session.execute(
                select(
                    PageGroupRestriction.group_id,
                    PageGroupRestriction.permission,
                    PageGroupRestriction.denied,
                ).where(
                    PageGroupRestriction.page_id == page.id,
                    PageGroupRestriction.group_id.in_(group_ids),
                )
            )
        ).all()
        denied_map = {(row.group_id, row.permission): row.denied for row in own_rows}

        result: list[tuple[Group, bool, bool, bool, bool]] = []
        for group in groups:
            perms = space_perms.get(group.id, set())
            if Permission.admin in perms:
                result.append((group, True, True, True, True))
                continue
            base_view = Permission.view in perms
            base_edit = Permission.add in perms
            view = base_view and not denied_map.get((group.id, PageRestrictionPermission.view), False)
            edit = (
                base_edit
                and view
                and not denied_map.get((group.id, PageRestrictionPermission.edit), False)
            )
            result.append((group, view, edit, False, not base_edit or not view))
        return result

    async def list_page_restrictions(self, page: WikiPage, actor: User) -> list[dict[str, object]]:
        """The page's own allow-list rows only - a `denied` row is a block,
        not a grant, and lives in a different part of the UI (the roster -
        see `list_page_access_roster`) so it never gets counted here as
        evidence the page is "Restricted"."""
        await self.require_page_restriction_admin(page, actor)
        result: list[dict[str, object]] = []
        users = (
            await self.session.execute(
                select(PageUserRestriction, User)
                .join(User, User.id == PageUserRestriction.user_id)
                .where(
                    PageUserRestriction.page_id == page.id,
                    PageUserRestriction.denied.is_(False),
                )
            )
        ).all()
        groups = (
            await self.session.execute(
                select(PageGroupRestriction, Group)
                .join(Group, Group.id == PageGroupRestriction.group_id)
                .where(
                    PageGroupRestriction.page_id == page.id,
                    PageGroupRestriction.denied.is_(False),
                )
            )
        ).all()
        for row, principal in users:
            result.append(
                {
                    "page_id": page.id,
                    "principal_id": principal.id,
                    "principal_type": "user",
                    "principal_name": principal.username,
                    "permission": row.permission,
                }
            )
        for row, principal in groups:
            result.append(
                {
                    "page_id": page.id,
                    "principal_id": principal.id,
                    "principal_type": "group",
                    "principal_name": principal.name,
                    "permission": row.permission,
                }
            )
        return result
