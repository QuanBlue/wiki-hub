"""Threaded page comments and likes, against real PostgreSQL.

Requires ``WIKIHUB_TEST_DATABASE_URL``; skipped otherwise.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, PermissionDeniedError
from app.models.comment import CommentLike, PageComment
from app.models.notification import Notification
from app.models.space import Space, SpaceVisibility
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.comments.service import CommentService, extract_mention_names
from app.modules.pages.service import PageService
from app.modules.spaces.service import SpaceService
from app.schemas.comment import CommentCreate, CommentUpdate
from app.schemas.page import PageCreate
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
    space = await SpaceService(session).create(SpaceCreate(key="CMT", name="Comments"), owner)
    page = await PageService(session).create(
        space, PageCreate(title="Runbook", content="body"), owner
    )
    return owner, space, page.slug


async def _kinds(session: AsyncSession, user: User) -> list[str]:
    rows = await session.scalars(
        select(Notification.kind).where(Notification.user_id == user.id).order_by(Notification.kind)
    )
    return list(rows)


class TestMentionParsing:
    def test_extracts_distinct_names_and_ignores_emails(self) -> None:
        body = "Hi @Alice, ping @bob. and @alice again; mail me at x@example.org"
        assert extract_mention_names(body) == ["alice", "bob"]

    def test_no_mentions(self) -> None:
        assert extract_mention_names("nothing here") == []


class TestTree:
    async def test_replies_form_a_tree_oldest_first(self, session: AsyncSession) -> None:
        owner, _, slug = await _setup(session)
        service = CommentService(session, owner)
        root = await service.create("CMT", slug, CommentCreate(body="root"))
        reply = await service.create(
            "CMT", slug, CommentCreate(body="reply", parent_id=root.id)
        )
        deeper = await service.create(
            "CMT", slug, CommentCreate(body="deeper", parent_id=reply.id)
        )

        listed = await service.list_comments("CMT", slug)

        assert [c.id for c in listed.items] == [root.id, reply.id, deeper.id]
        assert listed.total == 3
        assert listed.items[2].parent_id == reply.id

    async def test_parent_must_belong_to_the_same_page(self, session: AsyncSession) -> None:
        owner, space, slug = await _setup(session)
        other = await PageService(session).create(space, PageCreate(title="Other"), owner)
        service = CommentService(session, owner)
        foreign = await service.create("CMT", other.slug, CommentCreate(body="elsewhere"))

        with pytest.raises(NotFoundError):
            await service.create("CMT", slug, CommentCreate(body="x", parent_id=foreign.id))

    async def test_blank_body_is_rejected_by_the_schema(self) -> None:
        with pytest.raises(ValueError):
            CommentCreate(body="   ")


class TestEditAndDelete:
    async def test_only_the_author_edits(self, session: AsyncSession) -> None:
        owner, _, slug = await _setup(session)
        other = await _user(session)
        comment = await CommentService(session, owner).create(
            "CMT", slug, CommentCreate(body="mine")
        )

        edited = await CommentService(session, owner).update(
            "CMT", slug, comment.id, CommentUpdate(body="changed")
        )
        assert edited.body == "changed" and edited.edited_at is not None
        with pytest.raises(PermissionDeniedError):
            await CommentService(session, other).update(
                "CMT", slug, comment.id, CommentUpdate(body="hijack")
            )

    async def test_deleting_removes_the_whole_branch_and_its_likes(
        self, session: AsyncSession
    ) -> None:
        owner, _, slug = await _setup(session)
        service = CommentService(session, owner)
        root = await service.create("CMT", slug, CommentCreate(body="root"))
        reply = await service.create("CMT", slug, CommentCreate(body="r", parent_id=root.id))
        sibling = await service.create("CMT", slug, CommentCreate(body="keep"))
        await service.set_like("CMT", slug, reply.id, True)

        await service.delete("CMT", slug, root.id)

        remaining = await session.scalars(select(PageComment.id))
        assert list(remaining) == [sibling.id]
        assert await session.scalar(select(func.count()).select_from(CommentLike)) == 0

    async def test_a_member_cannot_delete_someone_elses_comment(
        self, session: AsyncSession
    ) -> None:
        owner, _, slug = await _setup(session)
        member = await _user(session)
        comment = await CommentService(session, owner).create(
            "CMT", slug, CommentCreate(body="x")
        )

        with pytest.raises(PermissionDeniedError):
            await CommentService(session, member).delete("CMT", slug, comment.id)

    async def test_the_space_owner_can_moderate(self, session: AsyncSession) -> None:
        owner, _, slug = await _setup(session)
        member = await _user(session)
        comment = await CommentService(session, member).create(
            "CMT", slug, CommentCreate(body="spam")
        )

        seen = (await CommentService(session, owner).list_comments("CMT", slug)).items[0]
        assert seen.can_delete and not seen.can_edit
        await CommentService(session, owner).delete("CMT", slug, comment.id)
        assert (await CommentService(session, owner).list_comments("CMT", slug)).total == 0


class TestLikes:
    async def test_like_is_idempotent_and_counted_per_person(
        self, session: AsyncSession
    ) -> None:
        owner, _, slug = await _setup(session)
        fan = await _user(session)
        comment = await CommentService(session, owner).create(
            "CMT", slug, CommentCreate(body="nice")
        )

        first = await CommentService(session, fan).set_like("CMT", slug, comment.id, True)
        again = await CommentService(session, fan).set_like("CMT", slug, comment.id, True)
        theirs = await CommentService(session, owner).set_like("CMT", slug, comment.id, True)

        assert (first.like_count, again.like_count, theirs.like_count) == (1, 1, 2)
        mine = (await CommentService(session, fan).list_comments("CMT", slug)).items[0]
        assert mine.like_count == 2 and mine.liked_by_me

        removed = await CommentService(session, fan).set_like("CMT", slug, comment.id, False)
        assert removed.like_count == 1 and not removed.liked_by_me
        # Removing a like that is not there is fine too.
        await CommentService(session, fan).set_like("CMT", slug, comment.id, False)

    async def test_lists_who_liked_a_comment_and_a_page(self, session: AsyncSession) -> None:
        owner, space, slug = await _setup(session)
        fan = await _user(session)
        comment = await CommentService(session, owner).create(
            "CMT", slug, CommentCreate(body="nice")
        )
        await CommentService(session, fan).set_like("CMT", slug, comment.id, True)
        await CommentService(session, owner).set_like("CMT", slug, comment.id, True)

        likers = await CommentService(session, owner).likers("CMT", slug, comment.id)
        assert {person.username for person in likers} == {fan.username, owner.username}

        pages = PageService(session)
        page = await pages.get_by_slug(space, slug)
        await pages.set_like(page, fan, True)
        assert [person.username for person in await pages.likers(page)] == [fan.username]


class TestAccess:
    async def test_nobody_outside_a_restricted_space_can_read_or_write(
        self, session: AsyncSession
    ) -> None:
        owner, space, slug = await _setup(session)
        await SpaceService(session).update(
            space, SpaceUpdate(visibility=SpaceVisibility.restricted), owner
        )
        stranger = await _user(session)
        service = CommentService(session, stranger)

        with pytest.raises(PermissionDeniedError):
            await service.list_comments("CMT", slug)
        with pytest.raises(PermissionDeniedError):
            await service.create("CMT", slug, CommentCreate(body="let me in"))

    async def test_unknown_page_is_not_found(self, session: AsyncSession) -> None:
        owner, _, _ = await _setup(session)
        with pytest.raises(NotFoundError):
            await CommentService(session, owner).list_comments("CMT", "nope")

    async def test_comment_ids_do_not_cross_pages(self, session: AsyncSession) -> None:
        owner, space, slug = await _setup(session)
        other = await PageService(session).create(space, PageCreate(title="Other"), owner)
        service = CommentService(session, owner)
        comment = await service.create("CMT", slug, CommentCreate(body="here"))

        with pytest.raises(NotFoundError):
            await service.delete("CMT", other.slug, comment.id)
        with pytest.raises(NotFoundError):
            await service.set_like("CMT", other.slug, uuid.uuid4(), True)


class TestMentionsAndNotifications:
    async def test_mentions_keep_only_people_who_can_view(self, session: AsyncSession) -> None:
        owner, _, slug = await _setup(session)
        alice = await _user(session, unique("alice"))
        service = CommentService(session, owner)

        comment = await service.create(
            "CMT", slug, CommentCreate(body=f"cc @{alice.username} and @ghostuser")
        )

        assert comment.mentions == [alice.username]
        assert await _kinds(session, alice) == ["comment_mention"]

    async def test_editing_only_notifies_new_mentions(self, session: AsyncSession) -> None:
        owner, _, slug = await _setup(session)
        alice = await _user(session, unique("alice"))
        service = CommentService(session, owner)
        comment = await service.create("CMT", slug, CommentCreate(body=f"@{alice.username}"))

        await service.update(
            "CMT", slug, comment.id, CommentUpdate(body=f"@{alice.username} again")
        )

        assert await _kinds(session, alice) == ["comment_mention"]

    async def test_reply_like_and_page_comment_notifications(
        self, session: AsyncSession
    ) -> None:
        owner, _, slug = await _setup(session)
        bob = await _user(session)
        carol = await _user(session)

        root = await CommentService(session, bob).create("CMT", slug, CommentCreate(body="hi"))
        assert "page_comment" in await _kinds(session, owner)

        await CommentService(session, carol).create(
            "CMT", slug, CommentCreate(body="reply", parent_id=root.id)
        )
        assert await _kinds(session, bob) == ["comment_reply"]

        await CommentService(session, carol).set_like("CMT", slug, root.id, True)
        await CommentService(session, carol).set_like("CMT", slug, root.id, True)
        assert await _kinds(session, bob) == ["comment_liked", "comment_reply"]

    async def test_nobody_is_notified_about_their_own_activity(
        self, session: AsyncSession
    ) -> None:
        owner, _, slug = await _setup(session)
        service = CommentService(session, owner)
        root = await service.create("CMT", slug, CommentCreate(body="mine"))
        await service.create("CMT", slug, CommentCreate(body="mine too", parent_id=root.id))
        await service.set_like("CMT", slug, root.id, True)

        assert await _kinds(session, owner) == []

    async def test_mentionable_lists_people_who_can_see_the_page(
        self, session: AsyncSession
    ) -> None:
        owner, _, slug = await _setup(session)
        alice = await _user(session, unique("zalice"))

        found = await CommentService(session, owner).mentionable("CMT", slug, "zalice")

        assert [person.username for person in found] == [alice.username]
