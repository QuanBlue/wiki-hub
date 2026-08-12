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

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError, PermissionDeniedError
from app.core.logging import get_logger
from app.models.space import Space, SpaceMember, SpaceRole, SpaceStatus
from app.models.user import User
from app.repositories.space import SpaceRepository
from app.repositories.user import UserRepository
from app.schemas.space import SpaceCreate, SpaceMemberRead, SpaceRead, SpaceUpdate

logger = get_logger(__name__)


class SpaceService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.spaces = SpaceRepository(session)
        self.users = UserRepository(session)

    # -- authorization -----------------------------------------------------
    async def role_of(self, space: Space, user: User) -> SpaceRole | None:
        member = await self.spaces.get_member(space.id, user.id)
        return member.role if member else None

    async def require_admin(self, space: Space, user: User) -> None:
        """Raise unless ``user`` may administer ``space``."""
        if user.is_superuser:
            return
        role = await self.role_of(space, user)
        if role is not SpaceRole.admin:
            raise PermissionDeniedError("You need the administrator role in this space to do that.")

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
    async def to_read(
        self, space: Space, user: User, *, is_favorite: bool | None = None
    ) -> SpaceRead:
        favorite = (
            is_favorite
            if is_favorite is not None
            else await self.spaces.is_favorite(space.id, user.id)
        )
        return SpaceRead(
            id=space.id,
            key=space.key,
            name=space.name,
            description=space.description,
            icon=space.icon,
            status=space.status,
            created_at=space.created_at,
            updated_at=space.updated_at,
            created_by_username=space.created_by.username if space.created_by else None,
            member_count=len(space.members),
            is_favorite=favorite,
            my_role=await self.role_of(space, user),
        )

    async def to_read_many(self, spaces: Sequence[Space], user: User) -> list[SpaceRead]:
        # Resolve favourites in one query rather than once per space.
        favorites = await self.spaces.favorite_ids(user.id)
        return [
            await self.to_read(space, user, is_favorite=space.id in favorites) for space in spaces
        ]

    # -- reads -------------------------------------------------------------
    async def get_by_key(self, key: str) -> Space:
        space = await self.spaces.get_by_key(key)
        if space is None:
            raise NotFoundError(f"Space '{key}' was not found.")
        return space

    async def list_spaces(
        self, user: User, *, include_archived: bool = False, limit: int = 100, offset: int = 0
    ) -> list[SpaceRead]:
        spaces = await self.spaces.list_spaces(
            include_archived=include_archived, limit=limit, offset=offset
        )
        return await self.to_read_many(spaces, user)

    async def list_recent(self, user: User, *, limit: int = 20) -> list[SpaceRead]:
        return await self.to_read_many(await self.spaces.list_recent(limit=limit), user)

    async def list_favorites(self, user: User) -> list[SpaceRead]:
        return await self.to_read_many(await self.spaces.list_favorites(user.id), user)

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
            status=SpaceStatus.active,
            created_by_id=creator.id,
        )
        # The creator administers the space, so it is never left unmanageable.
        space.members.append(SpaceMember(user_id=creator.id, role=SpaceRole.admin))

        self.spaces.add(space)
        await self.session.flush()
        await self.session.refresh(space)
        logger.info("space_created", key=space.key, by=creator.username)
        return space

    async def update(self, space: Space, payload: SpaceUpdate, user: User) -> Space:
        await self.require_admin(space, user)

        data = payload.model_dump(exclude_unset=True)
        if data.get("name") is not None:
            space.name = str(data["name"]).strip()
        if data.get("description") is not None:
            space.description = str(data["description"]).strip()
        if data.get("icon") is not None:
            space.icon = str(data["icon"]).strip()
        if data.get("status") is not None:
            space.status = SpaceStatus(data["status"])

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
        if member is None:
            member = SpaceMember(space_id=space.id, user_id=user_id, role=role)
            self.session.add(member)
        else:
            member.role = role

        await self.session.flush()
        return SpaceMemberRead(
            user_id=target.id, username=target.username, full_name=target.full_name, role=role
        )

    async def remove_member(self, space: Space, actor: User, user_id: uuid.UUID) -> None:
        await self.require_admin(space, actor)

        # Refuse to remove the last administrator: a space with no admin can
        # never be managed again except by a system superuser.
        members = await self.spaces.list_members(space.id)
        admins = [m for m in members if m.role is SpaceRole.admin]
        if len(admins) == 1 and admins[0].user_id == user_id:
            raise ConflictError(
                "This is the only administrator of the space. Promote another "
                "member before removing this one.",
                code="last_space_admin",
            )

        await self.spaces.remove_member(space.id, user_id)
        await self.session.flush()

    # -- favourites --------------------------------------------------------
    async def set_favorite(self, space: Space, user: User, favorite: bool) -> None:
        if favorite:
            await self.spaces.add_favorite(space.id, user.id)
        else:
            await self.spaces.remove_favorite(space.id, user.id)
        await self.session.flush()
