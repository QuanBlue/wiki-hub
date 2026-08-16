"""Persistent session tracking and revocation for signed-in accounts."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AuthenticationError
from app.models.user_session import UserSession
from app.services.audit import ClientInfo


class SessionService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        user_id: uuid.UUID,
        token_jti: str,
        expires_at: datetime,
        client: ClientInfo,
        impersonator_id: uuid.UUID | None = None,
    ) -> UserSession:
        now = datetime.now(UTC)
        entry = UserSession(
            user_id=user_id,
            impersonator_id=impersonator_id,
            token_jti=token_jti,
            expires_at=expires_at,
            last_seen_at=now,
            ip_address=client.ip,
            user_agent=(client.user_agent or "")[:255] or None,
        )
        self.session.add(entry)
        await self.session.flush()
        return entry

    async def require_active(self, *, user_id: uuid.UUID, token_jti: str) -> None:
        entry = await self.session.scalar(
            select(UserSession).where(
                UserSession.user_id == user_id,
                UserSession.token_jti == token_jti,
                UserSession.revoked_at.is_(None),
                UserSession.expires_at > datetime.now(UTC),
            )
        )
        if entry is None:
            raise AuthenticationError("Your session has been signed out. Please sign in again.")
        entry.last_seen_at = datetime.now(UTC)

    async def list_for_user(self, user_id: uuid.UUID, current_jti: str) -> list[UserSession]:
        return list(
            (
                await self.session.execute(
                    select(UserSession)
                    .where(
                        UserSession.user_id == user_id,
                        UserSession.revoked_at.is_(None),
                        UserSession.expires_at > datetime.now(UTC),
                    )
                    .order_by(UserSession.last_seen_at.desc())
                )
            ).scalars()
        )

    async def revoke_others(self, *, user_id: uuid.UUID, current_jti: str) -> int:
        result = await self.session.execute(
            update(UserSession)
            .where(
                UserSession.user_id == user_id,
                UserSession.token_jti != current_jti,
                UserSession.revoked_at.is_(None),
                UserSession.impersonator_id.is_(None),
            )
            .values(revoked_at=datetime.now(UTC))
        )
        await self.session.flush()
        # SQLAlchemy annotates ``AsyncSession.execute`` broadly as Result,
        # while UPDATE statements return a cursor result with ``rowcount``.
        return int(getattr(result, "rowcount", 0) or 0)

    async def revoke(self, *, user_id: uuid.UUID, token_jti: str) -> None:
        await self.session.execute(
            update(UserSession)
            .where(UserSession.user_id == user_id, UserSession.token_jti == token_jti)
            .values(revoked_at=datetime.now(UTC))
        )
        await self.session.flush()
