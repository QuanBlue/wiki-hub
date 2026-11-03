"""Sharing a page with people: who may receive it, who is told, and the share count."""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AuthenticationError, NotFoundError, PermissionDeniedError
from app.core.security import hash_password, verify_password
from app.models.page import WikiPage
from app.models.share import PageShare, PublicPageShare
from app.models.space import Space, SpaceStatus
from app.models.user import User
from app.modules.notifications.service import notify
from app.modules.pages.people import people_for_page
from app.modules.pages.service import PageService
from app.modules.spaces.service import SpaceService
from app.schemas.comment import MentionCandidate
from app.schemas.share import (
    PublicShareCreate,
    PublicShareItem,
    PublicShareListResponse,
    PublicShareUpdate,
    PublicShareView,
    ShareCreate,
    ShareResult,
    ShareSummary,
)
from app.services.site_settings import SiteSettingsService


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

    async def list_public_shares(self, key: str, slug: str) -> PublicShareListResponse:
        """List active public share links for this page."""
        _, page = await self._resolve(key, slug)
        effective = await SiteSettingsService(self.session).get_effective()
        now = datetime.now(UTC)

        shares = (
            await self.session.scalars(
                select(PublicPageShare)
                .where(PublicPageShare.page_id == page.id, PublicPageShare.is_active.is_(True))
                .order_by(PublicPageShare.created_at.desc())
            )
        ).all()

        items = [
            PublicShareItem(
                id=s.id,
                token=s.token,
                page_id=s.page_id,
                created_at=s.created_at,
                expires_at=s.expires_at,
                has_password=bool(s.password_hash),
                view_count=s.view_count,
                is_active=s.is_active,
                is_expired=bool(s.expires_at and s.expires_at < now),
                share_url=f"/share/{s.token}",
            )
            for s in shares
        ]
        return PublicShareListResponse(enabled=effective.public_shares_enabled, shares=items)

    async def create_public_share(
        self, key: str, slug: str, payload: PublicShareCreate
    ) -> PublicShareItem:
        """Create a new public read-only link with optional expiration and password."""
        _, page = await self._resolve(key, slug)
        effective = await SiteSettingsService(self.session).get_effective()
        if not effective.public_shares_enabled:
            raise PermissionDeniedError(
                "Public link sharing is disabled by system administrator."
            )

        now = datetime.now(UTC)
        expires_at = None
        if payload.expires_in_days is not None and payload.expires_in_days > 0:
            expires_at = now + timedelta(days=payload.expires_in_days)

        password_hash = None
        if payload.password and payload.password.strip():
            password_hash = hash_password(payload.password.strip())

        token = secrets.token_urlsafe(32)
        share = PublicPageShare(
            id=uuid.uuid4(),
            page_id=page.id,
            token=token,
            created_by_id=self.user.id,
            created_at=now,
            expires_at=expires_at,
            password_hash=password_hash,
            view_count=0,
            is_active=True,
        )
        self.session.add(share)
        await self.session.flush()

        return PublicShareItem(
            id=share.id,
            token=share.token,
            page_id=share.page_id,
            created_at=share.created_at,
            expires_at=share.expires_at,
            has_password=bool(share.password_hash),
            view_count=share.view_count,
            is_active=share.is_active,
            is_expired=False,
            share_url=f"/share/{share.token}",
        )

    async def update_public_share(
        self, key: str, slug: str, share_id: uuid.UUID, payload: PublicShareUpdate
    ) -> PublicShareItem:
        """Update an existing public share link (expiration or password)."""
        _, page = await self._resolve(key, slug)
        effective = await SiteSettingsService(self.session).get_effective()
        if not effective.public_shares_enabled:
            raise PermissionDeniedError(
                "Public link sharing is disabled by system administrator."
            )

        share = (
            await self.session.scalars(
                select(PublicPageShare).where(
                    PublicPageShare.id == share_id,
                    PublicPageShare.page_id == page.id,
                    PublicPageShare.is_active.is_(True),
                )
            )
        ).first()
        if share is None:
            raise NotFoundError("Share link not found or has been revoked.")

        now = datetime.now(UTC)
        if payload.clear_expiration:
            share.expires_at = None
        elif payload.expires_in_days is not None:
            share.expires_at = now + timedelta(days=payload.expires_in_days)

        if payload.clear_password:
            share.password_hash = None
        elif payload.password and payload.password.strip():
            share.password_hash = hash_password(payload.password.strip())

        await self.session.flush()

        return PublicShareItem(
            id=share.id,
            token=share.token,
            page_id=share.page_id,
            created_at=share.created_at,
            expires_at=share.expires_at,
            has_password=bool(share.password_hash),
            view_count=share.view_count,
            is_active=share.is_active,
            is_expired=bool(share.expires_at and share.expires_at < now),
            share_url=f"/share/{share.token}",
        )

    async def revoke_public_share(self, key: str, slug: str, share_id: uuid.UUID) -> None:
        """Revoke a public share link."""
        _, page = await self._resolve(key, slug)
        share = (
            await self.session.scalars(
                select(PublicPageShare).where(
                    PublicPageShare.id == share_id,
                    PublicPageShare.page_id == page.id,
                )
            )
        ).first()
        if share is None:
            raise NotFoundError("Share link not found.")
        share.is_active = False
        await self.session.flush()


class PublicShareService:
    """Handles external, unauthenticated access to shared pages via tokens."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_share(self, token: str, password: str | None = None) -> PublicShareView:
        effective = await SiteSettingsService(self.session).get_effective()
        if not effective.public_shares_enabled:
            raise PermissionDeniedError("Public link sharing is disabled on this system.")

        share = (
            await self.session.scalars(
                select(PublicPageShare).where(
                    PublicPageShare.token == token,
                    PublicPageShare.is_active.is_(True),
                )
            )
        ).first()
        if share is None:
            raise NotFoundError("This share link does not exist or has been revoked.")

        now = datetime.now(UTC)
        if share.expires_at and share.expires_at < now:
            raise NotFoundError("This share link has expired.")

        page = await self.session.get(WikiPage, share.page_id)
        if page is None or page.deleted_at is not None:
            raise NotFoundError("The shared page is no longer available.")

        space = await self.session.get(Space, page.space_id)
        if space is None or space.status != SpaceStatus.active:
            raise NotFoundError("The shared space is no longer available.")

        has_password = bool(share.password_hash)
        if has_password:
            if not password:
                return PublicShareView(
                    title=page.title,
                    content_html="",
                    space_key=space.key,
                    space_name=space.name,
                    created_at=page.created_at,
                    updated_at=page.updated_at,
                    expires_at=share.expires_at,
                    has_password=True,
                    is_password_verified=False,
                    view_count=share.view_count,
                )
            if not verify_password(password, share.password_hash):
                raise AuthenticationError("Incorrect password for this document.")

        share.view_count += 1
        await self.session.flush()

        return PublicShareView(
            title=page.title,
            content_html=page.content,
            space_key=space.key,
            space_name=space.name,
            created_at=page.created_at,
            updated_at=page.updated_at,
            expires_at=share.expires_at,
            has_password=has_password,
            is_password_verified=True,
            view_count=share.view_count,
        )

