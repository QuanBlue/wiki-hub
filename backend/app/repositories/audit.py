"""Data access for the audit trail. Append and read only - never update."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.repositories.filters import ilike_contains


class AuditLogRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def add(self, entry: AuditLog) -> AuditLog:
        self.session.add(entry)
        return entry

    def _filtered(
        self,
        *,
        action: str | None,
        entity_type: str | None,
        actor_id: uuid.UUID | None,
        entity_id: uuid.UUID | None,
        since: datetime | None,
        until: datetime | None,
        q: str | None,
    ) -> Select[tuple[AuditLog]]:
        """One place where the filter is defined.

        Both the page query and the count are derived from this, so they can
        never drift apart - the classic pagination bug where the total ignores
        the filters.
        """
        stmt = select(AuditLog)
        if action:
            stmt = stmt.where(AuditLog.action == action)
        if entity_type:
            stmt = stmt.where(AuditLog.entity_type == entity_type)
        if actor_id:
            stmt = stmt.where(AuditLog.actor_id == actor_id)
        if entity_id:
            stmt = stmt.where(AuditLog.entity_id == entity_id)
        if since:
            stmt = stmt.where(AuditLog.created_at >= since)
        if until:
            stmt = stmt.where(AuditLog.created_at <= until)
        if q:
            stmt = stmt.where(
                or_(
                    ilike_contains(AuditLog.actor_username, q),
                    ilike_contains(AuditLog.entity_label, q),
                )
            )
        return stmt

    async def search(
        self,
        *,
        action: str | None = None,
        entity_type: str | None = None,
        actor_id: uuid.UUID | None = None,
        entity_id: uuid.UUID | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        q: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[Sequence[AuditLog], int]:
        stmt = self._filtered(
            action=action,
            entity_type=entity_type,
            actor_id=actor_id,
            entity_id=entity_id,
            since=since,
            until=until,
            q=q,
        )

        total = int(
            (
                await self.session.execute(select(func.count()).select_from(stmt.subquery()))
            ).scalar_one()
        )

        # id breaks ties so a page boundary is deterministic when two rows share
        # a timestamp - otherwise the same row can appear on two pages.
        page = (
            (
                await self.session.execute(
                    stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
                    .limit(limit)
                    .offset(offset)
                )
            )
            .scalars()
            .all()
        )

        return page, total
