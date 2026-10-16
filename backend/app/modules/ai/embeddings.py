"""Text embeddings from an OpenAI-compatible gateway (``POST /embeddings``).

Shares the process-wide concurrency gate with chat so indexing a big wiki in the
background cannot starve interactive AI actions.
"""

from __future__ import annotations

import asyncio
import time
from urllib.parse import urlsplit

import httpx

from app.core.logging import get_logger
from app.modules.ai.client import _BACKOFF, _TRANSIENT_STATUS, _gate
from app.modules.ai.config import AIConfig

logger = get_logger(__name__)

#: Inputs per request by default; gateways commonly cap this around 100 - stay well
#: under. Tunable in the admin UI (a slow CPU does better with fewer).
BATCH_SIZE = 16

#: A request slower than this is logged as a warning, to spot a struggling gateway.
SLOW_REQUEST_SECONDS = 10.0
#: How much of a gateway's error reply is kept in the log.
_DETAIL_CHARS = 300


class EmbeddingError(Exception):
    """The gateway could not embed the text.

    ``permanent`` means retrying the same input cannot help (the gateway
    rejected it), as opposed to being busy or unreachable.
    """

    def __init__(
        self,
        message: str,
        *,
        permanent: bool = False,
        status: int | None = None,
        detail: str = "",
        timed_out: bool = False,
    ) -> None:
        super().__init__(message)
        self.permanent = permanent
        #: The request ran out of time, so a smaller batch may still succeed.
        self.timed_out = timed_out
        #: HTTP status of the gateway's reply, when it gave one.
        self.status = status
        #: What the gateway said was wrong (shortened); for logs, never for users.
        self.detail = detail


def _host(url: str) -> str:
    """Just ``host:port`` of the gateway - enough to tell connections apart in a log.

    Any ``user:password@`` in the address is dropped, never logged.
    """
    parts = urlsplit(url)
    return f"{parts.hostname or ''}:{parts.port}" if parts.port else parts.hostname or ""


def _tokens(payload: object) -> int | None:
    usage = payload.get("usage") if isinstance(payload, dict) else None
    total = usage.get("total_tokens") if isinstance(usage, dict) else None
    return total if isinstance(total, int) and not isinstance(total, bool) else None


async def _post(config: AIConfig, inputs: list[str]) -> list[list[float]]:
    url = config.embed_url.rstrip("/") + "/embeddings"
    body = {"model": config.embedding_model, "input": inputs}
    headers = {"Authorization": f"Bearer {config.embed_key}"}
    # Never log the key or the text - only where, how much, how long and what failed.
    where = {"model": config.embedding_model, "gateway": _host(config.embed_url)}
    attempt = 0
    while True:
        started = time.perf_counter()
        status: int | None = None
        detail = ""
        timed_out = False
        try:
            async with (
                _gate(),
                httpx.AsyncClient(timeout=config.tuning.embed_timeout_seconds) as http,
            ):
                response = await http.post(url, json=body, headers=headers)
            status = response.status_code
            response.raise_for_status()
            payload = response.json()
            rows = sorted(payload["data"], key=lambda row: row["index"])
            vectors = [[float(x) for x in row["embedding"]] for row in rows]
            if len(vectors) != len(inputs) or not all(vectors):
                logger.warning(
                    "ai_embedding_bad_reply",
                    asked=len(inputs),
                    got=len(vectors),
                    empty=sum(1 for v in vectors if not v),
                    **where,
                )
                raise EmbeddingError(
                    "The gateway returned an unexpected number of vectors.",
                    detail=f"asked for {len(inputs)}, got {len(vectors)}",
                )
            seconds = time.perf_counter() - started
            log = logger.warning if seconds >= SLOW_REQUEST_SECONDS else logger.debug
            log(
                "ai_embedding_slow" if seconds >= SLOW_REQUEST_SECONDS else "ai_embedding_ok",
                inputs=len(inputs),
                dimensions=len(vectors[0]),
                tokens=_tokens(payload),
                seconds=round(seconds, 2),
                **where,
            )
            return vectors
        except EmbeddingError:
            raise
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            retryable = status in _TRANSIENT_STATUS
            error = f"HTTP {status}"
            detail = exc.response.text[:_DETAIL_CHARS]
            permanent = not retryable and status not in (401, 403)
        except (httpx.ConnectError, httpx.RemoteProtocolError, httpx.TimeoutException) as exc:
            timed_out = isinstance(exc, httpx.TimeoutException)
            # A timeout on several passages is not retried as-is (it would time out
            # again): the caller splits the batch. One passage cannot be split, so
            # it is retried like any other transient failure.
            retryable = not timed_out or len(inputs) == 1
            permanent, error = False, type(exc).__name__
            detail = str(exc)[:_DETAIL_CHARS]
        except (httpx.HTTPError, KeyError, IndexError, ValueError, TypeError) as exc:
            retryable, permanent, error = False, False, type(exc).__name__
            detail = f"unexpected reply: {str(exc)[:_DETAIL_CHARS]}"

        will_retry = retryable and attempt < len(_BACKOFF)
        logger.warning(
            "ai_embedding_failed",
            error=error,
            status=status,
            detail=detail,
            attempt=attempt + 1,
            will_retry=will_retry,
            inputs=len(inputs),
            seconds=round(time.perf_counter() - started, 2),
            **where,
        )
        if will_retry:
            await asyncio.sleep(_BACKOFF[attempt])
            attempt += 1
            continue
        raise EmbeddingError(
            f"Could not create embeddings ({error}).",
            permanent=permanent,
            status=status,
            detail=detail,
            timed_out=timed_out,
        )


async def _embed_batch(config: AIConfig, texts: list[str]) -> list[list[float]]:
    """One batch, or - when the gateway runs out of time on it - its two halves.

    A slow gateway (an Ollama on a busy CPU) can take minutes for sixteen passages
    yet answer one at a time; halving finds the size it can manage instead of
    failing the whole page for good.
    """
    try:
        return await _post(config, texts)
    except EmbeddingError as exc:
        if not exc.timed_out or len(texts) < 2:
            raise
        middle = len(texts) // 2
        logger.info("ai_embedding_batch_split", from_size=len(texts), to_size=middle)
        return await _embed_batch(config, texts[:middle]) + await _embed_batch(
            config, texts[middle:]
        )


async def embed(config: AIConfig, texts: list[str]) -> list[list[float]]:
    """One vector per text, in order. Raises :class:`EmbeddingError`."""
    if not config.embeddings_ready:
        raise EmbeddingError("No embedding model is configured.")
    vectors: list[list[float]] = []
    size = max(1, config.tuning.embed_batch_size)
    for start in range(0, len(texts), size):
        vectors.extend(await _embed_batch(config, texts[start : start + size]))
    return vectors
