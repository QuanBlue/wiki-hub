"""Data access for wiki pages."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import Select, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.page import PageLike, WikiPage


class PageRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def _space_query(self, space_id: uuid.UUID) -> Select[tuple[WikiPage]]:
        return select(WikiPage).where(WikiPage.space_id == space_id)

    async def get(self, page_id: uuid.UUID) -> WikiPage | None:
        return await self.session.get(WikiPage, page_id)

    async def get_by_slug(self, space_id: uuid.UUID, slug: str) -> WikiPage | None:
        stmt = self._space_query(space_id).where(func.lower(WikiPage.slug) == slug.strip().lower())
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def slug_exists(self, space_id: uuid.UUID, slug: str) -> bool:
        return await self.get_by_slug(space_id, slug) is not None

    async def list_for_space(
        self, space_id: uuid.UUID, *, limit: int = 100, offset: int = 0
    ) -> Sequence[WikiPage]:
        stmt = (
            self._space_query(space_id)
            .order_by(WikiPage.title.asc(), WikiPage.created_at.asc())
            .limit(limit)
            .offset(offset)
        )
        return (await self.session.execute(stmt)).scalars().unique().all()

    async def list_all_for_space(self, space_id: uuid.UUID) -> Sequence[WikiPage]:
        stmt = self._space_query(space_id).order_by(WikiPage.title.asc(), WikiPage.created_at.asc())
        return (await self.session.execute(stmt)).scalars().unique().all()

    def add(self, page: WikiPage) -> WikiPage:
        self.session.add(page)
        return page

    async def list_children(self, page_id: uuid.UUID) -> Sequence[WikiPage]:
        stmt = select(WikiPage).where(WikiPage.parent_id == page_id)
        return (await self.session.execute(stmt)).scalars().unique().all()

    async def delete(self, page: WikiPage) -> None:
        await self.session.delete(page)

    async def like_count(self, page_id: uuid.UUID) -> int:
        stmt = select(func.count()).select_from(PageLike).where(PageLike.page_id == page_id)
        return int((await self.session.execute(stmt)).scalar_one())

    async def is_liked(self, page_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        return await self.session.get(PageLike, {"page_id": page_id, "user_id": user_id}) is not None

    async def set_like(self, page_id: uuid.UUID, user_id: uuid.UUID, liked: bool) -> None:
        existing = await self.session.get(PageLike, {"page_id": page_id, "user_id": user_id})
        if liked and existing is None:
            self.session.add(PageLike(page_id=page_id, user_id=user_id))
        elif not liked and existing is not None:
            await self.session.execute(
                delete(PageLike).where(PageLike.page_id == page_id, PageLike.user_id == user_id)
            )
