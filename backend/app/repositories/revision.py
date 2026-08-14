"""Data access repository for page revisions."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.revision import PageRevision


class PageRevisionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_for_page(self, page_id: uuid.UUID) -> Sequence[PageRevision]:
        stmt = (
            select(PageRevision)
            .where(PageRevision.page_id == page_id)
            .options(selectinload(PageRevision.created_by))
            .order_by(PageRevision.version.desc())
        )
        return (await self.session.execute(stmt)).scalars().unique().all()

    async def get_by_version(self, page_id: uuid.UUID, version: int) -> PageRevision | None:
        stmt = (
            select(PageRevision)
            .where(PageRevision.page_id == page_id, PageRevision.version == version)
            .options(selectinload(PageRevision.created_by))
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_max_version(self, page_id: uuid.UUID) -> int:
        stmt = select(func.max(PageRevision.version)).where(PageRevision.page_id == page_id)
        res = (await self.session.execute(stmt)).scalar_one_or_none()
        return int(res) if res is not None else 0

    def add(self, revision: PageRevision) -> PageRevision:
        self.session.add(revision)
        return revision
