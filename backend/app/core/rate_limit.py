"""Fixed-window rate limiting backed by Redis.

Deliberately small: the only endpoint that needs throttling today is login.
The limiter **fails open** - if Redis is unreachable the request is allowed
rather than locking every user out of the instance over a cache outage. That
trade-off is appropriate for brute-force protection, not for quota enforcement.
"""

from __future__ import annotations

import re

from redis.exceptions import RedisError

from app.core.exceptions import RateLimitedError
from app.core.logging import get_logger
from app.core.redis import get_redis

logger = get_logger(__name__)

_RULE_RE = re.compile(r"^\s*(\d+)\s*/\s*(second|minute|hour|day)\s*$", re.IGNORECASE)
_WINDOW_SECONDS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}


def parse_rule(rule: str) -> tuple[int, int]:
    """Turn ``"10/minute"`` into ``(10, 60)``."""
    match = _RULE_RE.match(rule)
    if not match:
        raise ValueError(f"Invalid rate limit rule: {rule!r}. Expected e.g. '10/minute'.")
    return int(match.group(1)), _WINDOW_SECONDS[match.group(2).lower()]


async def enforce(key: str, rule: str) -> None:
    """Count one hit against ``key``; raise :class:`RateLimitedError` when over."""
    limit, window = parse_rule(rule)
    redis_key = f"ratelimit:{key}"

    try:
        redis = get_redis()
        pipe = redis.pipeline()
        pipe.incr(redis_key)
        pipe.expire(redis_key, window, nx=True)  # only set TTL on the first hit
        current, _ = await pipe.execute()
    except (RedisError, OSError) as exc:
        logger.warning("rate_limit_unavailable", key=key, error=str(exc))
        return

    if int(current) > limit:
        raise RateLimitedError(
            "Too many attempts. Please wait a moment and try again.",
            details={"limit": limit, "window_seconds": window},
        )
