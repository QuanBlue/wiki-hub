"""Writing the audit trail.

Rows are written in the **same transaction** as the operation they describe.
``get_db`` commits once per request, so an operation that fails rolls its audit
row back with it. A separate session would be more durable but would log
operations that never actually happened - and for an audit trail, truthfulness
beats durability-through-failure.

A consequence worth stating plainly: **failed privileged attempts are not
audited**, because a 403 rolls the transaction back. Those are still visible in
the structured logs (``api/errors.py`` logs every ``domain_error`` with its
code) and in the access log. Recording them properly would need the separate
session and its truthfulness problem.

This module is under ``services/`` rather than ``modules/audit/`` because it is
cross-cutting: putting it in a feature module would make ``modules/auth``
import ``modules/audit``. The *read* side is a proper feature module.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import scrub_mapping
from app.models.audit import AuditAction, AuditLog
from app.models.user import User
from app.repositories.audit import AuditLogRepository

#: Matches AuditLog.user_agent; longer values are truncated rather than raising.
_USER_AGENT_MAX = 255


@dataclass(frozen=True)
class ClientInfo:
    """Where a request came from.

    ``X-Forwarded-For`` is deliberately **not** parsed: there is no trusted
    proxy allowlist in this codebase, and honouring the header without one lets
    any client forge the origin recorded in the audit trail.
    """

    ip: str | None = None
    user_agent: str | None = None


class AuditService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        actor: User | None = None,
        client: ClientInfo | None = None,
        impersonator: User | None = None,
    ) -> None:
        self.session = session
        self.repo = AuditLogRepository(session)
        self.actor = actor
        self.client = client or ClientInfo()
        self.impersonator = impersonator

    async def record(
        self,
        action: AuditAction | str,
        *,
        entity_type: str,
        entity_id: uuid.UUID | None = None,
        entity_label: str = "",
        details: Mapping[str, Any] | None = None,
    ) -> AuditLog:
        user_agent = self.client.user_agent
        if user_agent and len(user_agent) > _USER_AGENT_MAX:
            user_agent = user_agent[:_USER_AGENT_MAX]

        entry = AuditLog(
            actor_id=self.actor.id if self.actor else None,
            # "system" covers seeding and any future scheduled job.
            actor_username=self.actor.username if self.actor else "system",
            impersonator_id=self.impersonator.id if self.impersonator else None,
            impersonator_username=self.impersonator.username if self.impersonator else None,
            action=str(action),
            entity_type=entity_type,
            entity_id=entity_id,
            entity_label=entity_label[:255],
            # Scrubbed with the very same routine the log pipeline uses, so a
            # caller cannot persist a credential by accident.
            details=scrub_mapping(details or {}),
            ip_address=self.client.ip,
            user_agent=user_agent,
        )
        self.repo.add(entry)
        await self.session.flush()
        return entry

    @staticmethod
    def changes(
        before: Mapping[str, Any],
        after: Mapping[str, Any],
        fields: Sequence[str],
    ) -> dict[str, dict[str, Any]]:
        """Build a before/after diff over an explicit field allowlist.

        The allowlist is the point: it makes it impossible to diff a column
        like ``password_hash`` into the audit trail by widening a query.
        """
        diff: dict[str, dict[str, Any]] = {}
        for field in fields:
            old, new = before.get(field), after.get(field)
            if old != new:
                diff[field] = {"from": old, "to": new}
        return diff
