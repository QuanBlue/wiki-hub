"""How many AI calls a person may make an hour - set in Administration > AI assistant.

The environment (``WIKIHUB_AI_RATE_LIMIT``, ``WIKIHUB_AI_TRANSLATE_RATE_LIMIT``) gives the
defaults; an administrator can override them, and the override is stored on the site settings
row. Every AI call checks the limit, so it is read once per ``_CACHE_SECONDS`` per process
rather than every time; a change made here applies to this process at once and to the others
within that time.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.rate_limit import parse_rule
from app.db.session import session_scope
from app.models.site_settings import SINGLETON_ID, SiteSettings

_CACHE_SECONDS = 30.0
#: The range an administrator may choose, per hour.
MINIMUM = 1
MAXIMUM = 100_000


@dataclass(frozen=True, slots=True)
class Limits:
    #: What an administrator set (``None``: the default applies).
    requests_per_hour: int | None
    translate_requests_per_hour: int | None

    @property
    def requests_rule(self) -> str:
        if self.requests_per_hour:
            return f"{self.requests_per_hour}/hour"
        return settings.ai_rate_limit

    @property
    def translate_rule(self) -> str:
        if self.translate_requests_per_hour:
            return f"{self.translate_requests_per_hour}/hour"
        return settings.ai_translate_rate_limit


_cache: tuple[float, Limits] | None = None


def per_hour(rule: str) -> int:
    """``"60/hour"`` or ``"1/minute"`` as calls an hour, for showing the default."""
    count, window = parse_rule(rule)
    return round(count * 3600 / window)


async def read(session: AsyncSession) -> Limits:
    try:
        row = (
            await session.execute(
                select(
                    SiteSettings.ai_requests_per_hour, SiteSettings.ai_translate_requests_per_hour
                ).where(SiteSettings.id == SINGLETON_ID)
            )
        ).first()
    except SQLAlchemyError:
        # A database not migrated yet: the defaults apply.
        await session.rollback()
        row = None
    return Limits(*(row or (None, None)))


async def current() -> Limits:
    """The limits now in force, from a short-lived cache."""
    global _cache
    now = time.monotonic()
    if _cache is not None and now - _cache[0] < _CACHE_SECONDS:
        return _cache[1]
    async with session_scope() as session:
        limits = await read(session)
    _cache = (now, limits)
    return limits


def forget() -> None:
    """Drop the cached limits (they were just changed)."""
    global _cache
    _cache = None


async def ai_rate_limit() -> str:
    """The rule for one person's AI calls, such as ``"60/hour"``."""
    try:
        return (await current()).requests_rule
    except Exception:  # noqa: BLE001 - never let reading a setting stop a question
        return settings.ai_rate_limit


async def ai_translate_rate_limit() -> str:
    """The rule for the AI calls of one person's document translations."""
    try:
        return (await current()).translate_rule
    except Exception:  # noqa: BLE001
        return settings.ai_translate_rate_limit
