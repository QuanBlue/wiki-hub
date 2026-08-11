"""Page rules against a real PostgreSQL database."""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import PermissionDeniedError
from app.models.space import SpaceRole
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.pages.service import PageService
from app.modules.spaces.service import SpaceService
from app.schemas.page import PageCreate
from app.schemas.space import SpaceCreate
from app.schemas.user import UserCreate

pytestmark = pytest.mark.integration

TEST_DB_URL = os.environ.get("WIKIHUB_TEST_DATABASE_URL")


def _uniq(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


async def _make_user(session: AsyncSession) -> User:
    return await AuthService(session).create_user(
        UserCreate(
            username=_uniq("u"),
            email=f"{_uniq('u')}@example.com",
            full_name="Test User",
            password="password-1234",
            is_superuser=False,
        )
    )


class TestCreatePage:
    async def test_space_admin_can_create_and_read_pages(self, session: AsyncSession) -> None:
        owner = await _make_user(session)
        space = await SpaceService(session).create(
            SpaceCreate(key="ENG", name="Engineering"), owner
        )
        service = PageService(session)

        page = await service.create(
            space,
            PageCreate(title="On-call Runbook", content="Escalate incidents here."),
            owner,
        )

        assert page.slug == "on-call-runbook"
        assert [item.title for item in await service.list_for_space(space)] == ["On-call Runbook"]
        assert (await service.get_by_slug(space, "on-call-runbook")).content == (
            "Escalate incidents here."
        )

    async def test_duplicate_titles_get_unique_slugs(self, session: AsyncSession) -> None:
        owner = await _make_user(session)
        space = await SpaceService(session).create(
            SpaceCreate(key="ENG", name="Engineering"), owner
        )
        service = PageService(session)

        first = await service.create(space, PageCreate(title="Release Notes"), owner)
        second = await service.create(space, PageCreate(title="Release Notes"), owner)

        assert first.slug == "release-notes"
        assert second.slug == "release-notes-2"

    async def test_viewer_cannot_create_page(self, session: AsyncSession) -> None:
        owner = await _make_user(session)
        viewer = await _make_user(session)
        space_service = SpaceService(session)
        space = await space_service.create(SpaceCreate(key="ENG", name="Engineering"), owner)
        await space_service.set_member(space, owner, viewer.id, SpaceRole.viewer)

        with pytest.raises(PermissionDeniedError):
            await PageService(session).create(space, PageCreate(title="Nope"), viewer)
