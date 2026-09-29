"""Data access for administrator mailboxes and their inbox.

SQL only; the rules (who may see what, when a mailbox counts as active) live
in ``modules/admin_mail/service.py``. The one exception is the definition of an
*active* mailbox, kept here because every query that means "who receives
requests" must agree on it.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Literal

from sqlalchemy import Select, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin_mail import AdminMailbox, AdminRequest, AdminRequestRecipient
from app.models.user import User

InboxStatus = Literal["all", "unread", "open", "resolved"]


class AdminMailRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # --- mailboxes -------------------------------------------------------

    @staticmethod
    def _mailboxes() -> Select[tuple[AdminMailbox, User]]:
        return select(AdminMailbox, User).join(User, User.id == AdminMailbox.user_id)

    async def list_mailboxes(self) -> list[tuple[AdminMailbox, User]]:
        rows = await self.session.execute(self._mailboxes().order_by(AdminMailbox.email))
        return [(mailbox, user) for mailbox, user in rows]

    async def get_mailbox(self, mailbox_id: uuid.UUID) -> tuple[AdminMailbox, User] | None:
        row = (
            await self.session.execute(self._mailboxes().where(AdminMailbox.id == mailbox_id))
        ).first()
        return (row[0], row[1]) if row else None

    async def get_mailbox_for_user(self, user_id: uuid.UUID) -> tuple[AdminMailbox, User] | None:
        row = (
            await self.session.execute(self._mailboxes().where(AdminMailbox.user_id == user_id))
        ).first()
        return (row[0], row[1]) if row else None

    async def active_mailboxes(self) -> list[AdminMailbox]:
        """Mailboxes that receive requests: switched on, and the linked account
        is still active. Disabling the account disables its mailbox with no
        further step, because this is evaluated live rather than copied."""
        rows = await self.session.execute(
            select(AdminMailbox)
            .join(User, User.id == AdminMailbox.user_id)
            .where(AdminMailbox.is_enabled.is_(True), User.is_active.is_(True))
            .order_by(AdminMailbox.email)
        )
        return list(rows.scalars())

    async def working_mailboxes(self) -> list[AdminMailbox]:
        """The pool a send falls back to when the acting administrator has no
        mailbox of their own: connected right now (the send would just fail
        otherwise) and its account still active. Deliberately not filtered by
        `is_enabled` ("Receive requests") - see `AdminMailService`'s
        `_require_sendable_mailbox`, which a pool candidate has to meet the
        same bar as."""
        rows = await self.session.execute(
            select(AdminMailbox)
            .join(User, User.id == AdminMailbox.user_id)
            .where(AdminMailbox.health_status == "ok", User.is_active.is_(True))
            .order_by(AdminMailbox.email)
        )
        return list(rows.scalars())

    def add(self, entity: AdminMailbox | AdminRequest | AdminRequestRecipient) -> None:
        self.session.add(entity)

    async def delete(self, entity: AdminMailbox) -> None:
        await self.session.delete(entity)

    # --- inbox -----------------------------------------------------------

    @staticmethod
    def _inbox(user_id: uuid.UUID) -> Select[tuple[AdminRequestRecipient, AdminRequest]]:
        return (
            select(AdminRequestRecipient, AdminRequest)
            .join(AdminRequest, AdminRequest.id == AdminRequestRecipient.request_id)
            .where(AdminRequestRecipient.user_id == user_id)
        )

    @staticmethod
    def _by_status(
        query: Select[tuple[AdminRequestRecipient, AdminRequest]], status: InboxStatus
    ) -> Select[tuple[AdminRequestRecipient, AdminRequest]]:
        if status == "unread":
            return query.where(AdminRequestRecipient.read_at.is_(None))
        if status == "open":
            return query.where(AdminRequest.resolved_at.is_(None))
        if status == "resolved":
            return query.where(AdminRequest.resolved_at.is_not(None))
        return query

    @staticmethod
    def _by_kind(
        query: Select[tuple[AdminRequestRecipient, AdminRequest]], kind: str | None
    ) -> Select[tuple[AdminRequestRecipient, AdminRequest]]:
        return query.where(AdminRequest.kind == kind) if kind else query

    async def inbox_counts(self, user_id: uuid.UUID, *, kind: str | None) -> dict[str, int]:
        """How many requests each tab would list, for one request type or all."""
        query = (
            select(
                func.count(),
                func.count().filter(AdminRequestRecipient.read_at.is_(None)),
                func.count().filter(AdminRequest.resolved_at.is_(None)),
                func.count().filter(AdminRequest.resolved_at.is_not(None)),
            )
            .select_from(AdminRequestRecipient)
            .join(AdminRequest, AdminRequest.id == AdminRequestRecipient.request_id)
            .where(AdminRequestRecipient.user_id == user_id)
        )
        if kind:
            query = query.where(AdminRequest.kind == kind)
        every, unread, open_, resolved = (await self.session.execute(query)).one()
        return {
            "all": int(every),
            "unread": int(unread),
            "open": int(open_),
            "resolved": int(resolved),
        }

    async def list_inbox(
        self,
        user_id: uuid.UUID,
        *,
        status: InboxStatus,
        limit: int,
        offset: int,
        kind: str | None = None,
    ) -> tuple[Sequence[tuple[AdminRequestRecipient, AdminRequest]], int]:
        # One filtered query drives both the page and the total, so they cannot
        # drift apart.
        filtered = self._by_kind(self._by_status(self._inbox(user_id), status), kind)
        total = (
            await self.session.execute(select(func.count()).select_from(filtered.subquery()))
        ).scalar_one()
        rows = await self.session.execute(
            filtered.order_by(AdminRequest.created_at.desc()).limit(limit).offset(offset)
        )
        return [(recipient, request) for recipient, request in rows], int(total)

    async def get_inbox_item(
        self, user_id: uuid.UUID, request_id: uuid.UUID
    ) -> tuple[AdminRequestRecipient, AdminRequest] | None:
        row = (
            await self.session.execute(self._inbox(user_id).where(AdminRequest.id == request_id))
        ).first()
        return (row[0], row[1]) if row else None

    async def latest_request_at(self, user_id: uuid.UUID) -> datetime | None:
        """When the newest request in this account's Inbox arrived. The shell
        polls it to notice a new request the moment it lands, even when the
        unread count happens to stay the same."""
        return (
            await self.session.execute(
                select(func.max(AdminRequest.created_at))
                .select_from(AdminRequestRecipient)
                .join(AdminRequest, AdminRequest.id == AdminRequestRecipient.request_id)
                .where(AdminRequestRecipient.user_id == user_id)
            )
        ).scalar_one()

    async def unread_count(self, user_id: uuid.UUID) -> int:
        return int(
            (
                await self.session.execute(
                    select(func.count())
                    .select_from(AdminRequestRecipient)
                    .where(
                        AdminRequestRecipient.user_id == user_id,
                        AdminRequestRecipient.read_at.is_(None),
                    )
                )
            ).scalar_one()
        )

    async def mark_all_read(self, user_id: uuid.UUID, at: datetime) -> None:
        await self.session.execute(
            update(AdminRequestRecipient)
            .where(
                AdminRequestRecipient.user_id == user_id,
                AdminRequestRecipient.read_at.is_(None),
            )
            .values(read_at=at)
        )
