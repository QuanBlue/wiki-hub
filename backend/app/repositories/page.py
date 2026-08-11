"""Data access for wiki pages."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.page import WikiPage


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

    def add(self, page: WikiPage) -> WikiPage:
        self.session.add(page)
        return page
