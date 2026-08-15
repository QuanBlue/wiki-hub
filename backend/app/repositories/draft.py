"""Data access for private page drafts."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.draft import PageDraft


class PageDraftRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, page_id: uuid.UUID, user_id: uuid.UUID) -> PageDraft | None:
        stmt = select(PageDraft).where(
            PageDraft.page_id == page_id,
            PageDraft.user_id == user_id,
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    def add(self, draft: PageDraft) -> PageDraft:
        self.session.add(draft)
        return draft

    async def delete(self, draft: PageDraft) -> None:
        await self.session.delete(draft)
