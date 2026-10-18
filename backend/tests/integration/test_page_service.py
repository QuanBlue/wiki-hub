"""Page rules against a real PostgreSQL database."""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError, NotFoundError, PermissionDeniedError
from app.models.page import WikiPage
from app.models.permission import Permission
from app.models.revision import PageRevision
from app.models.space import SpaceRole, SpaceVisibility
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.pages.service import PageService
from app.modules.permissions.service import PermissionService
from app.modules.search.service import SearchService
from app.modules.spaces.service import SpaceService
from app.services.site_settings import SiteSettingsService
from app.schemas.page import PageCreate, PageMove, PageUpdate
from app.schemas.site_settings import SiteSettingsUpdate
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
            await service.trash(space, parent, editor)

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
            await service.trash(space, page, viewer)


class TestTrash:
    async def test_a_deleted_page_leaves_everywhere_but_keeps_its_history(
        self, session: AsyncSession
    ) -> None:
        owner = await _make_user(session)
        space = await SpaceService(session).create(
            SpaceCreate(key="ENG", name="Engineering"), owner
        )
        service = PageService(session)
        parent = await service.create(space, PageCreate(title="Runbooks"), owner)
        page = await service.create(
            space,
            PageCreate(title="Escalation", content="Page the on-call.", parent_id=parent.id),
            owner,
        )
        child = await service.create(space, PageCreate(title="Pager", parent_id=page.id), owner)
        await service.update(space, page, PageUpdate(content="Page the on-call engineer."), owner)

        result = await service.trash(space, page, owner)

        assert result.moved_children == 1
        assert child.parent_id == parent.id
        with pytest.raises(NotFoundError):
            await service.get_by_slug(space, "escalation")
        assert await service.pages.get(page.id) is None
        assert "Escalation" not in {item.title for item in await service.list_for_space(space)}
        found = await SearchService(session).search("Escalation", owner)
        assert all(hit.id != page.id for hit in found.pages)
        # Revisions are untouched, ready for a restore.
        revisions = (
            await session.execute(
                select(func.count())
                .select_from(PageRevision)
                .where(PageRevision.page_id == page.id)
            )
        ).scalar_one()
        assert revisions >= 1

        listing = await service.list_trash(space, owner)
        assert [item.id for item in listing.items] == [page.id]
        assert listing.items[0].parent_title == "Runbooks"
        assert listing.can_purge is True

        restored = await service.restore(space, page.id, owner)
        assert restored.restored_to_parent is True
        back = await service.get_by_slug(space, "escalation")
        assert back.parent_id == parent.id
        assert (await service.list_trash(space, owner)).items == []

    async def test_a_trashed_page_keeps_its_slug_and_a_lost_parent_sends_it_to_the_top(
        self, session: AsyncSession
    ) -> None:
        owner = await _make_user(session)
        space = await SpaceService(session).create(
            SpaceCreate(key="ENG", name="Engineering"), owner
        )
        service = PageService(session)
        parent = await service.create(space, PageCreate(title="Guides"), owner)
        page = await service.create(space, PageCreate(title="Runbook", parent_id=parent.id), owner)
        await service.trash(space, page, owner)

        # The name is free to reuse, the slug is not: it waits for the restore.
        again = await service.create(space, PageCreate(title="Runbook"), owner)
        assert again.slug == "runbook-2"

        await service.trash(space, parent, owner)
        restored = await service.restore(space, page.id, owner)
        assert restored.slug == "runbook"
        assert restored.restored_to_parent is False
        assert (await service.get_by_slug(space, "runbook")).parent_id is None

    async def test_delete_own_sees_only_its_own_pages_and_cannot_purge(
        self, session: AsyncSession
    ) -> None:
        owner = await _make_user(session)
        member = await _make_user(session)
        spaces = SpaceService(session)
        space = await spaces.create(
            SpaceCreate(key="ENG", name="Engineering", visibility=SpaceVisibility.restricted), owner
        )
        permissions = PermissionService(session)
        for permission in (Permission.view, Permission.add, Permission.delete_own):
            await permissions.set_space_permission(
                space, member.id, permission, owner, group=False, present=True
            )
        service = PageService(session)
        theirs = await service.create(space, PageCreate(title="Owner page"), owner)
        mine = await service.create(space, PageCreate(title="Member page"), member)
        await service.trash(space, theirs, owner)
        await service.trash(space, mine, member)

        listing = await service.list_trash(space, member)
        assert [item.id for item in listing.items] == [mine.id]
        assert listing.can_purge is False
        with pytest.raises(NotFoundError):
            await service.restore(space, theirs.id, member)
        with pytest.raises(PermissionDeniedError):
            await service.purge(space, mine.id, member)
        with pytest.raises(PermissionDeniedError):
            await service.empty_trash(space, member)

    async def test_the_administrators_period_decides_how_long_a_page_waits(
        self, session: AsyncSession
    ) -> None:
        owner = await _make_user(session)
        space = await SpaceService(session).create(
            SpaceCreate(key="ENG", name="Engineering"), owner
        )
        service = PageService(session)
        settings_service = SiteSettingsService(session, actor=owner)
        page = await service.create(space, PageCreate(title="Runbook"), owner)
        await service.trash(space, page, owner)

        # Nobody has chosen yet: the built-in 30 days.
        listing = await service.list_trash(space, owner)
        assert listing.retention_days == 30
        assert listing.items[0].purge_at == page.deleted_at + timedelta(days=30)

        # A page that has been in the Trash for 10 days survives 30, not 7.
        page.deleted_at = datetime.now(UTC) - timedelta(days=10)
        await session.flush()
        assert await service.purge_expired() == 0

        await settings_service.update(SiteSettingsUpdate(trash_retention_days=7))
        listing = await service.list_trash(space, owner)
        assert listing.retention_days == 7
        assert listing.items[0].purge_at == page.deleted_at + timedelta(days=7)
        assert (await settings_service.get_effective()).trash_retention_days == 7
        assert await service.purge_expired() == 1
        assert (await service.list_trash(space, owner)).items == []

        # Back to the default with an explicit null.
        await settings_service.update(SiteSettingsUpdate(trash_retention_days=None))
        assert (await settings_service.get_effective()).trash_retention_days == 30

    async def test_a_trashed_page_can_be_read_before_restoring_it(
        self, session: AsyncSession
    ) -> None:
        owner = await _make_user(session)
        stranger = await _make_user(session)
        spaces = SpaceService(session)
        space = await spaces.create(
            SpaceCreate(key="ENG", name="Engineering", visibility=SpaceVisibility.restricted), owner
        )
        service = PageService(session)
        page = await service.create(
            space, PageCreate(title="Runbook", content="<p>Page the on-call.</p>"), owner
        )
        await service.trash(space, page, owner)

        detail = await service.preview_trashed(space, page.id, owner)
        assert detail.content == "<p>Page the on-call.</p>"
        assert detail.title == "Runbook" and detail.deleted_by_username == owner.username

        # Someone with no standing in the space learns nothing about it - not even that it exists.
        with pytest.raises(NotFoundError):
            await service.preview_trashed(space, page.id, stranger)

        # Once restored it is an ordinary page again, not a Trash entry.
        await service.restore(space, page.id, owner)
        with pytest.raises(NotFoundError):
            await service.preview_trashed(space, page.id, owner)

    async def test_purging_removes_a_page_for_good(self, session: AsyncSession) -> None:
        owner = await _make_user(session)
        space = await SpaceService(session).create(
            SpaceCreate(key="ENG", name="Engineering"), owner
        )
        service = PageService(session)
        first = await service.create(space, PageCreate(title="First"), owner)
        second = await service.create(space, PageCreate(title="Second"), owner)
        third = await service.create(space, PageCreate(title="Third"), owner)
        for page in (first, second, third):
            await service.trash(space, page, owner)

        await service.purge(space, first.id, owner)
        assert [item.id for item in (await service.list_trash(space, owner)).items] == [
            third.id,
            second.id,
        ]
        with pytest.raises(NotFoundError):
            await service.restore(space, first.id, owner)

        # Only pages past the retention period go on their own.
        second.deleted_at = datetime.now(UTC) - timedelta(days=31)
        await session.flush()
        assert await service.purge_expired() == 1
        assert [item.id for item in (await service.list_trash(space, owner)).items] == [third.id]

        assert await service.empty_trash(space, owner) == 1
        assert (await service.list_trash(space, owner)).items == []
        remaining = (
            await session.execute(
                select(func.count())
                .select_from(WikiPage)
                .where(WikiPage.id.in_([first.id, second.id, third.id]))
                .execution_options(include_deleted=True)
            )
        ).scalar_one()
        assert remaining == 0


class TestDrafts:
    async def test_saving_a_draft_repeatedly_overwrites_it(self, session: AsyncSession) -> None:
        """Every save after the first is an UPDATE whose `updated_at` the
        database computes - reading it back used to lazy-load outside the
        async context and 500, so only the first save of a draft worked."""
        from app.schemas.draft import PageDraftUpsert

        owner = await _make_user(session)
        space = await SpaceService(session).create(
            SpaceCreate(key=_uniq("DR").upper()[:10], name="Drafts"), owner
        )
        service = PageService(session)
        page = await service.create(space, PageCreate(title="Draft me"), owner)

        for index in range(3):
            saved = await service.save_draft(
                page,
                owner,
                PageDraftUpsert(
                    content=f"<p>draft {index}</p>",
                    content_format="html",
                    edit_mode="normal",
                    base_updated_at=page.updated_at,
                ),
            )
            assert saved.content == f"<p>draft {index}</p>"
            assert saved.updated_at is not None

        loaded = await service.get_draft(page, owner)
        assert loaded is not None and loaded.content == "<p>draft 2</p>"
