"""Which gateway the assistant talks to: the one active connection, if any."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.ai_connection import AiConnection
from app.modules.admin_mail.crypto import CredentialUnreadableError, decrypt_password

logger = get_logger(__name__)


@dataclass(frozen=True)
class AIConfig:
    enabled: bool
    base_url: str
    api_key: str
    model: str

    @property
    def ready(self) -> bool:
        return bool(self.enabled and self.base_url and self.api_key and self.model)


OFF = AIConfig(False, "", "", "")


def decrypt_key(connection: AiConnection) -> str:
    """The connection's key, or ``""`` when it cannot be read any more."""
    try:
        return decrypt_password(connection.api_key_encrypted)
    except CredentialUnreadableError:
        # The encryption key changed; the admin has to enter the key again.
        logger.warning("ai_api_key_unreadable", connection_id=str(connection.id))
        return ""


async def load_config(session: AsyncSession) -> AIConfig:
    """The active connection, or ``OFF`` when none is switched on."""
    active = (
        await session.execute(select(AiConnection).where(AiConnection.is_active.is_(True)))
    ).scalar_one_or_none()
    if active is None:
        return OFF
    return AIConfig(
        enabled=True,
        base_url=active.base_url.strip(),
        api_key=decrypt_key(active),
        model=active.model.strip(),
    )
