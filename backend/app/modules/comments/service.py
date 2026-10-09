"""Threaded page comments, their likes, and who gets told about them."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, PermissionDeniedError
from app.models.comment import CommentLike, PageComment
from app.models.page import WikiPage
from app.models.permission import Permission
from app.models.space import Space
from app.models.user import User
from app.modules.notifications.service import notify
from app.modules.pages.people import people_for_page
from app.modules.pages.service import PageService
from app.modules.spaces.service import SpaceService
from app.schemas.comment import (
    CommentAuthor,
    CommentCreate,
    CommentLikeRead,
    CommentRead,
    CommentUpdate,
    MentionCandidate,
)
from app.schemas.page import LikerRead
from app.schemas.pagination import Page

#: ``@name`` that does not continue a word or an e-mail address.
_MENTION = re.compile(r"(?<![\w@.])@([A-Za-z0-9][A-Za-z0-9_.-]{0,63})")
_MAX_MENTIONS = 20


def extract_mention_names(body: str) -> list[str]:
    """Distinct ``@name`` tokens in ``body``, trailing punctuation dropped."""
    seen: dict[str, None] = {}
    for match in _MENTION.finditer(body):
        seen.setdefault(match.group(1).rstrip(".-").lower(), None)
    return [name for name in seen if name][:_MAX_MENTIONS]


class CommentService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user
        self.spaces = SpaceService(session)
        self.pages = PageService(session)

    # -- access ------------------------------------------------------------
    async def _resolve(self, key: str, slug: str) -> tuple[Space, WikiPage]:
        """The standard "may this person see this page" gate."""
        space = await self.spaces.get_by_key(key)
        await self.spaces.require_view(space, self.user)
        page = await self.pages.get_by_slug(space, slug)
        await self.pages.require_page_view(page, self.user)
        return space, page

    async def _moderates(self, space: Space) -> bool:
        permissions = self.spaces.permissions
        if await permissions.is_system_admin(self.user):
            return True
        if await permissions.is_space_owner(space, self.user):
            return True
        # Not Permission.delete: an open space grants that to everyone, which
        # would let any member remove other people's comments.
        return Permission.admin in await permissions.effective_permissions(space, self.user)

    async def _get(self, page: WikiPage, comment_id: uuid.UUID) -> PageComment:
        comment = await self.session.get(PageComment, comment_id)
        if comment is None or comment.page_id != page.id:
            raise NotFoundError("Comment not found.")
        return comment

    # -- reading -----------------------------------------------------------
    async def _render(
        self, space: Space, comments: list[PageComment]
    ) -> list[CommentRead]:
        if not comments:
            return []
        ids = [comment.id for comment in comments]
        counts: dict[uuid.UUID, int] = {
            comment_id: int(total)
            for comment_id, total in (
                await self.session.execute(
                    select(CommentLike.comment_id, func.count())
                    .where(CommentLike.comment_id.in_(ids))
                    .group_by(CommentLike.comment_id)
                )
            ).all()
        }
        mine = set(
            await self.session.scalars(
                select(CommentLike.comment_id).where(
                    CommentLike.comment_id.in_(ids), CommentLike.user_id == self.user.id
                )
            )
        )
        moderates = await self._moderates(space)
        reads: list[CommentRead] = []
        for comment in comments:
            is_author = comment.author_id == self.user.id
            author = comment.author
            reads.append(
                CommentRead(
                    id=comment.id,
                    parent_id=comment.parent_id,
                    body=comment.body,
                    author=CommentAuthor(
                        id=author.id,
                        username=author.username,
                        full_name=author.full_name,
                        avatar_url=author.avatar_url,
                    )
                    if author is not None
                    else None,
                    created_at=comment.created_at,
                    edited_at=comment.edited_at,
                    like_count=int(counts.get(comment.id, 0)),
                    liked_by_me=comment.id in mine,
                    mentions=list(comment.mentions or []),
                    can_edit=is_author,
                    can_delete=is_author or moderates,
                )
            )
        return reads

    async def list_comments(self, key: str, slug: str) -> Page[CommentRead]:
        space, page = await self._resolve(key, slug)
        comments = list(
            await self.session.scalars(
                select(PageComment)
                .where(PageComment.page_id == page.id)
                .order_by(PageComment.created_at, PageComment.id)
            )
        )
        items = await self._render(space, comments)
        return Page.of(items, len(items), limit=len(items), offset=0)

    async def mentionable(self, key: str, slug: str, query: str) -> list[MentionCandidate]:
        """Active accounts matching ``query`` for the ``@mention`` picker; see
        :func:`people_for_page`."""
        _, page = await self._resolve(key, slug)
        return await people_for_page(self.session, self.spaces.permissions, page, query)

    # -- writing -----------------------------------------------------------
    async def _resolve_mentions(self, page: WikiPage, body: str) -> list[User]:
        names = extract_mention_names(body)
        if not names:
            return []
        users = await self.session.scalars(
            select(User).where(func.lower(User.username).in_(names), User.is_active.is_(True))
        )
        allowed: list[User] = []
        for mentioned in users:
            if await self.spaces.permissions.can_view_page(page, mentioned):
                allowed.append(mentioned)
        return sorted(allowed, key=lambda candidate: candidate.username.lower())

    def _link(self, space: Space, page: WikiPage, comment: PageComment) -> str:
        link = f"/spaces/{space.key}/pages/{page.slug}#comment-{comment.id}"
        return link if len(link) <= 300 else f"/spaces/{space.key}"

    async def _tell(
        self,
        recipient: User | None,
        kind: str,
        space: Space,
        page: WikiPage,
        comment: PageComment,
        told: set[uuid.UUID],
    ) -> None:
        """Notify one person, once per comment, and only if they may see the page."""
        if recipient is None or recipient.id in told or recipient.id == self.user.id:
            return
        if not recipient.is_active:
            return
        if not await self.spaces.permissions.can_view_page(page, recipient):
            return
        told.add(recipient.id)
        await notify(
            self.session,
            recipient.id,
            kind,
            params={"title": page.title, "space": space.key},
            link=self._link(space, page, comment),
            actor=self.user,
        )

    async def create(self, key: str, slug: str, payload: CommentCreate) -> CommentRead:
        space, page = await self._resolve(key, slug)
        parent: PageComment | None = None
        if payload.parent_id is not None:
            parent = await self._get(page, payload.parent_id)
        mentioned = await self._resolve_mentions(page, payload.body)
        comment = PageComment(
            page_id=page.id,
            parent_id=parent.id if parent else None,
            author_id=self.user.id,
            body=payload.body,
            # The column default is the transaction's start time, which would
            # give replies made in one transaction the same instant.
            created_at=datetime.now(UTC),
            mentions=[person.username for person in mentioned],
        )
        self.session.add(comment)
        await self.session.flush()
        await self.session.refresh(comment, attribute_names=["author", "created_at"])

        told: set[uuid.UUID] = set()
        if parent is not None and parent.author_id is not None:
            await self._tell(
                await self.session.get(User, parent.author_id),
                "comment_reply",
                space,
                page,
                comment,
                told,
            )
        for person in mentioned:
            await self._tell(person, "comment_mention", space, page, comment, told)
        if parent is None and page.created_by_id is not None:
            await self._tell(
                await self.session.get(User, page.created_by_id),
                "page_comment",
                space,
                page,
                comment,
                told,
            )
        return (await self._render(space, [comment]))[0]

    async def update(
        self, key: str, slug: str, comment_id: uuid.UUID, payload: CommentUpdate
    ) -> CommentRead:
        space, page = await self._resolve(key, slug)
        comment = await self._get(page, comment_id)
        if comment.author_id != self.user.id:
            raise PermissionDeniedError("You can only edit your own comments.")
        if payload.body == comment.body:
            return (await self._render(space, [comment]))[0]
        before = set(comment.mentions or [])
        mentioned = await self._resolve_mentions(page, payload.body)
        comment.body = payload.body
        comment.mentions = [person.username for person in mentioned]
        comment.edited_at = datetime.now(UTC)
        await self.session.flush()
        await self.session.refresh(comment, attribute_names=["author", "created_at"])
        told: set[uuid.UUID] = set()
        for person in mentioned:
            if person.username not in before:
                await self._tell(person, "comment_mention", space, page, comment, told)
        return (await self._render(space, [comment]))[0]

    async def delete(self, key: str, slug: str, comment_id: uuid.UUID) -> None:
        space, page = await self._resolve(key, slug)
        comment = await self._get(page, comment_id)
        if comment.author_id != self.user.id and not await self._moderates(space):
            raise PermissionDeniedError("You cannot delete this comment.")
        # The replies and likes go with it through the FK cascades.
        await self.session.execute(delete(PageComment).where(PageComment.id == comment.id))
        self.session.expire_all()

    async def likers(self, key: str, slug: str, comment_id: uuid.UUID) -> list[LikerRead]:
        """Who liked this comment, earliest first - same page-view gate as
        reading the comments."""
        _space, page = await self._resolve(key, slug)
        comment = await self._get(page, comment_id)
        users = (
            await self.session.scalars(
                select(User)
                .join(CommentLike, CommentLike.user_id == User.id)
                .where(CommentLike.comment_id == comment.id)
                .order_by(CommentLike.created_at, func.lower(User.username))
            )
        ).all()
        return [
            LikerRead(
                id=user.id, username=user.username, full_name=user.full_name,
                avatar_url=user.avatar_url,
            )
            for user in users
        ]

    async def set_like(
        self, key: str, slug: str, comment_id: uuid.UUID, liked: bool
    ) -> CommentLikeRead:
        space, page = await self._resolve(key, slug)
        comment = await self._get(page, comment_id)
        existing = await self.session.get(CommentLike, (comment.id, self.user.id))
        created = False
        if liked and existing is None:
            self.session.add(CommentLike(comment_id=comment.id, user_id=self.user.id))
            created = True
        elif not liked and existing is not None:
            await self.session.delete(existing)
        await self.session.flush()
        if created and comment.author_id is not None:
            await self._tell(
                await self.session.get(User, comment.author_id),
                "comment_liked",
                space,
                page,
                comment,
                set(),
            )
        count = await self.session.scalar(
            select(func.count())
            .select_from(CommentLike)
            .where(CommentLike.comment_id == comment.id)
        )
        return CommentLikeRead(liked_by_me=liked, like_count=int(count or 0))

