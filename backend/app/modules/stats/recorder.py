"""Best-effort writers for the statistics tables.

Each write uses its own short session: telemetry must never be lost because
the request that caused it later rolled back (an AI answer that was paid for but
then rejected), and must never break a request because it failed.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.logging import get_logger
from app.db.session import get_session_factory
from app.models.stats import AiUsage, ContentViewDaily

logger = get_logger(__name__)


async def record_ai_usage(
    *,
    user_id: uuid.UUID | None,
    feature: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
) -> None:
    try:
        async with get_session_factory()() as session:
            session.add(
                AiUsage(
                    user_id=user_id,
                    feature=feature,
                    model=model[:120],
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    total_tokens=prompt_tokens + completion_tokens,
                )
            )
            await session.commit()
    except Exception as exc:  # noqa: BLE001 - telemetry must not fail the request
        logger.warning("ai_usage_record_failed", error=type(exc).__name__)


async def record_view(entity_type: str, entity_id: uuid.UUID) -> None:
    """Count one open of a page (``"page"``) or space (``"space"``) for today (UTC)."""
    try:
        async with get_session_factory()() as session:
            stmt = pg_insert(ContentViewDaily).values(
                entity_type=entity_type,
                entity_id=entity_id,
                day=datetime.now(UTC).date(),
                views=1,
            )
            await session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[
                        ContentViewDaily.entity_type,
                        ContentViewDaily.entity_id,
                        ContentViewDaily.day,
                    ],
                    set_={"views": ContentViewDaily.views + 1},
                )
            )
            await session.commit()
    except Exception as exc:  # noqa: BLE001 - telemetry must not fail the request
        logger.warning("view_record_failed", error=type(exc).__name__)
