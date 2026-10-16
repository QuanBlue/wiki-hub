"""How the embedding source in the settings row becomes the configuration the
indexer and search use - for each of the three sources, and for "off"."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.ai_connection import AiConnection
from app.models.ai_embedding_settings import AiEmbeddingSettings
from app.modules.admin_mail.crypto import encrypt_password
from app.modules.ai.config import AIConfig, load_config

pytestmark = pytest.mark.integration


def _connection(active: bool = True) -> AiConnection:
    return AiConnection(
        name="chat",
        base_url="http://chat.test/v1",
        model="chat-model",
        api_key_encrypted=encrypt_password("chat-key"),
        api_key_preview="****",
        is_active=active,
    )


async def test_nothing_configured_is_off(session: AsyncSession) -> None:
    config = await load_config(session)

    assert not config.ready and not config.embeddings_ready


async def test_the_provider_source_uses_the_active_connections_own_endpoint(
    session: AsyncSession,
) -> None:
    session.add(_connection())
    session.add(AiEmbeddingSettings(id=1, source="provider", model="embed-1"))
    await session.flush()

    config = await load_config(session)

    assert config.embeddings_ready and config.ready
    assert (config.embed_url, config.embed_key) == ("http://chat.test/v1", "chat-key")
    assert config.embedding_source == "provider" and config.embedding_model == "embed-1"


async def test_the_provider_source_is_off_without_an_active_provider(session: AsyncSession) -> None:
    session.add(_connection(active=False))
    session.add(AiEmbeddingSettings(id=1, source="provider", model="embed-1"))
    await session.flush()

    config = await load_config(session)

    assert not config.embeddings_ready


async def test_another_endpoint_works_with_no_chat_provider_at_all(session: AsyncSession) -> None:
    session.add(
        AiEmbeddingSettings(
            id=1,
            source="custom",
            base_url="http://embed.test/v1",
            api_key_encrypted=encrypt_password("embed-key"),
            api_key_preview="****",
            model="bge-m3",
        )
    )
    await session.flush()

    config = await load_config(session)

    assert not config.ready  # no chat provider...
    assert config.embeddings_ready  # ...yet semantic search still has its own endpoint
    assert (config.embed_url, config.embed_key) == ("http://embed.test/v1", "embed-key")


async def test_another_endpoint_wins_over_the_chat_provider(session: AsyncSession) -> None:
    session.add(_connection())
    session.add(
        AiEmbeddingSettings(
            id=1,
            source="custom",
            base_url="http://embed.test/v1",
            api_key_encrypted=encrypt_password("embed-key"),
            model="bge-m3",
        )
    )
    await session.flush()

    config = await load_config(session)

    assert (config.base_url, config.api_key) == ("http://chat.test/v1", "chat-key")
    assert (config.embed_url, config.embed_key) == ("http://embed.test/v1", "embed-key")


async def test_ollama_points_at_the_container_with_a_placeholder_key(session: AsyncSession) -> None:
    session.add(AiEmbeddingSettings(id=1, source="ollama", model="bge-m3"))
    await session.flush()

    config = await load_config(session)

    assert config.embeddings_ready
    assert config.embed_url == settings.ollama_url.rstrip("/") + "/v1"
    assert config.embed_key == "ollama"


async def test_a_blank_model_or_an_unreadable_key_leaves_semantic_search_off(
    session: AsyncSession,
) -> None:
    session.add(
        AiEmbeddingSettings(
            id=1,
            source="custom",
            base_url="http://embed.test/v1",
            api_key_encrypted="not-decryptable",
            model="bge-m3",
        )
    )
    await session.flush()
    # The key can no longer be read (the encryption key changed): off, not broken.
    assert not (await load_config(session)).embeddings_ready

    row = await session.get(AiEmbeddingSettings, 1)
    row.api_key_encrypted = encrypt_password("k")
    row.model = ""
    await session.flush()
    assert not (await load_config(session)).embeddings_ready


def test_the_chat_endpoint_is_the_fallback_when_no_embedding_endpoint_is_set() -> None:
    config = AIConfig(True, "http://chat.test/v1", "key", "m", embedding_model="e")
    assert (config.embed_url, config.embed_key) == ("http://chat.test/v1", "key")
    other = AIConfig(
        True, "http://chat.test/v1", "key", "m", "e", "http://other.test/v1", "other-key"
    )
    assert (other.embed_url, other.embed_key) == ("http://other.test/v1", "other-key")


async def test_saved_tuning_reaches_the_config_the_indexer_and_search_use(
    session: AsyncSession,
) -> None:
    session.add(
        AiEmbeddingSettings(
            id=1,
            source="ollama",
            model="bge-m3",
            index_batch=7,
            embed_batch_size=3,
            min_similarity=0.55,
            margin=0.05,
            ollama_cpus=4,
        )
    )
    await session.flush()

    config = await load_config(session)

    assert config.tuning.index_batch == 7 and config.tuning.embed_batch_size == 3
    assert config.tuning.min_similarity == 0.55 and config.tuning.margin == 0.05
    assert config.tuning.ollama_cpus == 4
    # Not overridden: the default.
    assert config.tuning.max_chunks_per_page == settings.search_max_chunks_per_page


async def test_tuning_applies_even_while_semantic_search_is_off(session: AsyncSession) -> None:
    session.add(AiEmbeddingSettings(id=1, source="provider", model="", index_batch=9))
    await session.flush()

    config = await load_config(session)

    assert not config.embeddings_ready
    assert config.tuning.index_batch == 9
