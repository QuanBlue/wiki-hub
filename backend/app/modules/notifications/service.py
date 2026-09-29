"""Creating and reading a person's notifications.

``notify`` is the one call other modules make when something happens to a user.
It is deliberately tiny and does no permission checks of its own: whoever is
performing the action has already been authorised, and the notification only
tells the affected person about it.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.notification import Notification
from app.models.user import User
from app.schemas.notification import NotificationRead, NotificationSummary
from app.schemas.pagination import Page


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

    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user

    async def summary(self) -> NotificationSummary:
        unread, latest = (
            await self.session.execute(
                select(
                    func.count().filter(Notification.read_at.is_(None)),
                    func.max(Notification.created_at),
                ).where(Notification.user_id == self.user.id)
            )
        ).one()
        return NotificationSummary(unread_count=int(unread), latest_at=latest)

    async def list(self, *, unread_only: bool, limit: int, offset: int) -> Page[NotificationRead]:
        query = select(Notification).where(Notification.user_id == self.user.id)
        if unread_only:
            query = query.where(Notification.read_at.is_(None))
        total = (
            await self.session.execute(select(func.count()).select_from(query.subquery()))
        ).scalar_one()
        rows = await self.session.execute(
            query.order_by(Notification.created_at.desc(), Notification.id)
            .limit(limit)
            .offset(offset)
        )
        return Page.of(
            [NotificationRead.model_validate(row) for row in rows.scalars()],
            int(total),
            limit=limit,
            offset=offset,
        )

    async def mark_read(self, notification_id: uuid.UUID, *, read: bool = True) -> NotificationRead:
        row = await self.session.scalar(
            select(Notification).where(
                Notification.id == notification_id, Notification.user_id == self.user.id
            )
        )
        if row is None:
            raise NotFoundError("Notification not found.", code="notification_not_found")
        row.read_at = (row.read_at or datetime.now(UTC)) if read else None
        await self.session.flush()
        return NotificationRead.model_validate(row)

    async def mark_all_read(self) -> None:
        await self.session.execute(
            update(Notification)
            .where(Notification.user_id == self.user.id, Notification.read_at.is_(None))
            .values(read_at=datetime.now(UTC))
        )
