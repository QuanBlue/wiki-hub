"""Creating and reading a person's notifications.

``notify`` is the one call other modules make when something happens to a user.
It is deliberately tiny and does no permission checks of its own: whoever is
performing the action has already been authorised, and the notification only
tells the affected person about it.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from urllib.parse import unquote

from sqlalchemy import ColumnElement, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.admin_mail import AdminRequest
from app.models.comment import PageComment
from app.models.issue import Issue
from app.models.notification import Notification
from app.models.page import WikiPage
from app.models.space import Space
from app.models.user import User
from app.schemas.notification import NotificationRead, NotificationSummary
from app.schemas.pagination import Page

_UUID = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
_PAGE_LINK = re.compile(rf"^/spaces/([^/?#]+)/pages/([^/?#]+)(?:#comment-({_UUID}))?$")
_SPACE_LINK = re.compile(r"^/spaces/([^/?#]+)/?$")
_ISSUE_LINK = re.compile(rf"^/admin/issues\?issue=({_UUID})$")
_REQUEST_LINK = re.compile(rf"^/admin/inbox\?request=({_UUID})$")

#: Error code the bell reacts to: what a notification points at is gone.
TARGET_GONE_CODE = "notification_target_gone"

#: Told to a person whose account an administrator started using. Hidden from that
#: impersonated session itself, so only the account's owner can see or dismiss it.
IMPERSONATION_NOTICE_KIND = "account_impersonated"


async def link_target_exists(session: AsyncSession, link: str | None) -> bool:
    """Whether what an in-app notification ``link`` leads to still exists.

    Only the kinds of link WikiHub writes into notifications are checked (a comment,
    a page, a space, an issue, a request); any other link is assumed to be fine.
    """
    if not link:
        return True
    if match := _PAGE_LINK.match(link):
        key, slug, comment_id = unquote(match[1]), unquote(match[2]), match[3]
        page_id = await session.scalar(
            select(WikiPage.id)
            .join(Space, Space.id == WikiPage.space_id)
            .where(
                func.upper(Space.key) == key.strip().upper(),
                WikiPage.slug == slug,
                WikiPage.deleted_at.is_(None),
            )
        )
        if page_id is None:
            return False
        if comment_id is None:
            return True
        return (
            await session.scalar(
                select(PageComment.id).where(
                    PageComment.id == uuid.UUID(comment_id), PageComment.page_id == page_id
                )
            )
            is not None
        )
    if match := _SPACE_LINK.match(link):
        key = unquote(match[1])
        return (
            await session.scalar(select(Space.id).where(func.upper(Space.key) == key.strip().upper()))
            is not None
        )
    if match := _ISSUE_LINK.match(link):
        return await session.scalar(select(Issue.id).where(Issue.id == uuid.UUID(match[1]))) is not None
    if match := _REQUEST_LINK.match(link):
        return (
            await session.scalar(select(AdminRequest.id).where(AdminRequest.id == uuid.UUID(match[1])))
            is not None
        )
    return True


async def forget_comment_notifications(
    session: AsyncSession, comment_ids: list[uuid.UUID]
) -> None:
    """Drop every notification that points at one of ``comment_ids`` (just deleted)."""
    for comment_id in comment_ids:
        await session.execute(
            delete(Notification).where(Notification.link.like(f"%#comment-{comment_id}"))
        )


async def notify(
    session: AsyncSession,
    user_id: uuid.UUID,
    kind: str,
    *,
    params: dict[str, object] | None = None,
    link: str | None = None,
    actor: User | None = None,
) -> None:
    """Tell ``user_id`` that ``kind`` happened.

    Nothing is sent when the person did it to themselves: an administrator who
    resets their own password does not need a bell for it.
    """
    if actor is not None and actor.id == user_id:
        return
    session.add(
        Notification(
            user_id=user_id,
            kind=kind,
            params={key: str(value) for key, value in (params or {}).items()},
            link=link,
            actor_name=(actor.full_name.strip() or actor.username) if actor else None,
        )
    )


class NotificationService:
    """One account's own notifications - never anyone else's."""

    def __init__(self, session: AsyncSession, user: User, *, impersonated: bool = False) -> None:
        self.session = session
        self.user = user
        #: True when an administrator is using this account: the notice telling its
        #: owner so is then neither shown nor markable.
        self.impersonated = impersonated

    def _visible(self) -> list[ColumnElement[bool]]:
        """The rows this session may see: the account's own, minus the notice an
        impersonating administrator must not read away."""
        conditions: list[ColumnElement[bool]] = [Notification.user_id == self.user.id]
        if self.impersonated:
            conditions.append(Notification.kind != IMPERSONATION_NOTICE_KIND)
        return conditions

    async def summary(self) -> NotificationSummary:
        unread, latest = (
            await self.session.execute(
                select(
                    func.count().filter(Notification.read_at.is_(None)),
                    func.max(Notification.created_at),
                ).where(*self._visible())
            )
        ).one()
        return NotificationSummary(unread_count=int(unread), latest_at=latest)

    async def _prune(self, rows: Sequence[Notification]) -> bool:
        """Delete the ``rows`` whose target is gone; whether any went."""
        verdicts: dict[str, bool] = {}
        stale: list[uuid.UUID] = []
        for row in rows:
            if not row.link:
                continue
            if row.link not in verdicts:
                verdicts[row.link] = await link_target_exists(self.session, row.link)
            if not verdicts[row.link]:
                stale.append(row.id)
        if stale:
            await self.session.execute(
                delete(Notification).where(
                    Notification.id.in_(stale), Notification.user_id == self.user.id
                )
            )
        return bool(stale)

    async def list(self, *, unread_only: bool, limit: int, offset: int) -> Page[NotificationRead]:
        query = select(Notification).where(*self._visible())
        if unread_only:
            query = query.where(Notification.read_at.is_(None))
        # Whatever a notification pointed at may have been deleted since: those are
        # dropped here rather than shown, and the page refilled from the next ones.
        rows: Sequence[Notification] = ()
        for _ in range(5):
            rows = list(
                (
                    await self.session.execute(
                        query.order_by(Notification.created_at.desc(), Notification.id)
                        .limit(limit)
                        .offset(offset)
                    )
                ).scalars()
            )
            if not await self._prune(rows):
                break
            self.session.expire_all()
        else:
            rows = ()
        total = (
            await self.session.execute(select(func.count()).select_from(query.subquery()))
        ).scalar_one()
        return Page.of(
            [NotificationRead.model_validate(row) for row in rows],
            int(total),
            limit=limit,
            offset=offset,
        )

    async def open(self, notification_id: uuid.UUID) -> NotificationRead:
        """Mark one read and confirm what it points at still exists.

        A notification whose target has been deleted is removed and reported as gone
        (404, ``notification_target_gone``) so the app can say so instead of
        navigating to a missing page.
        """
        row = await self.session.scalar(
            select(Notification).where(Notification.id == notification_id, *self._visible())
        )
        if row is None:
            raise NotFoundError("Notification not found.", code=TARGET_GONE_CODE)
        if not await link_target_exists(self.session, row.link):
            await self.session.delete(row)
            await self.session.flush()
            raise NotFoundError("This item no longer exists.", code=TARGET_GONE_CODE)
        row.read_at = row.read_at or datetime.now(UTC)
        await self.session.flush()
        return NotificationRead.model_validate(row)

    async def mark_read(self, notification_id: uuid.UUID, *, read: bool = True) -> NotificationRead:
        row = await self.session.scalar(
            select(Notification).where(Notification.id == notification_id, *self._visible())
        )
        if row is None:
            raise NotFoundError("Notification not found.", code="notification_not_found")
        row.read_at = (row.read_at or datetime.now(UTC)) if read else None
        await self.session.flush()
        return NotificationRead.model_validate(row)

    async def mark_all_read(self) -> None:
        await self.session.execute(
            update(Notification)
            .where(*self._visible(), Notification.read_at.is_(None))
            .values(read_at=datetime.now(UTC))
        )
