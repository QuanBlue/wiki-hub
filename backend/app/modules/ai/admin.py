"""System-administrator controls for the AI assistant's connections."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import httpx
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError
from app.core.logging import get_logger
from app.models.ai_connection import AiConnection
from app.models.user import User
from app.modules.admin_mail.crypto import encrypt_password
from app.modules.ai.config import decrypt_key
from app.schemas.ai import (
    AIModelInfo,
    AITestRequest,
    AITestResult,
    ConnectionCreate,
    ConnectionList,
    ConnectionRead,
    ConnectionUpdate,
)

logger = get_logger(__name__)


def mask_key(key: str) -> str:
    """Show just enough of a key to recognise it; short keys reveal nothing."""
    if not key:
        return ""
    if len(key) < 16:
        return "****"
    return f"{key[:6]}****{key[-4:]}"


def _model_info(item: dict) -> AIModelInfo:
    capabilities = item.get("capabilities") if isinstance(item.get("capabilities"), dict) else {}
    return AIModelInfo(
        id=str(item["id"]),
        name=str(item.get("name") or item["id"]),
        reasoning=bool(capabilities.get("reasoning")),
        image=bool(capabilities.get("vision")),
    )


async def probe(base_url: str, api_key: str) -> AITestResult:
    """Ask the gateway for its model list: proves the address and key work."""
    base_url = base_url.strip().rstrip("/")
    if not base_url:
        return AITestResult(ok=False, error="Enter the endpoint address first.")
    try:
        async with httpx.AsyncClient(timeout=15.0) as http:
            response = await http.get(
                base_url + "/models", headers={"Authorization": f"Bearer {api_key}"}
            )
        if response.status_code in (401, 403):
            return AITestResult(ok=False, error="The endpoint rejected the API key.")
        response.raise_for_status()
        models = sorted(
            (_model_info(item) for item in response.json().get("data", []) if item.get("id")),
            key=lambda model: model.id,
        )
    except (httpx.HTTPError, ValueError, AttributeError, TypeError) as exc:
        logger.info("ai_test_failed", error=type(exc).__name__)
        return AITestResult(ok=False, error="Could not reach the endpoint at that address.")
    return AITestResult(ok=True, models=models)


class AIConnectionService:
    def __init__(self, session: AsyncSession, actor: User) -> None:
        self.session = session
        self.actor = actor

    async def _get(self, connection_id: uuid.UUID) -> AiConnection:
        connection = await self.session.get(AiConnection, connection_id)
        if connection is None:
            raise NotFoundError("That AI connection no longer exists.")
        return connection

    async def list(self) -> ConnectionList:
        rows = (
            await self.session.scalars(select(AiConnection).order_by(AiConnection.created_at))
        ).all()
        return ConnectionList(items=[ConnectionRead.model_validate(row) for row in rows])

    async def create(self, payload: ConnectionCreate) -> ConnectionRead:
        connection = AiConnection(
            name=payload.name,
            base_url=payload.base_url,
            model=payload.model,
            api_key_encrypted=encrypt_password(payload.api_key),
            api_key_preview=mask_key(payload.api_key),
            is_active=False,
            updated_by_id=self.actor.id,
        )
        # The first connection is active from the start: with nothing else to
        # choose, an inactive one would just leave the assistant off.
        is_first = not await self.session.scalar(select(AiConnection.id).limit(1))
        self.session.add(connection)
        await self.session.flush()
        if payload.activate or is_first:
            await self._make_only_active(connection)
        try:
            await self.session.commit()
        except IntegrityError as exc:  # two connections claimed "active" at once
            await self.session.rollback()
            raise ConflictError("Another connection was activated first. Try again.") from exc
        await self.session.refresh(connection)
        return ConnectionRead.model_validate(connection)

    async def update(self, connection_id: uuid.UUID, payload: ConnectionUpdate) -> ConnectionRead:
        connection = await self._get(connection_id)
        changed_target = False
        if payload.name is not None:
            connection.name = payload.name
        if payload.base_url is not None and payload.base_url != connection.base_url:
            connection.base_url = payload.base_url
            changed_target = True
        if payload.model is not None:
            connection.model = payload.model
        if payload.api_key is not None:
            connection.api_key_encrypted = encrypt_password(payload.api_key)
            connection.api_key_preview = mask_key(payload.api_key)
            changed_target = True
        if changed_target:
            # A new address or key has not been checked yet.
            connection.last_checked_at = None
            connection.last_check_ok = None
        connection.updated_by_id = self.actor.id
        await self.session.commit()
        await self.session.refresh(connection)
        return ConnectionRead.model_validate(connection)

    async def _make_only_active(self, connection: AiConnection) -> None:
        # Switch the old one off first: the unique index allows one active row.
        await self.session.execute(
            update(AiConnection)
            .where(AiConnection.is_active.is_(True), AiConnection.id != connection.id)
            .values(is_active=False)
        )
        connection.is_active = True
        connection.updated_by_id = self.actor.id

    async def activate(self, connection_id: uuid.UUID) -> ConnectionRead:
        connection = await self._get(connection_id)
        try:
            await self._make_only_active(connection)
            await self.session.commit()
        except IntegrityError as exc:  # two admins activating at the same moment
            await self.session.rollback()
            raise ConflictError("Another connection was activated first. Try again.") from exc
        await self.session.refresh(connection)
        return ConnectionRead.model_validate(connection)

    async def deactivate(self, connection_id: uuid.UUID) -> ConnectionRead:
        connection = await self._get(connection_id)
        connection.is_active = False
        connection.updated_by_id = self.actor.id
        await self.session.commit()
        await self.session.refresh(connection)
        return ConnectionRead.model_validate(connection)

    async def delete(self, connection_id: uuid.UUID) -> None:
        connection = await self._get(connection_id)
        await self.session.delete(connection)
        await self.session.commit()

    async def check(self, connection_id: uuid.UUID) -> AITestResult:
        """Check a saved connection with its stored key and remember the outcome."""
        connection = await self._get(connection_id)
        result = await probe(connection.base_url, decrypt_key(connection))
        connection.last_checked_at = datetime.now(UTC)
        connection.last_check_ok = result.ok
        await self.session.commit()
        return result

    async def test(self, payload: AITestRequest) -> AITestResult:
        """Check an address and key before saving; a blank key uses the saved one."""
        api_key = payload.api_key
        base_url = payload.base_url
        if not api_key and payload.connection_id is not None:
            connection = await self._get(payload.connection_id)
            api_key = decrypt_key(connection)
            base_url = base_url or connection.base_url
        return await probe(base_url, api_key)
