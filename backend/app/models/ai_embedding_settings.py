"""Where semantic search gets its embeddings from - one setting for the whole wiki.

It is deliberately not a field of an AI connection: the vector index is built once
for the wiki, so switching the *chat* provider must not silently change (and force
a rebuild of) the embedding source.

``source`` is one of:

* ``provider`` - the active AI connection's own endpoint and key;
* ``custom``   - another OpenAI-compatible endpoint (``base_url`` + key) used only
  for embeddings, for providers that offer no embedding model;
* ``ollama``   - the Ollama container WikiHub can start and stop itself.

The key is stored encrypted like an AI connection's, and this table is left out
of backups for the same reason.
"""

from __future__ import annotations

import uuid

from sqlalchemy import Boolean, CheckConstraint, Float, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

SOURCES = ("provider", "custom", "ollama")


class AiEmbeddingSettings(TimestampMixin, Base):
    __tablename__ = "ai_embedding_settings"
    __table_args__ = (CheckConstraint("id = 1", name="ck_ai_embedding_settings_singleton"),)

    #: Always 1: there is exactly one row.
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1, server_default=text("1"))
    source: Mapped[str] = mapped_column(
        String(16), nullable=False, default="provider", server_default="provider"
    )
    base_url: Mapped[str] = mapped_column(
        String(500), nullable=False, default="", server_default=""
    )
    api_key_encrypted: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=""
    )
    api_key_preview: Mapped[str] = mapped_column(
        String(40), nullable=False, default="", server_default=""
    )
    #: Blank means semantic search is off.
    model: Mapped[str] = mapped_column(String(255), nullable=False, default="", server_default="")
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # --- tuning overrides (``None`` = use the built-in default; see ``modules.ai.tuning``) ---
    index_batch: Mapped[int | None] = mapped_column(Integer, nullable=True)
    embed_batch_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_chunks_per_page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    embed_timeout_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    query_timeout_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    min_similarity: Mapped[float | None] = mapped_column(Float, nullable=True)
    margin: Mapped[float | None] = mapped_column(Float, nullable=True)
    ollama_memory_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    ollama_cpus: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ollama_keep_alive: Mapped[str | None] = mapped_column(String(8), nullable=True)
    graph_related_pages: Mapped[int | None] = mapped_column(Integer, nullable=True)
    graph_min_similarity: Mapped[float | None] = mapped_column(Float, nullable=True)

    #: Set by an administrator to stop indexing for a while (to free the server's CPU and
    #: memory); the backlog waits and indexing picks up where it stopped when cleared.
    indexing_paused: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
