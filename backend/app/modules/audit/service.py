"""Reading the audit trail.

Read-only by design: there is no update or delete method here, and no API
surface to write one. The write side lives in :mod:`app.services.audit`, so no
feature module has to import another feature module to record an event.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.audit import AuditLogRepository
from app.schemas.audit import AuditLogRead
from app.schemas.pagination import Page


class AuditQueryService:
    def __init__(self, session: AsyncSession) -> None:
        self.repo = AuditLogRepository(session)

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
    ) -> Page[AuditLogRead]:
        entries, total = await self.repo.search(
            action=action,
            entity_type=entity_type,
            actor_id=actor_id,
            entity_id=entity_id,
            since=since,
            until=until,
            q=q,
            limit=limit,
            offset=offset,
        )
        return Page.of(
            [AuditLogRead.model_validate(e) for e in entries],
            total,
            limit=limit,
            offset=offset,
        )
