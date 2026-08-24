"""Space business rules, including the space-level permission checks.

Authorization policy for this phase, stated explicitly so it can be audited:

* Any authenticated user may **read** the list of active spaces. WikiHub is an
  internal tool, and defaulting to open-read matches how teams actually use a
  wiki. Restricting reads is the job of the page-level permissions in a later
  phase, which this membership model is already shaped for.
* **Writing** a space (edit, archive, delete, manage members) requires either
  the ``admin`` role in that space or a system superuser.
* The creator automatically becomes a space ``admin``, so a space is never
  created without someone able to administer it.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError
from app.core.logging import get_logger
from app.models.page import WikiPage
from app.models.permission import Group, Permission, SpaceGroupPermission, SpaceUserPermission
from app.models.space import Space, SpaceMember, SpaceRole, SpaceStatus, SpaceVisibility
from app.models.user import User
from app.modules.permissions.service import ROLE_PERMISSIONS, PermissionService
from app.repositories.space import SpaceRepository
from app.repositories.user import UserRepository
from app.schemas.space import SpaceCreate, SpaceMemberRead, SpaceRead, SpaceUpdate

logger = get_logger(__name__)

#: Groups that already carry blanket admin access by convention, so counting
#: them as a per-space "licensed" grant would be redundant noise - same idea
#: as excluding superusers from the direct-user count below.
DEFAULT_ADMIN_GROUP_NAMES = frozenset({"confluence-administrators"})


class SpaceService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.spaces = SpaceRepository(session)
        self.users = UserRepository(session)
        self.permissions = PermissionService(session)

    # -- authorization -----------------------------------------------------
    async def role_of(self, space: Space, user: User) -> SpaceRole | None:
        return await self.permissions.role_of(space, user)

    async def require_admin(self, space: Space, user: User) -> None:
        """Raise unless ``user`` may administer ``space``."""
        await self.permissions.require(space, user, Permission.admin)

    async def require_view(self, space: Space, user: User) -> None:
        await self.permissions.require(space, user, Permission.view)

    async def require_add(self, space: Space, user: User) -> None:
        await self.permissions.require(space, user, Permission.add)

    # -- persistence helpers -----------------------------------------------
    async def _flush_and_refresh(self, space: Space) -> None:
        """Flush an UPDATE, then reload the row.

        ``updated_at`` carries ``onupdate=func.now()``, so SQLAlchemy expires it
        after every UPDATE to pick up the server-computed value. Reading it
        afterwards would trigger an implicit lazy load from async code, which
        raises ``MissingGreenlet``. Refreshing here does that I/O explicitly,
        inside the async context where it is legal.
        """
        await self.session.flush()
        await self.session.refresh(space)

    # -- serialisation -----------------------------------------------------
    async def _permission_principal_counts(
        self, space_id: uuid.UUID
    ) -> tuple[int, int]:
        """(distinct groups, distinct non-superuser users) with a direct grant.

        System administrators already have full access to every space by
        default, so they are excluded from the user count - otherwise every
        space would misleadingly show them as an explicit "licensed" member.
        """
        group_count = await self.session.scalar(
            select(func.count(func.distinct(SpaceGroupPermission.group_id)))
            .join(Group, Group.id == SpaceGroupPermission.group_id)
            .where(
                SpaceGroupPermission.space_id == space_id,
                func.lower(Group.name).notin_(DEFAULT_ADMIN_GROUP_NAMES),
            )
        )
        user_count = await self.session.scalar(
            select(func.count(func.distinct(SpaceUserPermission.user_id)))
            .join(User, User.id == SpaceUserPermission.user_id)
            .where(
                SpaceUserPermission.space_id == space_id,
                User.is_superuser.is_(False),
            )
        )
        return int(group_count or 0), int(user_count or 0)

    async def to_read(
        self,
        space: Space,
        user: User,
        *,
        is_favorite: bool | None = None,
        group_permission_count: int | None = None,
        direct_user_permission_count: int | None = None,
    ) -> SpaceRead:
        favorite = (
            is_favorite
            if is_favorite is not None
            else await self.spaces.is_favorite(space.id, user.id)
        )
        if group_permission_count is None or direct_user_permission_count is None:
            group_permission_count, direct_user_permission_count = (
                await self._permission_principal_counts(space.id)
            )
        return SpaceRead(
            id=space.id,
            key=space.key,
            name=space.name,
            description=space.description,
            icon=space.icon,
            font_family=space.font_family,
            status=space.status,
            visibility=space.visibility,
            created_at=space.created_at,
            updated_at=space.updated_at,
            created_by_username=space.created_by.username if space.created_by else None,
            member_count=len(space.members),
            group_permission_count=group_permission_count,
            direct_user_permission_count=direct_user_permission_count,
            is_favorite=favorite,
            my_role=await self.role_of(space, user),
            my_permissions=sorted(
                permission.value
                for permission in await self.permissions.effective_permissions(space, user)
            ),
        )

    async def to_read_many(self, spaces: Sequence[Space], user: User) -> list[SpaceRead]:
        # Resolve favourites and permission-principal counts in one query each
        # rather than once per space.
        favorites = await self.spaces.favorite_ids(user.id)
        space_ids = [space.id for space in spaces]
        group_counts: dict[uuid.UUID, int] = {}
        user_counts: dict[uuid.UUID, int] = {}
        if space_ids:
            group_rows = await self.session.execute(
                select(
                    SpaceGroupPermission.space_id,
                    func.count(func.distinct(SpaceGroupPermission.group_id)),
                )
                .join(Group, Group.id == SpaceGroupPermission.group_id)
                .where(
                    SpaceGroupPermission.space_id.in_(space_ids),
                    func.lower(Group.name).notin_(DEFAULT_ADMIN_GROUP_NAMES),
                )
                .group_by(SpaceGroupPermission.space_id)
            )
            group_counts = dict(group_rows.all())
            user_rows = await self.session.execute(
                select(
                    SpaceUserPermission.space_id,
                    func.count(func.distinct(SpaceUserPermission.user_id)),
                )
                .join(User, User.id == SpaceUserPermission.user_id)
                .where(
                    SpaceUserPermission.space_id.in_(space_ids),
                    User.is_superuser.is_(False),
                )
                .group_by(SpaceUserPermission.space_id)
            )
            user_counts = dict(user_rows.all())
        return [
            await self.to_read(
                space,
                user,
                is_favorite=space.id in favorites,
                group_permission_count=group_counts.get(space.id, 0),
                direct_user_permission_count=user_counts.get(space.id, 0),
            )
            for space in spaces
        ]

    # -- reads -------------------------------------------------------------
    async def get_by_key(self, key: str) -> Space:
        space = await self.spaces.get_by_key(key)
        if space is None:
            raise NotFoundError(f"Space '{key}' was not found.")
        return space

    async def _is_listable(self, space: Space, user: User) -> bool:
        """Whether ``space`` belongs in a directory listing for ``user``.

        A Confluence personal space (key ``~username``, the only spaces that
        can have a ``~`` key - WikiHub's own key validator requires a leading
        letter) is real content its owner and any Confluence-users-level
        grant can open, but Confluence itself never lists another person's
        personal space in the Space Directory - only a direct link or search
        surfaces it. WikiHub has no separate "not directory-listed but still
        viewable" tier, so this keeps a personal space out of list_spaces(),
        list_recent() and list_favorites() for anyone but its owner or a
        system administrator, while a direct visit still goes through
        require_view() -> effective_permissions() untouched.
        """
        if Permission.view not in await self.permissions.effective_permissions(space, user):
            return False
        if space.key.startswith("~") and not await self.permissions.is_system_admin(user):
            return space.key[1:].lower() == user.username.lower()
        return True

    async def list_spaces(
        self, user: User, *, include_archived: bool = False, limit: int = 100, offset: int = 0
    ) -> list[SpaceRead]:
        spaces = await self.spaces.list_spaces(
            include_archived=include_archived, limit=limit, offset=offset
        )
        visible: list[Space] = []
        for space in spaces:
            if await self._is_listable(space, user):
                visible.append(space)
        return await self.to_read_many(visible, user)

    async def list_recent(self, user: User, *, limit: int = 20) -> list[SpaceRead]:
        spaces = await self.spaces.list_recent(limit=limit)
        visible = [space for space in spaces if await self._is_listable(space, user)]
        return await self.to_read_many(visible, user)

    async def list_favorites(self, user: User) -> list[SpaceRead]:
        spaces = await self.spaces.list_favorites(user.id)
        visible = [space for space in spaces if await self._is_listable(space, user)]
        return await self.to_read_many(visible, user)

    async def record_visit(self, space: Space, user: User) -> None:
        """Count one more open of ``space`` by ``user``.

        Called from the "get one space" endpoint, which every space page
        (and every page inside it, since each fetches its parent space)
        already hits on load - so this needs no separate call from the
        frontend and can't fall out of sync with what was actually opened.
        """
        await self.spaces.record_visit(space.id, user.id)

    async def list_top_visited(self, user: User, *, limit: int = 5) -> list[SpaceRead]:
        """This user's own most-opened spaces, for the sidebar's "Most visited"."""
        spaces = await self.spaces.top_visited(user.id, limit=limit)
        visible = [space for space in spaces if await self._is_listable(space, user)]
        return await self.to_read_many(visible, user)

    async def list_members(self, space: Space) -> list[SpaceMemberRead]:
        members = await self.spaces.list_members(space.id)
        return [
            SpaceMemberRead(
                user_id=m.user_id,
                username=m.user.username,
                full_name=m.user.full_name,
                role=m.role,
            )
            for m in members
        ]

    # -- writes ------------------------------------------------------------
    async def create(self, payload: SpaceCreate, creator: User) -> Space:
        if await self.spaces.get_by_key(payload.key):
            raise ConflictError(
                f"A space with key '{payload.key}' already exists.", code="space_key_taken"
            )

        space = Space(
            key=payload.key,
            name=payload.name.strip(),
            description=payload.description.strip(),
            icon=payload.icon.strip(),
            font_family=payload.font_family.strip().lower() if payload.font_family else None,
            status=SpaceStatus.active,
            visibility=payload.visibility,
            created_by_id=creator.id,
        )
        # The creator administers the space, so it is never left unmanageable.
        space.members.append(SpaceMember(user_id=creator.id, role=SpaceRole.admin))

        self.spaces.add(space)
        await self.session.flush()
        from app.models.permission import SpaceUserPermission

        self.session.add_all(
            SpaceUserPermission(space_id=space.id, user_id=creator.id, permission=permission)
            for permission in ROLE_PERMISSIONS[SpaceRole.admin]
        )
        # Every newly-created space has a stable home route: the space key is
        # also the home page slug (for example QUAN -> /pages/quan).
        self.session.add(
            WikiPage(
                space_id=space.id,
                title=space.name,
                slug=payload.key.lower(),
                content=space.description,
                content_format="html",
                created_by_id=creator.id,
                updated_by_id=creator.id,
            )
        )
        await self.session.flush()
        await self.session.refresh(space)
        logger.info("space_created", key=space.key, by=creator.username)
        return space

    async def update(self, space: Space, payload: SpaceUpdate, user: User) -> Space:
        data = payload.model_dump(exclude_unset=True)
        if set(data) <= {"description"}:
            await self.require_add(space, user)
        else:
            await self.require_admin(space, user)
        if data.get("name") is not None:
            space.name = str(data["name"]).strip()
        if data.get("description") is not None:
            space.description = str(data["description"]).strip()
        if data.get("icon") is not None:
            space.icon = str(data["icon"]).strip()
        if "font_family" in data:
            val = data["font_family"]
            space.font_family = str(val).strip().lower() if val else None
        if data.get("status") is not None:
            space.status = SpaceStatus(data["status"])
        if data.get("visibility") is not None:
            space.visibility = SpaceVisibility(data["visibility"])

        await self._flush_and_refresh(space)
        logger.info("space_updated", key=space.key, by=user.username)
        return space

    async def archive(self, space: Space, user: User) -> Space:
        """Soft delete: an archived space keeps its content and can be restored."""
        await self.require_admin(space, user)
        space.status = SpaceStatus.archived
        await self._flush_and_refresh(space)
        logger.info("space_archived", key=space.key, by=user.username)
        return space

    async def unarchive(self, space: Space, user: User) -> Space:
        """Restore an archived space without changing its contents or members."""
        await self.require_admin(space, user)
        space.status = SpaceStatus.active
        await self._flush_and_refresh(space)
        logger.info("space_unarchived", key=space.key, by=user.username)
        return space

    async def delete(self, space: Space, user: User) -> None:
        # A space administrator owns the lifecycle of their space. System
        # administrators retain that ability across every space.
        await self.require_admin(space, user)
        await self.spaces.delete(space)
        await self.session.flush()
        logger.info("space_deleted", key=space.key, by=user.username)

    # -- membership --------------------------------------------------------
    async def set_member(
        self, space: Space, actor: User, user_id: uuid.UUID, role: SpaceRole
    ) -> SpaceMemberRead:
        await self.require_admin(space, actor)

        target = await self.users.get(user_id)
        if target is None:
            raise NotFoundError("User not found.")

        member = await self.spaces.get_member(space.id, user_id)
        direct_admin = await self.session.scalar(
            select(SpaceUserPermission.space_id).where(
                SpaceUserPermission.space_id == space.id,
                SpaceUserPermission.user_id == user_id,
                SpaceUserPermission.permission == Permission.admin,
            )
        )
        if (
            ((member is not None and member.role is SpaceRole.admin) or direct_admin is not None)
            and role is not SpaceRole.admin
            and not await self.permissions._has_space_admin(
                space, excluding={"user_id": user_id, "permission": Permission.admin}
            )
        ):
            raise ConflictError(
                "A Space must retain at least one administrator. Promote another "
                "administrator before changing this member.",
                code="last_space_admin",
            )
        if member is None:
            member = SpaceMember(space_id=space.id, user_id=user_id, role=role)
            self.session.add(member)
        else:
            member.role = role

        # Keep the new additive permission tables in sync with the legacy
        # membership endpoint during the transition.
        await self.session.execute(
            delete(SpaceUserPermission).where(
                SpaceUserPermission.space_id == space.id,
                SpaceUserPermission.user_id == user_id,
            )
        )
        for permission in ROLE_PERMISSIONS[role]:
            self.session.add(
                SpaceUserPermission(space_id=space.id, user_id=user_id, permission=permission)
            )

        await self.session.flush()
        return SpaceMemberRead(
            user_id=target.id, username=target.username, full_name=target.full_name, role=role
        )

    async def remove_member(self, space: Space, actor: User, user_id: uuid.UUID) -> None:
        await self.require_admin(space, actor)

        # Refuse to remove the last administrator: a space with no admin can
        # never be managed again except by a system superuser.
        member = await self.spaces.get_member(space.id, user_id)
        direct_admin = await self.session.scalar(
            select(SpaceUserPermission.space_id).where(
                SpaceUserPermission.space_id == space.id,
                SpaceUserPermission.user_id == user_id,
                SpaceUserPermission.permission == Permission.admin,
            )
        )
        if (
            (member is not None and member.role is SpaceRole.admin) or direct_admin is not None
        ) and not await self.permissions._has_space_admin(
            space, excluding={"user_id": user_id, "permission": Permission.admin}
        ):
            raise ConflictError(
                "This is the only administrator of the space. Promote another "
                "administrator before removing this one.",
                code="last_space_admin",
            )

        await self.spaces.remove_member(space.id, user_id)
        await self.session.execute(
            delete(SpaceUserPermission).where(
                SpaceUserPermission.space_id == space.id,
                SpaceUserPermission.user_id == user_id,
            )
        )
        await self.session.flush()

    # -- favourites --------------------------------------------------------
    async def set_favorite(self, space: Space, user: User, favorite: bool) -> None:
        if favorite:
            await self.spaces.add_favorite(space.id, user.id)
        else:
            await self.spaces.remove_favorite(space.id, user.id)
        await self.session.flush()
