"""Thin client for an OpenAI-compatible chat gateway.

The model runs remotely, so this only does HTTP. A process-wide semaphore keeps
the number of calls in flight small so a burst of users cannot pile requests
onto this host or the gateway.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
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
    config: AIConfig, messages: list[dict[str, str]], max_tokens: int, temperature: float = 0.2
) -> tuple[dict, object]:
    url = config.base_url.rstrip("/") + "/chat/completions"
    body: dict = {
        "model": config.model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
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
    config: AIConfig,
    messages: list[dict[str, str]],
    *,
    max_tokens: int = 2000,
    temperature: float = 0.2,
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

    choice, raw = await _complete(config, messages, max_tokens, temperature)
    usage = parse_usage(raw)
    for _ in range(_RETRIES):
        if choice.get("finish_reason") != "length":
            break
        logger.info("ai_reply_cut_off", max_tokens=max_tokens)
        max_tokens *= 2
        choice, raw = await _complete(config, messages, max_tokens, temperature)
        again = parse_usage(raw)
        if again is not None:
            usage = again if usage is None else usage + again

    text = (choice.get("message") or {}).get("content") or ""
    if not text.strip():
        logger.warning("ai_empty_reply", finish_reason=choice.get("finish_reason"))
        raise ServiceUnavailableError("The AI assistant returned no answer. Please try again.")
    return ChatReply(text.strip(), usage)


def parse_stream_line(line: str) -> tuple[str, Usage | None, bool]:
    """One line of a streamed reply as ``(text, usage, finished)``.

    Anything that is not a ``data:`` line, or whose JSON is not what a gateway sends, yields
    nothing: a stray keep-alive or comment must not break an answer that is arriving fine.
    """
    if not line.startswith("data:"):
        return "", None, False
    payload = line[5:].strip()
    if payload == "[DONE]":
        return "", None, True
    try:
        chunk = json.loads(payload)
    except ValueError:
        return "", None, False
    if not isinstance(chunk, dict):
        return "", None, False
    usage = parse_usage(chunk.get("usage"))
    choices = chunk.get("choices")
    text = ""
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        delta = choices[0].get("delta")
        content = delta.get("content") if isinstance(delta, dict) else None
        # Only the answer itself; a reasoning model's thinking arrives in other fields.
        text = content if isinstance(content, str) else ""
    return text, usage, False


async def chat_stream(
    config: AIConfig, messages: list[dict[str, str]], *, max_tokens: int = 900
) -> AsyncIterator[str | Usage]:
    """The reply as it is written: text pieces, then (when the gateway reports it) the usage.

    A gateway that does not stream sends the whole reply at once; that arrives as one piece.
    A failure before anything was received is retried like :func:`chat_with_usage`; after
    that the answer is already partly shown, so it is raised rather than started over.
    """
    if not config.ready:
        raise ServiceUnavailableError("The AI assistant is not enabled.")
    url = config.base_url.rstrip("/") + "/chat/completions"
    body: dict = {
        "model": config.model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.2,
        "reasoning_effort": "low",
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    headers = {"Authorization": f"Bearer {config.api_key}"}
    transient = 0
    while True:
        received = False
        status: int | None = None
        retryable = False
        try:
            async with (
                _gate(),
                httpx.AsyncClient(timeout=settings.ai_timeout_seconds) as http,
                http.stream("POST", url, json=body, headers=headers) as response,
            ):
                if response.status_code in (400, 422):
                    # An option this gateway does not know: drop it and ask again.
                    rejected = next(
                        (k for k in ("reasoning_effort", "stream_options") if k in body), None
                    )
                    if rejected is not None:
                        await response.aread()
                        del body[rejected]
                        logger.info("ai_stream_hint_rejected", option=rejected)
                        continue
                response.raise_for_status()
                if "json" in response.headers.get("content-type", ""):
                    # Not streamed after all: one complete reply.
                    payload = json.loads(await response.aread())
                    text = (payload["choices"][0].get("message") or {}).get("content") or ""
                    if text:
                        yield text
                    usage = parse_usage(payload.get("usage"))
                    if usage is not None:
                        yield usage
                    return
                async for line in response.aiter_lines():
                    text, usage, finished = parse_stream_line(line)
                    if text:
                        received = True
                        yield text
                    if usage is not None:
                        yield usage
                    if finished:
                        break
                if not received:
                    logger.warning("ai_empty_reply", finish_reason="stream")
                    raise ServiceUnavailableError(
                        "The AI assistant returned no answer. Please try again."
                    )
                return
        except ServiceUnavailableError:
            raise
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            retryable = status in _TRANSIENT_STATUS
            error = type(exc).__name__
        except (httpx.ConnectError, httpx.RemoteProtocolError) as exc:
            retryable = True
            error = type(exc).__name__
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            error = type(exc).__name__

        logger.warning("ai_stream_failed", error=error, status=status, attempt=transient + 1)
        if retryable and not received and transient < len(_BACKOFF):
            await asyncio.sleep(_BACKOFF[transient])
            transient += 1
            continue
        raise ServiceUnavailableError("The AI assistant could not answer right now.")


async def chat(config: AIConfig, messages: list[dict[str, str]], *, max_tokens: int = 2000) -> str:
    """Like :func:`chat_with_usage`, for callers that only want the text."""
    return (await chat_with_usage(config, messages, max_tokens=max_tokens)).text
