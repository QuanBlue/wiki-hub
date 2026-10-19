"""Best-effort writers for the statistics tables.

Each write uses its own short session: telemetry must never be lost because
the request that caused it later rolled back (an AI answer that was paid for but
then rejected), and must never break a request because it failed.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Integer, cast, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.logging import get_logger
from app.db.session import get_session_factory
from app.models.stats import AiUsage, ContentViewDaily, UserActivityDaily

logger = get_logger(__name__)

#: How often an active browser tab sends its heartbeat, and so the most one
#: heartbeat can credit: a person idle for a minute sends none for that minute.
HEARTBEAT_SECONDS = 60


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


async def record_activity(user_id: uuid.UUID) -> None:
    """Mark ``user_id`` active today (UTC) and credit the time since their last heartbeat.

    The credit is the time elapsed since the previous heartbeat, capped at one
    heartbeat interval, so a gap of idleness counts only its last minute and two
    tabs open at once never count more than the wall clock.
    """
    try:
        async with get_session_factory()() as session:
            now = datetime.now(UTC)
            stmt = pg_insert(UserActivityDaily).values(
                user_id=user_id, day=now.date(), active_seconds=0, last_active_at=now
            )
            elapsed = func.extract(
                "epoch", stmt.excluded.last_active_at - UserActivityDaily.last_active_at
            )
            credit = cast(func.least(HEARTBEAT_SECONDS, func.greatest(0, elapsed)), Integer)
            await session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[UserActivityDaily.user_id, UserActivityDaily.day],
                    set_={
                        "active_seconds": UserActivityDaily.active_seconds + credit,
                        "last_active_at": func.greatest(
                            UserActivityDaily.last_active_at, stmt.excluded.last_active_at
                        ),
                    },
                )
            )
            await session.commit()
    except Exception as exc:  # noqa: BLE001 - telemetry must not fail the request
        logger.warning("activity_record_failed", error=type(exc).__name__)
