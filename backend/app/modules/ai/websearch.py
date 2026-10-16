"""Looking things up on the internet for the chat, when an administrator allows it.

What leaves the building is one short search query, and nothing else: no page of the wiki,
no name of a person, and what :func:`public_query` finds in it that looks internal (an
address, an e-mail, a host name, a password) is taken out first. What comes back is data -
a title, an address and a few lines - and is treated as untrusted text like any page.
"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass, replace
from urllib.parse import urlsplit

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError, ServiceUnavailableError
from app.core.logging import get_logger
from app.models.ai_web_search_settings import PROVIDERS, AiWebSearchSettings
from app.models.user import User
from app.modules.admin_mail.crypto import (
    CredentialUnreadableError,
    decrypt_password,
    encrypt_password,
)
from app.modules.ai.admin import mask_key
from app.modules.ai.answer import scrub_secrets
from app.modules.ai.config import load_config
from app.modules.ai.webpage import best_excerpt, fetch_text
from app.schemas.ai import WebSearchRead, WebSearchTestResult, WebSearchUpdate

logger = get_logger(__name__)

RESULTS = 5
_TIMEOUT_SECONDS = 12.0
#: Searching through the gateway is a model call that waits for the search to finish.
_GATEWAY_TIMEOUT_SECONDS = 25.0
_QUERY_CHARS = 200
_SNIPPET_CHARS = 600

_IPV4 = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b")
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")
#: Names that only mean something inside a company: ``db01.corp``, ``wiki.internal``, ``nas.lan``.
_INTERNAL_HOST = re.compile(
    r"\b[\w-]+(?:\.[\w-]+)*\.(?:local|lan|internal|corp|intra|home|localdomain)\b", re.IGNORECASE
)
_URL = re.compile(r"\bhttps?://\S+", re.IGNORECASE)
_QUOTES = re.compile(r"[\"'`<>]")


def public_query(text: str) -> str:
    """The query as it may be sent out: what looks internal removed. ``""`` when nothing is left."""
    cleaned = scrub_secrets(text)
    for pattern in (_URL, _EMAIL, _IPV4, _INTERNAL_HOST):
        cleaned = pattern.sub(" ", cleaned)
    cleaned = " ".join(_QUOTES.sub(" ", cleaned).split())[:_QUERY_CHARS].strip()
    # What survives has to still be a question worth asking: words, not leftovers.
    return cleaned if len(re.findall(r"\w{2,}", cleaned)) >= 2 else ""


@dataclass(frozen=True)
class WebConfig:
    enabled: bool
    provider: str
    api_key: str
    #: Only for ``gateway``: the AI connection that does the searching.
    base_url: str = ""
    model: str = ""

    @property
    def ready(self) -> bool:
        if not self.enabled or self.provider not in PROVIDERS or not self.api_key:
            return False
        return bool(self.base_url and self.model) if self.provider == "gateway" else True


@dataclass(frozen=True)
class WebResult:
    title: str
    url: str
    snippet: str
    #: What the page itself says (the part that bears on the query), when it could be read.
    content: str = ""

    @property
    def host(self) -> str:
        return (urlsplit(self.url).hostname or "").removeprefix("www.")


OFF = WebConfig(False, "tavily", "")


def _key_of(row: AiWebSearchSettings) -> str:
    if not row.api_key_encrypted:
        return ""
    try:
        return decrypt_password(row.api_key_encrypted)
    except CredentialUnreadableError:
        logger.warning("ai_web_search_key_unreadable")
        return ""


async def get_row(session: AsyncSession) -> AiWebSearchSettings | None:
    return (await session.execute(select(AiWebSearchSettings))).scalar_one_or_none()


async def load_web_config(session: AsyncSession) -> WebConfig:
    row = await get_row(session)
    if row is None:
        return OFF
    if row.provider == "gateway":
        ai = await load_config(session)
        if not ai.ready:
            return WebConfig(row.enabled, "gateway", "")
        return WebConfig(row.enabled, "gateway", ai.api_key, ai.base_url, ai.model)
    return WebConfig(row.enabled, row.provider, _key_of(row))


# ---------------------------------------------------------------- the search services


def _clean(text: object, limit: int) -> str:
    return " ".join(str(text or "").split())[:limit]


def _results(items: list[dict], title: str, url: str, snippet: str) -> list[WebResult]:
    found = []
    for item in items:
        address = _clean(item.get(url), 500)
        if not address.lower().startswith(("http://", "https://")):
            continue
        found.append(
            WebResult(
                title=_clean(item.get(title), 200) or address,
                url=address,
                snippet=_clean(item.get(snippet), _SNIPPET_CHARS),
            )
        )
    return found[:RESULTS]


#: The gateway's search is a tool the model has to decide to call, over a free search engine that
#: now and then answers nothing: a few tries, then an honest "no results".
_GATEWAY_TRIES = 3
_GATEWAY_PAUSE_SECONDS = 0.8


async def _gateway_search_once(
    http: httpx.AsyncClient, config: WebConfig, query: str
) -> list[WebResult]:
    response = await http.post(
        config.base_url.rstrip("/") + "/chat/completions",
        headers={"Authorization": f"Bearer {config.api_key}"},
        json={
            "model": config.model,
            "messages": [{"role": "user", "content": f"Search the web for: {query}"}],
            "tools": [{"type": "web_search", "web_search": {"enable": True}}],
            # Room for the model to decide to search (a reasoning model thinks first); what it
            # writes afterwards is not wanted.
            "max_tokens": 400,
        },
        timeout=_GATEWAY_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    found: list[WebResult] = []
    for entry in response.json().get("tool_results") or []:
        try:
            output = json.loads(entry.get("output") or "{}")
        except ValueError:
            continue
        if isinstance(output, dict) and output.get("success"):
            found.extend(_results(output.get("results") or [], "title", "url", "snippet"))
    return found[:RESULTS]


async def _gateway_search(
    http: httpx.AsyncClient, config: WebConfig, query: str
) -> list[WebResult]:
    """Search through the AI gateway's own web-search tool.

    The gateway runs the search itself and returns what it found next to the model's reply
    (``tool_results``).
    """
    found: list[WebResult] = []
    for attempt in range(_GATEWAY_TRIES):
        found = await _gateway_search_once(http, config, query)
        if found:
            break
        if attempt + 1 < _GATEWAY_TRIES:
            await asyncio.sleep(_GATEWAY_PAUSE_SECONDS)
    return found


#: How many of the top results are opened, and for how long all of them together may take.
_PAGES_READ = 3
_PAGES_BUDGET_SECONDS = 9.0


async def read_pages(results: list[WebResult], query: str) -> list[WebResult]:
    """The results with the first few pages' text added; unreadable ones stay as they are."""
    if not results:
        return results
    head = results[:_PAGES_READ]
    try:
        texts = await asyncio.wait_for(
            asyncio.gather(*(fetch_text(result.url) for result in head)),
            timeout=_PAGES_BUDGET_SECONDS,
        )
    except TimeoutError:
        return results
    read = [
        replace(result, content=best_excerpt(text, query)) if text else result
        for result, text in zip(head, texts, strict=True)
    ]
    return [*read, *results[_PAGES_READ:]]


