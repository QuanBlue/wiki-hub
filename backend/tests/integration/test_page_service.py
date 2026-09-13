"""Page rules against a real PostgreSQL database."""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError, NotFoundError, PermissionDeniedError
from app.models.space import SpaceRole, SpaceVisibility
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.pages.service import PageService
from app.modules.spaces.service import SpaceService
from app.schemas.page import PageCreate, PageMove, PageUpdate
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
        assert {item.title for item in await service.list_for_space(space)} == {
            "Engineering",
            "On-call Runbook",
        }
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
        # Restricted, not the SpaceCreate default of Open - Open now hands
        # everyone Add automatically (OPEN_SPACE_PERMISSIONS), so a viewer
        # role would not actually be blocked there.
        owner = await _make_user(session)
        viewer = await _make_user(session)
        space_service = SpaceService(session)
        space = await space_service.create(
            SpaceCreate(key="ENG", name="Engineering", visibility=SpaceVisibility.restricted), owner
        )
        await space_service.set_member(space, owner, viewer.id, SpaceRole.viewer)

        with pytest.raises(PermissionDeniedError):
            await PageService(session).create(space, PageCreate(title="Nope"), viewer)

    async def test_child_page_is_linked_to_its_parent(self, session: AsyncSession) -> None:
        owner = await _make_user(session)
        space = await SpaceService(session).create(
            SpaceCreate(key="ENG", name="Engineering"), owner
        )
        service = PageService(session)
        parent = await service.create(space, PageCreate(title="Runbooks"), owner)

        child = await service.create(
            space,
            PageCreate(title="On-call", parent_id=parent.id),
            owner,
        )

        assert child.parent_id == parent.id
        listed = await service.list_for_space(space)
        assert next(item for item in listed if item.title == "On-call").parent_id == parent.id
        assert next(item for item in listed if item.title == "Runbooks").parent_id is None

    async def test_parent_must_belong_to_the_same_space(self, session: AsyncSession) -> None:
        owner = await _make_user(session)
        spaces = SpaceService(session)
        engineering = await spaces.create(SpaceCreate(key="ENG", name="Engineering"), owner)
        product = await spaces.create(SpaceCreate(key="PROD", name="Product"), owner)
        service = PageService(session)
        foreign_parent = await service.create(product, PageCreate(title="Roadmap"), owner)

        with pytest.raises(NotFoundError, match="Parent page not found"):
            await service.create(
                engineering,
                PageCreate(title="Invalid child", parent_id=foreign_parent.id),
                owner,
            )

    async def test_move_transfers_a_page_subtree_to_another_space(
        self, session: AsyncSession
    ) -> None:
        owner = await _make_user(session)
        spaces = SpaceService(session)
        engineering = await spaces.create(SpaceCreate(key="ENG", name="Engineering"), owner)
        product = await spaces.create(SpaceCreate(key="PROD", name="Product"), owner)
        service = PageService(session)
        parent = await service.create(engineering, PageCreate(title="Runbooks"), owner)
        child = await service.create(
            engineering, PageCreate(title="On-call", parent_id=parent.id), owner
        )

        moved = await service.move(
            engineering,
            parent,
            PageMove(destination_space_key=product.key),
            owner,
        )

        assert moved.space_id == product.id
        assert moved.parent_id is None
        assert child.space_id == product.id
        assert child.parent_id == moved.id

    async def test_move_cannot_make_a_page_its_own_descendant(self, session: AsyncSession) -> None:
        owner = await _make_user(session)
        space = await SpaceService(session).create(
            SpaceCreate(key="ENG", name="Engineering"), owner
        )
        service = PageService(session)
        parent = await service.create(space, PageCreate(title="Runbooks"), owner)
        child = await service.create(space, PageCreate(title="On-call", parent_id=parent.id), owner)

        with pytest.raises(BadRequestError, match="cannot be moved"):
            await service.move(
                space,
                parent,
                PageMove(destination_space_key=space.key, parent_id=child.id),
                owner,
            )


