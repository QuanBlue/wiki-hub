"""Which gateway the assistant talks to, and where semantic search gets embeddings.

Chat: the one active connection, if any. Embeddings: the wiki-wide setting in
``ai_embedding_settings`` - the active connection's own endpoint, another
endpoint, or the Ollama container WikiHub runs itself.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.models.ai_connection import AiConnection
from app.models.ai_embedding_settings import AiEmbeddingSettings
from app.modules.admin_mail.crypto import CredentialUnreadableError, decrypt_password
from app.modules.ai.tuning import SPEC_BY_KEY, Tuning, defaults, resolve

logger = get_logger(__name__)

#: Ollama ignores the key, but every request carries one; this is what it sees.
OLLAMA_PLACEHOLDER_KEY = "ollama"


@dataclass(frozen=True)
class AIConfig:
    enabled: bool
    base_url: str
    api_key: str
    model: str
    embedding_model: str = ""
    #: Another endpoint for embeddings; blank means "use ``base_url`` / ``api_key``".
    embedding_base_url: str = ""
    embedding_api_key: str = ""
    #: ``provider``, ``custom`` or ``ollama`` (blank when semantic search is off).
    embedding_source: str = ""
    #: Tunable knobs (admin UI overrides over the built-in defaults).
    tuning: Tuning = field(default_factory=defaults)

    @property
    def ready(self) -> bool:
        return bool(self.enabled and self.base_url and self.api_key and self.model)

    @property
    def embed_url(self) -> str:
        return self.embedding_base_url or self.base_url

    @property
    def embed_key(self) -> str:
        return self.embedding_api_key or self.api_key

    @property
    def embeddings_ready(self) -> bool:
        """Whether text can be turned into vectors (independent of the chat model)."""
        return bool(self.embedding_model and self.embed_url and self.embed_key)


OFF = AIConfig(False, "", "", "")


def decrypt_key(connection: AiConnection) -> str:
    """The connection's key, or ``""`` when it cannot be read any more."""
    try:
        return decrypt_password(connection.api_key_encrypted)
    except CredentialUnreadableError:
        # The encryption key changed; the admin has to enter the key again.
        logger.warning("ai_api_key_unreadable", connection_id=str(connection.id))
        return ""


def decrypt_embedding_key(row: AiEmbeddingSettings) -> str:
    """The embedding endpoint's own key, or ``""`` when none is saved or it is unreadable."""
    if not row.api_key_encrypted:
        return ""
    try:
        return decrypt_password(row.api_key_encrypted)
    except CredentialUnreadableError:
        logger.warning("ai_embedding_key_unreadable")
        return ""


async def get_embedding_settings(session: AsyncSession) -> AiEmbeddingSettings | None:
    return (await session.execute(select(AiEmbeddingSettings))).scalar_one_or_none()


def tuning_overrides(row: AiEmbeddingSettings | None) -> dict[str, object]:
    """The saved overrides of a settings row, ``None`` where the default applies."""
    if row is None:
        return {}
    return {key: getattr(row, key) for key in SPEC_BY_KEY}


async def load_config(session: AsyncSession) -> AIConfig:
    """The active chat connection and the embedding source, resolved together."""
    active = (
        await session.execute(select(AiConnection).where(AiConnection.is_active.is_(True)))
    ).scalar_one_or_none()
    chat = (
        AIConfig(
            enabled=True,
            base_url=active.base_url.strip(),
            api_key=decrypt_key(active),
            model=active.model.strip(),
        )
        if active is not None
        else OFF
    )
    row = await get_embedding_settings(session)
    tuning = resolve(tuning_overrides(row))
    model = row.model.strip() if row else ""
    if row is None or not model:
        return AIConfig(
            enabled=chat.enabled,
            base_url=chat.base_url,
            api_key=chat.api_key,
            model=chat.model,
            tuning=tuning,
        )
    if row.source == "ollama":
        url, key = settings.ollama_url.rstrip("/") + "/v1", OLLAMA_PLACEHOLDER_KEY
    elif row.source == "custom":
        url, key = row.base_url.strip(), decrypt_embedding_key(row)
    else:  # "provider": the active connection's own endpoint, falling back to it in ``embed_*``
        url, key = "", ""
    return AIConfig(
        enabled=chat.enabled,
        base_url=chat.base_url,
        api_key=chat.api_key,
        model=chat.model,
        embedding_model=model,
        embedding_base_url=url,
        embedding_api_key=key,
        embedding_source=row.source,
        tuning=tuning,
    )
