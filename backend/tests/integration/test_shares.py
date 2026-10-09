"""Sharing a page with people, against real PostgreSQL.

Requires ``WIKIHUB_TEST_DATABASE_URL``; skipped otherwise.
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import PermissionDeniedError
from app.models.notification import Notification
from app.models.share import PageShare
from app.models.space import Space, SpaceVisibility
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.pages.service import PageService
from app.modules.shares.service import ShareService
from app.modules.spaces.service import SpaceService
from app.schemas.page import PageCreate
from app.schemas.share import ShareCreate
from app.schemas.space import SpaceCreate, SpaceUpdate
from app.schemas.user import UserCreate
from tests.integration.conftest import unique

pytestmark = pytest.mark.integration


async def _user(session: AsyncSession, name: str | None = None) -> User:
    username = name or unique("u")
    return await AuthService(session).create_user(
        UserCreate(
            username=username,
            email=f"{username}@example.org",
            full_name=f"Full {username}",
            password="password-1234",
        )
    )


async def _setup(session: AsyncSession) -> tuple[User, Space, str]:
    owner = await _user(session)
    space = await SpaceService(session).create(SpaceCreate(key="SHR", name="Shares"), owner)
    page = await PageService(session).create(
        space, PageCreate(title="Runbook", content="body"), owner
    )
    return owner, space, page.slug


async def _notes(session: AsyncSession, user: User) -> list[tuple[str, str | None]]:
    rows = await session.execute(
        select(Notification.kind, Notification.link).where(Notification.user_id == user.id)
    )
    return [(kind, link) for kind, link in rows.all()]


class TestSharing:
    async def test_tells_the_recipient_and_counts_the_share(self, session: AsyncSession) -> None:
        owner, _, slug = await _setup(session)
        alice = await _user(session)

        result = await ShareService(session, owner).share(
            "SHR", slug, ShareCreate(recipients=[f"@{alice.username.upper()}"])
        )

        assert result.shared == [alice.username]
        assert result.share_count == 1
        assert await _notes(session, alice) == [("page_shared", f"/spaces/SHR/pages/{slug}")]
        note = await session.scalar(select(Notification).where(Notification.user_id == alice.id))
        assert note is not None
        assert note.params == {"title": "Runbook", "space": "SHR"}

    async def test_people_without_access_are_reported_not_told_or_counted(
        self, session: AsyncSession
    ) -> None:
        owner, space, slug = await _setup(session)
        await SpaceService(session).update(
            space, SpaceUpdate(visibility=SpaceVisibility.restricted), owner
        )
        outsider = await _user(session)

        result = await ShareService(session, owner).share(
            "SHR", slug, ShareCreate(recipients=[outsider.username])
        )

        assert result.no_access == [outsider.username]
        assert result.shared == []
        assert result.share_count == 0
        assert await _notes(session, outsider) == []

    async def test_unknown_inactive_and_self_are_not_found(self, session: AsyncSession) -> None:
        owner, _, slug = await _setup(session)
        gone = await _user(session)
        gone.is_active = False
        await session.flush()

        result = await ShareService(session, owner).share(
            "SHR", slug, ShareCreate(recipients=["nobody-here", gone.username, owner.username])
        )

        assert result.not_found == ["nobody-here", gone.username.lower(), owner.username.lower()]
        assert result.share_count == 0

    async def test_each_share_counts_and_duplicates_in_one_request_do_not(
        self, session: AsyncSession
    ) -> None:
        owner, _, slug = await _setup(session)
        alice, bob = await _user(session), await _user(session)
        service = ShareService(session, owner)

        first = await service.share(
            "SHR", slug, ShareCreate(recipients=[alice.username, alice.username, bob.username])
        )
        again = await service.share("SHR", slug, ShareCreate(recipients=[alice.username]))

        assert first.share_count == 2
        assert again.share_count == 3
        assert (await ShareService(session, bob).summary("SHR", slug)).share_count == 3

    async def test_a_page_is_shared_only_by_someone_who_can_see_it(
        self, session: AsyncSession
    ) -> None:
        owner, space, slug = await _setup(session)
        await SpaceService(session).update(
            space, SpaceUpdate(visibility=SpaceVisibility.restricted), owner
        )
        stranger = await _user(session)

        with pytest.raises(PermissionDeniedError):
            await ShareService(session, stranger).share(
                "SHR", slug, ShareCreate(recipients=[owner.username])
            )
        with pytest.raises(PermissionDeniedError):
            await ShareService(session, stranger).summary("SHR", slug)

    async def test_deleting_the_recipient_removes_their_shares(
        self, session: AsyncSession
    ) -> None:
        owner, _, slug = await _setup(session)
        alice = await _user(session)
        await ShareService(session, owner).share("SHR", slug, ShareCreate(recipients=[alice.username]))

        await session.delete(alice)
        await session.flush()

        total = await session.scalar(select(func.count()).select_from(PageShare))
        assert total == 0


class TestCandidates:
    async def test_offers_people_flagged_by_access_and_never_the_sharer(
        self, session: AsyncSession
    ) -> None:
        owner, space, slug = await _setup(session)
        await SpaceService(session).update(
            space, SpaceUpdate(visibility=SpaceVisibility.restricted), owner
        )
        prefix = unique("pick")
        outsider = await _user(session, f"{prefix}a")

        found = await ShareService(session, owner).candidates("SHR", slug, prefix)
        mine = await ShareService(session, owner).candidates("SHR", slug, owner.username)

        assert [(person.username, person.can_view) for person in found] == [
            (outsider.username, False)
        ]
        assert mine == []

    async def test_underscores_and_percents_match_literally(self, session: AsyncSession) -> None:
        owner, _, slug = await _setup(session)
        prefix = unique("lit")
        target = await _user(session, f"{prefix}_b")
        await _user(session, f"{prefix}xb")  # would match if "_" were a wildcard

        found = await ShareService(session, owner).candidates("SHR", slug, f"{prefix}_b")
        none = await ShareService(session, owner).candidates("SHR", slug, f"{prefix}%")

        assert [person.username for person in found] == [target.username]
        assert none == []