class TestUpdatePage:
    async def test_space_editor_can_update_page_title_and_content(
        self, session: AsyncSession
    ) -> None:
        owner = await _make_user(session)
        editor = await _make_user(session)
        spaces = SpaceService(session)
        space = await spaces.create(SpaceCreate(key="ENG", name="Engineering"), owner)
        await spaces.set_member(space, owner, editor.id, SpaceRole.editor)
        service = PageService(session)
        page = await service.create(space, PageCreate(title="Draft", content="Before"), owner)

        updated = await service.update(
            space,
            page,
            PageUpdate(title="Runbook", content="After"),
            editor,
        )

        assert updated.title == "Runbook"
        assert updated.content == "After"
        assert updated.updated_by_id == editor.id

    async def test_page_content_format_is_saved_with_its_source(
        self, session: AsyncSession
    ) -> None:
        owner = await _make_user(session)
        space = await SpaceService(session).create(
            SpaceCreate(key="ENG", name="Engineering"), owner
        )
        service = PageService(session)
        page = await service.create(
            space,
            PageCreate(title="Runbook", content="# On-call", content_format="markdown"),
            owner,
        )

        assert page.content == "# On-call"
        assert page.content_format == "markdown"
        assert service.to_read(page).content_format == "markdown"

    async def test_viewer_cannot_update_a_page(self, session: AsyncSession) -> None:
        # Restricted - see test_viewer_cannot_create_page.
        owner = await _make_user(session)
        viewer = await _make_user(session)
        spaces = SpaceService(session)
        space = await spaces.create(
            SpaceCreate(key="ENG", name="Engineering", visibility=SpaceVisibility.restricted), owner
        )
        await spaces.set_member(space, owner, viewer.id, SpaceRole.viewer)
        service = PageService(session)
        page = await service.create(space, PageCreate(title="Draft"), owner)

        with pytest.raises(PermissionDeniedError):
            await service.update(space, page, PageUpdate(content="Nope"), viewer)


class TestDeletePage:
    async def test_editor_cannot_delete_another_users_page(self, session: AsyncSession) -> None:
        # Restricted, not the SpaceCreate default of Open - Open now hands
        # everyone full `delete` automatically (OPEN_SPACE_PERMISSIONS), so
        # an editor role's narrower access would not be the binding
        # constraint there.
        owner = await _make_user(session)
        editor = await _make_user(session)
        spaces = SpaceService(session)
        space = await spaces.create(
            SpaceCreate(key="ENG", name="Engineering", visibility=SpaceVisibility.restricted), owner
        )
        await spaces.set_member(space, owner, editor.id, SpaceRole.editor)
        service = PageService(session)
        grandparent = await service.create(space, PageCreate(title="Runbooks"), owner)
        parent = await service.create(
            space, PageCreate(title="On-call", parent_id=grandparent.id), owner
        )
        child = await service.create(
            space, PageCreate(title="Escalation", parent_id=parent.id), owner
        )

        with pytest.raises(PermissionDeniedError):
            await service.delete(space, parent, editor)

        assert await service.pages.get(parent.id) is not None
        assert child.parent_id == parent.id

    async def test_viewer_cannot_delete_a_page(self, session: AsyncSession) -> None:
        # Restricted - see test_viewer_cannot_create_page.
        owner = await _make_user(session)
        viewer = await _make_user(session)
        spaces = SpaceService(session)
        space = await spaces.create(
            SpaceCreate(key="ENG", name="Engineering", visibility=SpaceVisibility.restricted), owner
        )
        await spaces.set_member(space, owner, viewer.id, SpaceRole.viewer)
        service = PageService(session)
        page = await service.create(space, PageCreate(title="Draft"), owner)

        with pytest.raises(PermissionDeniedError):
            await service.delete(space, page, viewer)
