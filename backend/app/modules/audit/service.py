"""Reading the audit trail.

Read-only by design: there is no update or delete method here, and no API
surface to write one. The write side lives in :mod:`app.services.audit`, so no
feature module has to import another feature module to record an event.
"""

from __future__ import annotations

import csv
import io
import json
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.repositories.audit import AuditLogRepository
from app.schemas.audit import AuditLogRead
from app.schemas.pagination import Page

#: Hard cap on a single export download so a broad filter cannot pull an
#: unbounded table into memory.
EXPORT_LIMIT = 5000

_CSV_COLUMNS = (
    "id",
    "created_at",
    "actor_username",
    "actor_id",
    "impersonator_username",
    "action",
    "entity_type",
    "entity_label",
    "entity_id",
    "ip_address",
    "details",
)


class AuditQueryService:
    def __init__(self, session: AsyncSession) -> None:
        self.repo = AuditLogRepository(session)

    async def search(
        self,
        *,
        action: str | None = None,
        entity_type: str | None = None,
        actor_id: uuid.UUID | None = None,
        actor_username: str | None = None,
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
            actor_username=actor_username,
            entity_id=entity_id,
            since=since,
            until=until,
            q=q,
            limit=limit,
            offset=offset,
        )
        actor_usernames = {
            e.actor_username
            for e in entries
            if getattr(e, "actor_username", None) and e.actor_username != "system"
        } | {
            e.impersonator_username
            for e in entries
            if isinstance(getattr(e, "impersonator_username", None), str)
            and e.impersonator_username
        }
        user_meta: dict[str, tuple[str | None, str | None]] = {}
        if (
            actor_usernames
            and hasattr(self.repo, "session")
            and hasattr(self.repo.session, "execute")
        ):
            try:
                res = await self.repo.session.execute(
                    select(User.username, User.avatar_url, User.full_name).where(
                        User.username.in_(actor_usernames)
                    )
                )
                user_meta = {row[0]: (row[1], row[2]) for row in res.all()}
            except Exception:
                user_meta = {}

        items: list[AuditLogRead] = []
        for e in entries:
            read = AuditLogRead.model_validate(e)
            if read.actor_username in user_meta:
                read.actor_avatar_url, read.actor_full_name = user_meta[read.actor_username]
            if read.impersonator_username in user_meta:
                read.impersonator_avatar_url, read.impersonator_full_name = user_meta[
                    read.impersonator_username
                ]
            items.append(read)

        return Page.of(
            items,
            total,
            limit=limit,
            offset=offset,
        )

    async def actors(self) -> list[str]:
        return await self.repo.actor_usernames()

    async def export_entries(
        self,
        *,
        action: str | None = None,
        entity_type: str | None = None,
        actor_id: uuid.UUID | None = None,
        actor_username: str | None = None,
        entity_id: uuid.UUID | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        q: str | None = None,
        limit: int = EXPORT_LIMIT,
    ) -> list[AuditLogRead]:
        entries = await self.repo.export(
            action=action,
            entity_type=entity_type,
            actor_id=actor_id,
            actor_username=actor_username,
            entity_id=entity_id,
            since=since,
            until=until,
            q=q,
            limit=min(limit, EXPORT_LIMIT),
        )
        return [AuditLogRead.model_validate(e) for e in entries]

    @staticmethod
    def to_csv(entries: list[AuditLogRead]) -> str:
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(_CSV_COLUMNS)
        for item in entries:
            writer.writerow(
                [
                    str(item.id),
                    item.created_at.isoformat(),
                    item.actor_username,
                    str(item.actor_id) if item.actor_id else "",
                    item.impersonator_username or "",
                    item.action,
                    item.entity_type,
                    item.entity_label,
                    str(item.entity_id) if item.entity_id else "",
                    item.ip_address or "",
                    json.dumps(item.details, ensure_ascii=False, sort_keys=True),
                ]
            )
        return buf.getvalue()

    @staticmethod
    def to_json(entries: list[AuditLogRead]) -> str:
        payload = [item.model_dump(mode="json") for item in entries]
        return json.dumps(payload, ensure_ascii=False, indent=2)
