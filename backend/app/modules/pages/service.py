"""Page business rules."""

from __future__ import annotations

import re
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, PermissionDeniedError
from app.core.logging import get_logger
from app.models.page import WikiPage
from app.models.space import Space, SpaceRole
from app.models.user import User
from app.modules.spaces.service import SpaceService
from app.repositories.page import PageRepository
from app.schemas.page import PageCreate, PageRead, PageUpdate

logger = get_logger(__name__)


SLUG_CHARS = re.compile(r"[^a-z0-9]+")


class PageService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.pages = PageRepository(session)
        self.spaces = SpaceService(session)

    async def require_editor(self, space: Space, user: User) -> None:
        if user.is_superuser:
            return
        role = await self.spaces.role_of(space, user)
        if role is None or role.rank < SpaceRole.editor.rank:
            raise PermissionDeniedError("You need editor access in this space to create pages.")

    def to_read(self, page: WikiPage) -> PageRead:
        return PageRead(
            id=page.id,
            space_id=page.space_id,
            title=page.title,
            slug=page.slug,
            content=page.content,
            created_at=page.created_at,
            updated_at=page.updated_at,
            created_by_username=page.created_by.username if page.created_by else None,
            updated_by_username=page.updated_by.username if page.updated_by else None,
        )

    def to_read_many(self, pages: Sequence[WikiPage]) -> list[PageRead]:
        return [self.to_read(page) for page in pages]

    async def list_for_space(
        self, space: Space, *, limit: int = 100, offset: int = 0
    ) -> list[PageRead]:
        return self.to_read_many(
            await self.pages.list_for_space(space.id, limit=limit, offset=offset)
        )

    async def get_by_slug(self, space: Space, slug: str) -> WikiPage:
        page = await self.pages.get_by_slug(space.id, slug)
        if page is None:
            raise NotFoundError("Page not found.")
        return page

    async def create(self, space: Space, payload: PageCreate, creator: User) -> WikiPage:
        await self.require_editor(space, creator)
        title = payload.title.strip()
        slug = await self.unique_slug(space, title)
        page = WikiPage(
            space_id=space.id,
            title=title,
            slug=slug,
            content=payload.content.strip(),
            created_by_id=creator.id,
            updated_by_id=creator.id,
        )
        self.pages.add(page)
        await self.session.flush()
        await self.session.refresh(page)
        logger.info("page_created", space_key=space.key, slug=page.slug, by=creator.username)
        return page

    async def update(
        self, space: Space, page: WikiPage, payload: PageUpdate, user: User
    ) -> WikiPage:
        await self.require_editor(space, user)
        data = payload.model_dump(exclude_unset=True)
        if data.get("title") is not None:
            page.title = str(data["title"]).strip()
        if data.get("content") is not None:
            page.content = str(data["content"]).strip()
        page.updated_by_id = user.id
        await self.session.flush()
        await self.session.refresh(page)
        logger.info("page_updated", space_key=space.key, slug=page.slug, by=user.username)
        return page

    async def unique_slug(self, space: Space, title: str) -> str:
        base = SLUG_CHARS.sub("-", title.strip().lower()).strip("-") or "page"
        slug = base[:240].strip("-") or "page"
        candidate = slug
        suffix = 2
        while await self.pages.slug_exists(space.id, candidate):
            candidate = f"{slug}-{suffix}"
            suffix += 1
        return candidate
