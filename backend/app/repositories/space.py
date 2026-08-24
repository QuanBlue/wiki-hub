"""Data access for spaces, membership and favourites."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import Select, delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.space import Space, SpaceFavorite, SpaceMember, SpaceStatus, SpaceVisit


class SpaceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # -- reads -------------------------------------------------------------
    def _base_query(self, *, include_archived: bool) -> Select[tuple[Space]]:
        stmt = select(Space)
        if not include_archived:
            stmt = stmt.where(Space.status == SpaceStatus.active)
        return stmt

    async def get(self, space_id: uuid.UUID) -> Space | None:
        return await self.session.get(Space, space_id)

    async def get_by_key(self, key: str) -> Space | None:
        stmt = select(Space).where(func.upper(Space.key) == key.strip().upper())
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_spaces(
        self,
        *,
        include_archived: bool = False,
        limit: int = 100,
        offset: int = 0,
    ) -> Sequence[Space]:
        stmt = (
            self._base_query(include_archived=include_archived)
            .order_by(Space.name)
            .limit(limit)
            .offset(offset)
        )
        return (await self.session.execute(stmt)).scalars().unique().all()

    async def list_recent(self, *, limit: int = 20) -> Sequence[Space]:
        """Most recently updated spaces - what the "Recent" nav section shows."""
        stmt = (
            self._base_query(include_archived=False).order_by(Space.updated_at.desc()).limit(limit)
        )
        return (await self.session.execute(stmt)).scalars().unique().all()

    async def list_favorites(self, user_id: uuid.UUID) -> Sequence[Space]:
        stmt = (
            select(Space)
            .join(SpaceFavorite, SpaceFavorite.space_id == Space.id)
            .where(SpaceFavorite.user_id == user_id)
            .order_by(Space.name)
        )
        return (await self.session.execute(stmt)).scalars().unique().all()

    async def count_members(self, space_id: uuid.UUID) -> int:
        stmt = select(func.count()).select_from(SpaceMember).where(SpaceMember.space_id == space_id)
        return int((await self.session.execute(stmt)).scalar_one())

    # -- membership --------------------------------------------------------
    async def get_member(self, space_id: uuid.UUID, user_id: uuid.UUID) -> SpaceMember | None:
        stmt = select(SpaceMember).where(
            SpaceMember.space_id == space_id, SpaceMember.user_id == user_id
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_members(self, space_id: uuid.UUID) -> Sequence[SpaceMember]:
        stmt = select(SpaceMember).where(SpaceMember.space_id == space_id)
        return (await self.session.execute(stmt)).scalars().unique().all()

    async def remove_member(self, space_id: uuid.UUID, user_id: uuid.UUID) -> None:
        await self.session.execute(
            delete(SpaceMember).where(
                SpaceMember.space_id == space_id, SpaceMember.user_id == user_id
            )
        )

    # -- favourites --------------------------------------------------------
    async def is_favorite(self, space_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        stmt = select(SpaceFavorite).where(
            SpaceFavorite.space_id == space_id, SpaceFavorite.user_id == user_id
        )
        return (await self.session.execute(stmt)).scalar_one_or_none() is not None

    async def favorite_ids(self, user_id: uuid.UUID) -> set[uuid.UUID]:
        """One query for the whole list view, instead of one per row."""
        stmt = select(SpaceFavorite.space_id).where(SpaceFavorite.user_id == user_id)
        return set((await self.session.execute(stmt)).scalars().all())

    async def add_favorite(self, space_id: uuid.UUID, user_id: uuid.UUID) -> None:
        if not await self.is_favorite(space_id, user_id):
            self.session.add(SpaceFavorite(space_id=space_id, user_id=user_id))

    async def remove_favorite(self, space_id: uuid.UUID, user_id: uuid.UUID) -> None:
        await self.session.execute(
            delete(SpaceFavorite).where(
                SpaceFavorite.space_id == space_id, SpaceFavorite.user_id == user_id
            )
        )

    # -- visits --------------------------------------------------------------
    async def record_visit(self, space_id: uuid.UUID, user_id: uuid.UUID) -> None:
        """Bump the (user, space) visit counter, creating the row on first visit.

        A single upsert rather than a read-then-write so two concurrent
        requests from the same user can never race and drop a count.
        """
        stmt = pg_insert(SpaceVisit).values(
            user_id=user_id, space_id=space_id, visit_count=1
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[SpaceVisit.user_id, SpaceVisit.space_id],
            set_={
                "visit_count": SpaceVisit.visit_count + 1,
                "last_visited_at": func.now(),
            },
        )
        await self.session.execute(stmt)

    async def top_visited(self, user_id: uuid.UUID, *, limit: int = 5) -> Sequence[Space]:
        """This user's spaces ordered by how often they open them."""
        stmt = (
            self._base_query(include_archived=False)
            .join(SpaceVisit, SpaceVisit.space_id == Space.id)
            .where(SpaceVisit.user_id == user_id)
            .order_by(SpaceVisit.visit_count.desc(), SpaceVisit.last_visited_at.desc())
            .limit(limit)
        )
        return (await self.session.execute(stmt)).scalars().unique().all()

    # -- writes ------------------------------------------------------------
    def add(self, space: Space) -> Space:
        self.session.add(space)
        return space

    async def delete(self, space: Space) -> None:
        await self.session.delete(space)
