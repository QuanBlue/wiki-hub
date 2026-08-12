"""Page business rules."""

from __future__ import annotations

import re
import uuid
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError, NotFoundError, PermissionDeniedError
from app.core.logging import get_logger
from app.models.page import WikiPage
from app.models.space import Space, SpaceRole, SpaceStatus
from app.models.user import User
from app.modules.spaces.service import SpaceService
from app.repositories.page import PageRepository
from app.schemas.page import PageCreate, PageLikeRead, PageMove, PageRead, PageUpdate

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
            parent_id=page.parent_id,
            title=page.title,
            slug=page.slug,
            content=page.content,
            content_format=page.content_format,
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

    async def like_status(self, page: WikiPage, user: User) -> PageLikeRead:
        return PageLikeRead(
            liked_by_me=await self.pages.is_liked(page.id, user.id),
            like_count=await self.pages.like_count(page.id),
        )

    async def set_like(self, page: WikiPage, user: User, liked: bool) -> PageLikeRead:
        await self.pages.set_like(page.id, user.id, liked)
        await self.session.flush()
        return await self.like_status(page, user)

    async def create(self, space: Space, payload: PageCreate, creator: User) -> WikiPage:
        await self.require_editor(space, creator)
        title = payload.title.strip()
        if payload.parent_id is not None:
            parent = await self.pages.get(payload.parent_id)
            if parent is None or parent.space_id != space.id:
                raise NotFoundError("Parent page not found.")
        slug = await self.unique_slug(space, title)
        page = WikiPage(
            space_id=space.id,
            parent_id=payload.parent_id,
            title=title,
            slug=slug,
            content=payload.content.strip(),
            content_format=payload.content_format,
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
        if data.get("content_format") is not None:
            page.content_format = str(data["content_format"])
        page.updated_by_id = user.id
        await self.session.flush()
        await self.session.refresh(page)
        logger.info("page_updated", space_key=space.key, slug=page.slug, by=user.username)
        return page

    async def move(
        self, space: Space, page: WikiPage, payload: PageMove, user: User
    ) -> WikiPage:
        await self.require_editor(space, user)
        destination = await self.spaces.get_by_key(payload.destination_space_key)
        if destination.status is not SpaceStatus.active:
            raise BadRequestError("Pages can only be moved to an active space.")
        await self.require_editor(destination, user)

        source_pages = await self.pages.list_all_for_space(space.id)
        children_by_parent: dict[uuid.UUID, list[WikiPage]] = {}
        for candidate in source_pages:
            if candidate.parent_id is not None:
                children_by_parent.setdefault(candidate.parent_id, []).append(candidate)

        subtree: list[WikiPage] = []
        pending = [page]
        seen: set[uuid.UUID] = set()
        while pending:
            candidate = pending.pop()
            if candidate.id in seen:
                continue
            seen.add(candidate.id)
            subtree.append(candidate)
            pending.extend(children_by_parent.get(candidate.id, []))

        if payload.parent_id is not None:
            parent = await self.pages.get(payload.parent_id)
            if parent is None or parent.space_id != destination.id:
                raise NotFoundError("Destination parent page not found.")
            if parent.id in seen:
                raise BadRequestError("A page cannot be moved into itself or one of its children.")

        destination_pages = await self.pages.list_all_for_space(destination.id)
        occupied_slugs = {
            candidate.slug for candidate in destination_pages if candidate.id not in seen
        }
        for candidate in subtree:
            candidate.space_id = destination.id
            candidate.updated_by_id = user.id
            candidate.slug = self.unique_slug_from_occupied(candidate.slug, occupied_slugs)
            occupied_slugs.add(candidate.slug)
        page.parent_id = payload.parent_id

        await self.session.flush()
        await self.session.refresh(page)
        logger.info(
            "page_moved",
            source_space_key=space.key,
            destination_space_key=destination.key,
            slug=page.slug,
            descendants=len(subtree) - 1,
            by=user.username,
        )
        return page

    async def delete(self, space: Space, page: WikiPage, user: User) -> int:
        """Delete one page while preserving its direct child pages.

        Moving children to the deleted page's parent avoids silently deleting a
        branch of documentation when an editor only intended to remove one
        page. Root children remain root pages.
        """
        await self.require_editor(space, user)
        children = await self.pages.list_children(page.id)
        for child in children:
            child.parent_id = page.parent_id
            child.updated_by_id = user.id

        moved_children = len(children)
        await self.pages.delete(page)
        await self.session.flush()
        logger.info(
            "page_deleted",
            space_key=space.key,
            slug=page.slug,
            moved_children=moved_children,
            by=user.username,
        )
        return moved_children

    async def unique_slug(self, space: Space, title: str) -> str:
        base = SLUG_CHARS.sub("-", title.strip().lower()).strip("-") or "page"
        slug = base[:240].strip("-") or "page"
        candidate = slug
        suffix = 2
        while await self.pages.slug_exists(space.id, candidate):
            candidate = f"{slug}-{suffix}"
            suffix += 1
        return candidate

    @staticmethod
    def unique_slug_from_occupied(slug: str, occupied: set[str]) -> str:
        candidate = slug
        suffix = 2
        while candidate in occupied:
            candidate = f"{slug[:240].strip('-') or 'page'}-{suffix}"
            suffix += 1
        return candidate
