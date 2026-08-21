"""Additive permission resolution shared by all content services."""

from __future__ import annotations

import inspect
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


async def _safe_refresh(session: Any, instance: Any) -> None:
    refresh = getattr(session, "refresh", None)
    if refresh is not None:
        try:
            res = refresh(instance)
            if inspect.isawaitable(res):
                await res
        except Exception:
            pass

from app.core.exceptions import ConflictError, NotFoundError, PermissionDeniedError
from app.models.page import WikiPage
from app.models.permission import (
    GlobalPermission,
    Group,
    GroupGlobalPermission,
    GroupMember,
    Permission,
    SpaceGroupPermission,
    SpaceUserPermission,
)
from app.models.restriction import (
    PageGroupRestriction,
    PageRestrictionPermission,
    PageUserRestriction,
)
from app.models.space import Space, SpaceMember, SpaceRole, SpaceVisibility
from app.models.user import User
from app.schemas.permission import GroupCreate, GroupUpdate

ALL_SPACE_PERMISSIONS = frozenset(Permission)
ROLE_PERMISSIONS: dict[SpaceRole, frozenset[Permission]] = {
    SpaceRole.viewer: frozenset({Permission.view}),
    SpaceRole.editor: frozenset({Permission.view, Permission.add}),
    SpaceRole.admin: ALL_SPACE_PERMISSIONS,
}


