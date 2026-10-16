"""Shared stand-in for the model gateway used by the AI service tests."""

from __future__ import annotations

from typing import Any

from app.modules.ai import service as service_module
from app.modules.ai.client import ChatReply


def fake_chat(monkeypatch: Any, chat: Any) -> None:
    """Route the service's model calls to ``chat(config, messages, **kw) -> str``."""

    async def with_usage(config: Any, messages: Any, **kw: Any) -> ChatReply:
        return ChatReply(await chat(config, messages, **kw), None)

    monkeypatch.setattr(service_module, "chat_with_usage", with_usage)
