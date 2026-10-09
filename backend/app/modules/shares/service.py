"""Sharing a page with people: who may receive it, who is told, and the share count."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.page import WikiPage
from app.models.share import PageShare
from app.models.space import Space
from app.models.user import User
from app.modules.notifications.service import notify
from app.modules.pages.people import people_for_page
from app.modules.pages.service import PageService
from app.modules.spaces.service import SpaceService
from app.schemas.comment import MentionCandidate
from app.schemas.share import ShareCreate, ShareResult, ShareSummary


class ShareService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user
        self.spaces = SpaceService(session)
        self.pages = PageService(session)

    async def _resolve(self, key: str, slug: str) -> tuple[Space, WikiPage]:
        """Only someone who can see the page may share it or see its count."""
        space = await self.spaces.get_by_key(key)
        await self.spaces.require_view(space, self.user)
        page = await self.pages.get_by_slug(space, slug)
        await self.pages.require_page_view(page, self.user)
        return space, page

    async def _count(self, page: WikiPage) -> int:
        return int(
            await self.session.scalar(
                select(func.count()).select_from(PageShare).where(PageShare.page_id == page.id)
            )
            or 0
        )

    async def summary(self, key: str, slug: str) -> ShareSummary:
        _, page = await self._resolve(key, slug)
        return ShareSummary(share_count=await self._count(page))

    async def candidates(self, key: str, slug: str, query: str) -> list[MentionCandidate]:
        """People to offer in the share picker - never the sharer themselves."""
        _, page = await self._resolve(key, slug)
        return await people_for_page(
            self.session, self.spaces.permissions, page, query, exclude=self.user.id
        )

    async def share(self, key: str, slug: str, payload: ShareCreate) -> ShareResult:
        """Tell each recipient who can open the page, and count one share each.

        Access is never widened: someone who cannot open the page is reported
        back in ``no_access`` - nothing is recorded for them and they are not
        told the page exists.
        """
        space, page = await self._resolve(key, slug)
        names = list(dict.fromkeys(name.strip().lstrip("@").lower() for name in payload.recipients))
        found = {
            person.username.lower(): person
            for person in await self.session.scalars(
                select(User).where(
                    func.lower(User.username).in_(names),
                    User.is_active.is_(True),
                    User.id != self.user.id,
                )
            )
        }
        shared: list[str] = []
        no_access: list[str] = []
        not_found: list[str] = []
        for name in names:
            person = found.get(name)
            if person is None:
                not_found.append(name)
            elif not await self.spaces.permissions.can_view_page(page, person):
                no_access.append(person.username)
            else:
                self.session.add(
                    PageShare(page_id=page.id, shared_by_id=self.user.id, recipient_id=person.id)
                )
                await notify(
                    self.session,
                    person.id,
                    "page_shared",
                    params={"title": page.title, "space": space.key},
                    link=f"/spaces/{space.key}/pages/{page.slug}",
                    actor=self.user,
                )
                shared.append(person.username)
        await self.session.flush()
        return ShareResult(
            share_count=await self._count(page),
            shared=shared,
            no_access=no_access,
            not_found=not_found,
        )