class PermissionService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _has_group_global_permission(self, user: User, permission: GlobalPermission) -> bool:
        return (
            await self.session.scalar(
                select(GroupGlobalPermission.group_id)
                .join(GroupMember, GroupMember.group_id == GroupGlobalPermission.group_id)
                .join(Group, Group.id == GroupMember.group_id)
                .where(
                    GroupMember.user_id == user.id,
                    GroupGlobalPermission.permission == permission,
                    Group.is_active.is_(True),
                )
                .limit(1)
            )
        ) is not None

    async def is_system_admin(self, user: User) -> bool:
        """Return whether the user has the instance-wide admin capability."""
        return user.is_superuser or await self._has_group_global_permission(
            user, GlobalPermission.system_admin
        )

    async def global_permissions(self, user: User) -> list[GlobalPermission]:
        """Return the effective global capabilities for the current user."""
        if user.is_superuser:
            return list(GlobalPermission)
        return list(
            await self.session.scalars(
                select(GroupGlobalPermission.permission)
                .join(GroupMember, GroupMember.group_id == GroupGlobalPermission.group_id)
                .join(Group, Group.id == GroupMember.group_id)
                .where(GroupMember.user_id == user.id, Group.is_active.is_(True))
                .distinct()
            )
        )

    async def effective_permissions(self, space: Space, user: User) -> set[Permission]:
        if await self.is_system_admin(user):
            return set(ALL_SPACE_PERMISSIONS)

        permissions: set[Permission] = set()
        if space.visibility is SpaceVisibility.open:
            permissions.add(Permission.view)

        permissions.update(
            await self.session.scalars(
                select(SpaceUserPermission.permission).where(
                    SpaceUserPermission.space_id == space.id,
                    SpaceUserPermission.user_id == user.id,
                )
            )
        )
        permissions.update(
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
        return permissions

    async def require(self, space: Space, user: User, permission: Permission) -> None:
        if permission not in await self.effective_permissions(space, user):
            raise PermissionDeniedError(
                f"You need the '{permission.value}' permission in this space.",
                code="space_permission_denied",
            )

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
        if await self.is_system_admin(user):
            return True
        return await self._has_group_global_permission(user, permission)

    async def require_global(self, user: User, permission: GlobalPermission) -> None:
        if not await self.has_global(user, permission):
            raise PermissionDeniedError("This action requires a global permission.")

    async def assert_user_can_be_removed(self, user: User) -> None:
        """Protect group ownership and the last active Space administrator."""
        owned_group = await self.session.scalar(
            select(Group.id).where(Group.owner_id == user.id).limit(1)
        )
        if owned_group is not None:
            raise ConflictError(
                "Transfer group ownership before deactivating or deleting this user.",
                code="group_owner_required",
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
        await self.session.flush()
        await _safe_refresh(self.session, group)
        return group

    async def get_group(self, group_id: uuid.UUID) -> Group:
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
        if "owner_id" in data:
            owner = await self.session.get(User, data["owner_id"])
            if owner is None:
                raise NotFoundError("Group owner not found.")
            if not await self.session.scalar(
                select(GroupMember).where(
                    GroupMember.group_id == group.id, GroupMember.user_id == owner.id
                )
            ):
                self.session.add(GroupMember(group_id=group.id, user_id=owner.id))
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
            await self.session.delete(row)
        await self.session.flush()

    async def _has_space_admin(self, space: Space, *, excluding: dict[str, object]) -> bool:
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
        user_row = await self.session.scalar(
            select(PageUserRestriction.page_id)
            .where(
                PageUserRestriction.page_id == page_id,
                PageUserRestriction.permission == permission,
            )
            .limit(1)
        )
        group_row = await self.session.scalar(
            select(PageGroupRestriction.page_id)
            .where(
                PageGroupRestriction.page_id == page_id,
                PageGroupRestriction.permission == permission,
            )
            .limit(1)
        )
        return user_row is not None or group_row is not None

    async def _principal_has_restriction(
        self, page_id: uuid.UUID, user: User, permission: PageRestrictionPermission
    ) -> bool:
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
                    GroupMember.user_id == user.id,
                    Group.is_active.is_(True),
                )
                .limit(1)
            )
        ) is not None

    async def page_view_is_restricted(self, page: WikiPage) -> bool:
        """True when a view restriction narrows who may read this page.

        Restrictions inherit, so the whole ancestor chain counts: a child of a
        restricted page is every bit as closed even with no rows of its own.
        This answers "is this page restricted", not "may this user read it" -
        callers wanting the latter want :meth:`can_view_page`.
        """
        for ancestor in await self._page_chain(page):
            if await self._restriction_rows_exist(ancestor.id, PageRestrictionPermission.view):
                return True
        return False

    async def can_view_page(self, page: WikiPage, user: User) -> bool:
        if await self.is_system_admin(user):
            return True
        space = await self.session.get(Space, page.space_id)
        if space is None or Permission.view not in await self.effective_permissions(space, user):
            return False
        if Permission.admin in await self.effective_permissions(space, user):
            return True
        for ancestor in await self._page_chain(page):
            has_view_restriction = await self._restriction_rows_exist(
                ancestor.id, PageRestrictionPermission.view
            )
            principal_is_allowed = await self._principal_has_restriction(
                ancestor.id, user, PageRestrictionPermission.view
            )
            if has_view_restriction and not principal_is_allowed:
                return False
        return True

    async def can_edit_page(self, page: WikiPage, user: User) -> bool:
        if not await self.can_view_page(page, user):
            return False
        space = await self.session.get(Space, page.space_id)
        if space is None or Permission.add not in await self.effective_permissions(space, user):
            return False
        if await self._restriction_rows_exist(page.id, PageRestrictionPermission.edit):
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
        model = PageGroupRestriction if group else PageUserRestriction
        key = {"page_id": page.id, "permission": permission}
        key["group_id" if group else "user_id"] = principal_id
        row = await self.session.scalar(select(model).filter_by(**key))
        if present and row is None:
            self.session.add(model(**key))
        elif not present and row is not None:
            await self.session.delete(row)
        await self.session.flush()

    async def list_page_restrictions(self, page: WikiPage, actor: User) -> list[dict[str, object]]:
        await self.require_page_restriction_admin(page, actor)
        result: list[dict[str, object]] = []
        users = (
            await self.session.execute(
                select(PageUserRestriction, User)
                .join(User, User.id == PageUserRestriction.user_id)
                .where(PageUserRestriction.page_id == page.id)
            )
        ).all()
        groups = (
            await self.session.execute(
                select(PageGroupRestriction, Group)
                .join(Group, Group.id == PageGroupRestriction.group_id)
                .where(PageGroupRestriction.page_id == page.id)
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
