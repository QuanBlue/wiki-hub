"""Thin client for an OpenAI-compatible chat gateway.

The model runs remotely, so this only does HTTP. A process-wide semaphore keeps
the number of calls in flight small so a burst of users cannot pile requests
onto this host or the gateway.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

import httpx

from app.core.config import settings
from app.core.exceptions import ServiceUnavailableError
from app.core.logging import get_logger
from app.modules.ai.config import AIConfig

logger = get_logger(__name__)

_semaphore: asyncio.Semaphore | None = None

#: Extra attempts, each with a doubled budget, when a reply was cut off.
_RETRIES = 1

#: A busy or briefly unreachable gateway is worth a couple more tries: pauses
#: (seconds) before each retry, so at most three attempts in all.
_BACKOFF = (1.0, 2.0)
_TRANSIENT_STATUS = frozenset({429, 500, 502, 503, 504})


def _gate() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(max(1, settings.ai_max_concurrency))
    return _semaphore


@dataclass(frozen=True)
class Usage:
    """Tokens a request spent, as the gateway reported them."""

    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def __add__(self, other: Usage) -> Usage:
        return Usage(
            self.prompt_tokens + other.prompt_tokens,
            self.completion_tokens + other.completion_tokens,
        )


def parse_usage(raw: object) -> Usage | None:
    """The gateway's ``usage`` object, or ``None`` when it sent nothing usable."""
    if not isinstance(raw, dict):
        return None
    prompt = raw.get("prompt_tokens")
    completion = raw.get("completion_tokens")
    if isinstance(prompt, bool) or isinstance(completion, bool):
        return None
    if not isinstance(prompt, int) and not isinstance(completion, int):
        return None
    return Usage(
        max(0, prompt) if isinstance(prompt, int) else 0,
        max(0, completion) if isinstance(completion, int) else 0,
    )


@dataclass(frozen=True)
class ChatReply:
    text: str
    #: ``None`` when the gateway did not report usage - nothing is guessed.
    usage: Usage | None


async def _complete(
    config: AIConfig, messages: list[dict[str, str]], max_tokens: int
) -> tuple[dict, object]:
    url = config.base_url.rstrip("/") + "/chat/completions"
    body: dict = {
        "model": config.model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.2,
        # Reasoning models otherwise think for most of the budget, which is slow
        # (and is what makes a long page time out or get cut off). Models without
        # the setting ignore it; a gateway that rejects it is retried without.
        "reasoning_effort": "low",
    }
    headers = {"Authorization": f"Bearer {config.api_key}"}
    transient = 0
    while True:
        status: int | None = None
        retryable = False
        try:
            async with _gate(), httpx.AsyncClient(timeout=settings.ai_timeout_seconds) as http:
                response = await http.post(url, json=body, headers=headers)
            if response.status_code in (400, 422) and "reasoning_effort" in body:
                del body["reasoning_effort"]
                logger.info("ai_reasoning_hint_rejected", status=response.status_code)
                continue
            response.raise_for_status()
            payload = response.json()
            return payload["choices"][0], payload.get("usage")
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            retryable = status in _TRANSIENT_STATUS
            error = type(exc).__name__
        except (httpx.ConnectError, httpx.RemoteProtocolError) as exc:
            retryable = True
            error = type(exc).__name__
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            error = type(exc).__name__

        # Never log the key or the prompt - only what failed.
        logger.warning("ai_request_failed", error=error, status=status, attempt=transient + 1)
        if retryable and transient < len(_BACKOFF):
            await asyncio.sleep(_BACKOFF[transient])
            transient += 1
            continue
        raise ServiceUnavailableError("The AI assistant could not answer right now.")


async def chat_with_usage(
    config: AIConfig, messages: list[dict[str, str]], *, max_tokens: int = 2000
) -> ChatReply:
    """Return the assistant's reply and the tokens it cost, or raise ``ServiceUnavailableError``.

    ``max_tokens`` has to leave room for the model's hidden reasoning: a
    reasoning model that spends the budget thinking returns no content, or an
    answer cut off mid-sentence. Either way the request is repeated once with
    double the budget before giving up on a complete answer; the usage of both
    attempts is added up, since both were paid for.
    """
    if not config.ready:
        raise ServiceUnavailableError("The AI assistant is not enabled.")

    choice, raw = await _complete(config, messages, max_tokens)
    usage = parse_usage(raw)
    for _ in range(_RETRIES):
        if choice.get("finish_reason") != "length":
            break
        logger.info("ai_reply_cut_off", max_tokens=max_tokens)
        max_tokens *= 2
        choice, raw = await _complete(config, messages, max_tokens)
        again = parse_usage(raw)
        if again is not None:
            usage = again if usage is None else usage + again

    text = (choice.get("message") or {}).get("content") or ""
    if not text.strip():
        logger.warning("ai_empty_reply", finish_reason=choice.get("finish_reason"))
        raise ServiceUnavailableError("The AI assistant returned no answer. Please try again.")
    return ChatReply(text.strip(), usage)


async def chat(config: AIConfig, messages: list[dict[str, str]], *, max_tokens: int = 2000) -> str:
    """Like :func:`chat_with_usage`, for callers that only want the text."""
    return (await chat_with_usage(config, messages, max_tokens=max_tokens)).text
