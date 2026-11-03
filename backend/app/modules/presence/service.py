from __future__ import annotations

import json
import time
import uuid
from datetime import UTC, datetime
from typing import Literal

from app.core.logging import get_logger
from app.core.redis import get_redis
from app.models.user import User
from app.modules.presence.schemas import PresenceUser

logger = get_logger(__name__)

_PRESENCE_KEY = "wikihub:presence:page:{page_id}"
_EVENT_CHANNEL = "wikihub:events:page:{page_id}"
_TTL_SECONDS = 40

# In-memory fallback if Redis is unavailable
_memory_presence: dict[str, dict[str, dict]] = {}


class PresenceService:
    @staticmethod
    def _user_dict(user: User, state: Literal["viewing", "editing"]) -> dict:
        avatar_url = getattr(user, "avatar_url", None)
        if not avatar_url and getattr(user, "avatar_object_key", None):
            avatar_url = f"/api/v1/users/{user.id}/avatar"

        return {
            "user_id": str(user.id),
            "username": user.username,
            "full_name": (user.full_name or "").strip() or user.username,
            "avatar_url": avatar_url,
            "state": state,
            "last_seen": datetime.now(UTC).isoformat(),
            "timestamp": time.time(),
        }

    @classmethod
    async def get_active_users(cls, page_id: uuid.UUID) -> list[PresenceUser]:
        page_key = str(page_id)
        now = time.time()
        users: list[PresenceUser] = []

        try:
            redis = get_redis()
            data = await redis.hgetall(_PRESENCE_KEY.format(page_id=page_key))
            expired_fields: list[str] = []
            for uid, raw in data.items():
                try:
                    parsed = json.loads(raw)
                    if now - parsed.get("timestamp", 0) > _TTL_SECONDS:
                        expired_fields.append(uid)
                    else:
                        users.append(
                            PresenceUser(
                                user_id=uuid.UUID(parsed["user_id"]),
                                username=parsed["username"],
                                full_name=parsed["full_name"],
                                avatar_url=parsed.get("avatar_url"),
                                state=parsed.get("state", "viewing"),
                                last_seen=datetime.fromisoformat(parsed["last_seen"]),
                            )
                        )
                except Exception:
                    expired_fields.append(uid)

            if expired_fields:
                await redis.hdel(_PRESENCE_KEY.format(page_id=page_key), *expired_fields)
        except Exception as e:
            logger.debug("redis_get_active_users_fallback", error=str(e))
            page_dict = _memory_presence.get(page_key, {})
            for uid, parsed in list(page_dict.items()):
                if now - parsed.get("timestamp", 0) > _TTL_SECONDS:
                    page_dict.pop(uid, None)
                else:
                    users.append(
                        PresenceUser(
                            user_id=uuid.UUID(parsed["user_id"]),
                            username=parsed["username"],
                            full_name=parsed["full_name"],
                            avatar_url=parsed.get("avatar_url"),
                            state=parsed.get("state", "viewing"),
                            last_seen=datetime.fromisoformat(parsed["last_seen"]),
                        )
                    )

        return sorted(users, key=lambda u: u.username.lower())

    @classmethod
    async def heartbeat(
        cls, page_id: uuid.UUID, user: User, editing: bool = False
    ) -> list[PresenceUser]:
        page_key = str(page_id)
        state: Literal["viewing", "editing"] = "editing" if editing else "viewing"
        payload = cls._user_dict(user, state)
        user_key = str(user.id)

        try:
            redis = get_redis()
            r_key = _PRESENCE_KEY.format(page_id=page_key)
            await redis.hset(r_key, user_key, json.dumps(payload))
            await redis.expire(r_key, _TTL_SECONDS * 2)

            channel = _EVENT_CHANNEL.format(page_id=page_key)
            await redis.publish(
                channel,
                json.dumps({
                    "type": "presence_update",
                    "user": payload,
                }),
            )
        except Exception as e:
            logger.debug("redis_heartbeat_fallback", error=str(e))
            if page_key not in _memory_presence:
                _memory_presence[page_key] = {}
            _memory_presence[page_key][user_key] = payload

        return await cls.get_active_users(page_id)

    @classmethod
    async def leave(cls, page_id: uuid.UUID, user_id: uuid.UUID) -> None:
        page_key = str(page_id)
        user_key = str(user_id)
        try:
            redis = get_redis()
            r_key = _PRESENCE_KEY.format(page_id=page_key)
            await redis.hdel(r_key, user_key)
            channel = _EVENT_CHANNEL.format(page_id=page_key)
            await redis.publish(
                channel,
                json.dumps({
                    "type": "presence_leave",
                    "user_id": user_key,
                }),
            )
        except Exception as e:
            logger.debug("redis_leave_fallback", error=str(e))
            if page_key in _memory_presence:
                _memory_presence[page_key].pop(user_key, None)

    @classmethod
    async def broadcast_page_saved(
        cls, page_id: uuid.UUID, actor: User, saved_at: datetime, title: str
    ) -> None:
        page_key = str(page_id)
        payload = {
            "type": "page_saved",
            "actor_id": str(actor.id),
            "actor_name": (actor.full_name or "").strip() or actor.username,
            "saved_at": saved_at.isoformat(),
            "title": title,
        }
        try:
            redis = get_redis()
            channel = _EVENT_CHANNEL.format(page_id=page_key)
            await redis.publish(channel, json.dumps(payload))
        except Exception as e:
            logger.debug("redis_publish_saved_failed", error=str(e))