async def search_web(config: WebConfig, query: str) -> list[WebResult]:
    """The top results for ``query`` (already made safe with :func:`public_query`)."""
    if not config.ready:
        raise ServiceUnavailableError("Web search is not set up.")
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as http:
            if config.provider == "gateway":
                return await _gateway_search(http, config, query)
            if config.provider == "tavily":
                response = await http.post(
                    "https://api.tavily.com/search",
                    headers={"Authorization": f"Bearer {config.api_key}"},
                    json={"query": query, "max_results": RESULTS, "search_depth": "basic"},
                )
                response.raise_for_status()
                return _results(response.json().get("results") or [], "title", "url", "content")
            if config.provider == "brave":
                response = await http.get(
                    "https://api.search.brave.com/res/v1/web/search",
                    headers={"X-Subscription-Token": config.api_key, "Accept": "application/json"},
                    params={"q": query, "count": RESULTS},
                )
                response.raise_for_status()
                items = (response.json().get("web") or {}).get("results") or []
                return _results(items, "title", "url", "description")
            response = await http.post(
                "https://google.serper.dev/search",
                headers={"X-API-KEY": config.api_key},
                json={"q": query, "num": RESULTS},
            )
            response.raise_for_status()
            return _results(response.json().get("organic") or [], "title", "link", "snippet")
    except (httpx.HTTPError, ValueError, AttributeError) as exc:
        # Never log the query or the key - only what failed.
        logger.warning("ai_web_search_failed", provider=config.provider, error=type(exc).__name__)
        raise ServiceUnavailableError("The web search is not available right now.") from None


# ---------------------------------------------------------------- administration


def _read(row: AiWebSearchSettings | None) -> WebSearchRead:
    if row is None:
        return WebSearchRead(enabled=False, provider="gateway", has_key=False, key_preview="")
    return WebSearchRead(
        enabled=row.enabled,
        provider=row.provider,
        has_key=bool(row.api_key_encrypted),
        key_preview=row.api_key_preview,
    )


class WebSearchSettingsService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user

    async def get(self) -> WebSearchRead:
        return _read(await get_row(self.session))

    async def put(self, payload: WebSearchUpdate) -> WebSearchRead:
        row = await get_row(self.session)
        if row is None:
            row = AiWebSearchSettings(id=1)
            self.session.add(row)
        row.provider = payload.provider
        if payload.api_key is not None:
            key = payload.api_key.strip()
            row.api_key_encrypted = encrypt_password(key) if key else ""
            row.api_key_preview = mask_key(key)
        if payload.enabled and payload.provider != "gateway" and not row.api_key_encrypted:
            raise BadRequestError("Enter the key of the search service before turning it on.")
        row.enabled = payload.enabled
        row.updated_by_id = self.user.id
        await self.session.commit()
        await self.session.refresh(row)
        return _read(row)

    async def test(self, payload: WebSearchUpdate) -> WebSearchTestResult:
        """Try a real search with the key being entered, or with the saved one."""
        row = await get_row(self.session)
        if payload.provider == "gateway":
            ai = await load_config(self.session)
            if not ai.ready:
                return WebSearchTestResult(ok=False, error="Connect an AI endpoint first.")
            config = WebConfig(True, "gateway", ai.api_key, ai.base_url, ai.model)
        else:
            key = (payload.api_key or "").strip() or (_key_of(row) if row else "")
            if not key:
                return WebSearchTestResult(ok=False, error="Enter the key of the search service.")
            config = WebConfig(True, payload.provider, key)
        try:
            found = await search_web(config, "what is the linux kernel")
        except ServiceUnavailableError:
            return WebSearchTestResult(
                ok=False, error="The search service did not accept the key or did not answer."
            )
        return WebSearchTestResult(ok=bool(found), results=len(found))
