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
from app.modules.ai.webpage import fetch_text, next_part, split_excerpt
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
    #: What of the page has not been given yet, in page order: read on with :func:`read_on`.
    unread: str = ""

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
#: How much of a page is given at once. Most articles fit whole; a longer page is given its
#: part that bears on the question first, and the model reads on (:func:`read_on`) when that
#: part does not hold the whole answer. Not the whole of every page at once: five long pages
#: of menus, comments and fine print would crowd the wiki out of what the model can read.
PAGE_CHARS = 10000


def read_on(result: WebResult) -> tuple[WebResult, str]:
    """The next part of a page the model has not read yet, and the result with it marked read."""
    part, rest = next_part(result.unread, PAGE_CHARS)
    return replace(result, unread=rest), part


async def read_pages(results: list[WebResult], query: str) -> list[WebResult]:
    """The results with the first few pages' text added; unreadable ones stay as they are."""
    if not results:
        return results
    head = results[:_PAGES_READ]

    async def text_of(result: WebResult) -> str:
        # A result that came with its text (a free source's) has nothing more to read.
        return "" if result.content else await fetch_text(result.url)

    try:
        texts = await asyncio.wait_for(
            asyncio.gather(*(text_of(result) for result in head)),
            timeout=_PAGES_BUDGET_SECONDS,
        )
    except TimeoutError:
        return results
    read = []
    for result, text in zip(head, texts, strict=True):
        if text:
            excerpt, unread = split_excerpt(text, query, PAGE_CHARS)
            result = replace(result, content=excerpt, unread=unread)
        read.append(result)
    return [*read, *results[_PAGES_READ:]]


async def search_web(config: WebConfig, query: str, *, fallback: bool = True) -> list[WebResult]:
    """The top results for ``query`` (already made safe with :func:`public_query`).

    When the configured service finds nothing - the free one behind a gateway does now and then,
    for hours, once it has been asked a lot - the free sources of :func:`free_sources` are tried,
    so a question about the news is not left unanswered. ``fallback=False`` is for testing the
    configured service alone.
    """
    if not config.ready:  # off, or no key: nothing was asked for, so nothing is borrowed
        raise ServiceUnavailableError("Web search is not set up.")
    failure: ServiceUnavailableError | None = None
    try:
        found = await _configured_search(config, query)
    except ServiceUnavailableError as exc:
        found, failure = [], exc
    if fallback and config.provider == "gateway":
        # The free engine behind a gateway answers, now and then, with whatever it has -
        # dictionary entries for "so", lottery results - so what it returns is checked.
        found = _about(found, query)
    enough = _ENOUGH_FROM_A_GATEWAY if config.provider == "gateway" else _ENOUGH
    if len(found) >= enough or not fallback:
        if failure is not None:
            raise failure
        return found
    extra = await free_sources(query)
    if extra:
        logger.info("ai_web_search_fallback", provider=config.provider, results=len(extra))
    elif failure is not None and not found:
        raise failure
    known = {result.url for result in found}
    return [*found, *(result for result in extra if result.url not in known)][:RESULTS]


#: How many results a search needs before the free sources are left alone. A paid service that
#: finds one page has found it; the free engine behind a gateway that finds one has most likely
#: found one page and junk, so it gets help from the free sources unless it has two good ones.
_ENOUGH = 1
_ENOUGH_FROM_A_GATEWAY = 2
_WORD = re.compile(r"[a-z0-9]+")
#: Words that say nothing about what a page is about, in the two languages people ask in.
_FILLER = frozenset(
    [
        "the",
        "and",
        "for",
        "with",
        "what",
        "how",
        "does",
        "which",
        "are",
        "was",
        "were",
        "this",
        "that",
        "from",
        "have",
        "has",
        "into",
        "about",
        "vs",
        "gi",
        "la",
        "va",
        "cua",
        "co",
        "khong",
        "nao",
        "nhu",
        "cho",
        "voi",
        "cac",
        "nhung",
        "mot",
        "nay",
        "trong",
        "duoc",
        "khac",
        "sao",
    ]
)


def _words(text: str) -> set[str]:
    from app.modules.ai.assistant_context import fold

    return {
        w for w in _WORD.findall(fold(text)) if w not in _FILLER and (len(w) >= 3 or w.isdigit())
    }


def _about(results: list[WebResult], query: str) -> list[WebResult]:
    """The results that are about the query: those whose title or line hold half of its words."""
    wanted = _words(query)
    if not wanted:
        return results
    need = max(1, (len(wanted) + 1) // 2)
    return [
        result
        for result in results
        if len(wanted & _words(f"{result.title} {result.snippet} {result.content}")) >= need
    ]


async def _configured_search(config: WebConfig, query: str) -> list[WebResult]:
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


# ------------------------------------------------------------------ free sources

#: Needs no key and no account: Google News' public feed (what is being reported, with the
#: day and the paper) and Wikipedia (what a thing is). Only the search query leaves, as ever.
_FREE_TIMEOUT_SECONDS = 8.0
_NEWS_RESULTS = 2
_WIKI_RESULTS = 1
_NEWS_URL = "https://news.google.com/rss/search"
_WIKI_URL = "https://{lang}.wikipedia.org/w/api.php"
_USER_AGENT = "Mozilla/5.0 (compatible; WikiHubReader/1.0)"
#: Letters only Vietnamese uses, to pick the language of the feed and of the encyclopedia.
_VIETNAMESE = re.compile(
    "[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]", re.IGNORECASE
)
_DOCTYPE = re.compile(r"<!(?:DOCTYPE|ENTITY)", re.IGNORECASE)


def _is_vietnamese(query: str) -> bool:
    return bool(_VIETNAMESE.search(query))


def _text_of_html(markup: str) -> str:
    from bs4 import BeautifulSoup  # lxml is already a dependency of the page reader

    return _clean(BeautifulSoup(markup or "", "lxml").get_text(" "), _SNIPPET_CHARS)


def parse_news(feed: str) -> list[WebResult]:
    """The items of a Google News RSS feed: headline, paper, day and what it says."""
    if _DOCTYPE.search(feed[:2000]):  # a feed has none; one with a DTD is not one to parse
        return []
    from xml.etree import ElementTree

    try:
        root = ElementTree.fromstring(feed)  # noqa: S314
    except ElementTree.ParseError:
        return []
    found: list[WebResult] = []
    seen: set[str] = set()
    for item in root.iter("item"):
        title = _clean(item.findtext("title"), 200)
        link = _clean(item.findtext("link"), 500)
        if not title or not link.lower().startswith(("http://", "https://")) or title in seen:
            continue
        seen.add(title)
        paper = _clean(item.findtext("source"), 80)
        day = _clean(item.findtext("pubDate"), 40)
        about = _text_of_html(item.findtext("description") or "")
        # The same headline is repeated in the description: say it once.
        about = " ".join(about.replace(title, "").split()).strip("- ")
        said = " | ".join(part for part in (paper, day, about) if part)
        found.append(WebResult(title=title, url=link, snippet=said[:_SNIPPET_CHARS], content=said))
        if len(found) >= _NEWS_RESULTS:
            break
    return found


async def _news(http: httpx.AsyncClient, query: str) -> list[WebResult]:
    params = (
        {"q": query, "hl": "vi", "gl": "VN", "ceid": "VN:vi"}
        if _is_vietnamese(query)
        else {"q": query, "hl": "en", "gl": "US", "ceid": "US:en"}
    )
    response = await http.get(_NEWS_URL, params=params, timeout=_FREE_TIMEOUT_SECONDS)
    response.raise_for_status()
    return parse_news(response.text)


async def _encyclopedia(http: httpx.AsyncClient, query: str) -> list[WebResult]:
    lang = "vi" if _is_vietnamese(query) else "en"
    response = await http.get(
        _WIKI_URL.format(lang=lang),
        params={
            "action": "query",
            "generator": "search",
            "gsrsearch": query,
            "gsrlimit": _WIKI_RESULTS,
            "prop": "extracts|info",
            "inprop": "url",
            "exintro": 1,
            "explaintext": 1,
            "exchars": 1200,
            "format": "json",
        },
        headers={"User-Agent": _USER_AGENT},
        timeout=_FREE_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    pages = (response.json().get("query") or {}).get("pages") or {}
    ordered = sorted(pages.values(), key=lambda page: page.get("index", 99))
    found = []
    for page in ordered:
        extract = _clean(page.get("extract"), 1200)
        address = _clean(page.get("fullurl"), 500)
        if extract and address.lower().startswith("https://"):
            found.append(
                WebResult(
                    title=_clean(page.get("title"), 200) + " - Wikipedia",
                    url=address,
                    snippet=extract[:_SNIPPET_CHARS],
                    content=extract,
                )
            )
    return found


_WEB_RESULTS = 4
_BING_URL = "https://www.bing.com/search"
_DDG_URL = "https://lite.duckduckgo.com/lite/"
#: A browser's name: these two answer a program that says it is one, and the page reader's own
#: name gets nothing from them.
_BROWSER = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0 Safari/537.36"
)


def parse_web(feed: str) -> list[WebResult]:
    """The results of a Bing RSS search: title, address and the line under it."""
    if _DOCTYPE.search(feed[:2000]):
        return []
    from xml.etree import ElementTree

    try:
        root = ElementTree.fromstring(feed)  # noqa: S314
    except ElementTree.ParseError:
        return []
    items = [
        {
            "title": item.findtext("title"),
            "link": item.findtext("link"),
            "about": item.findtext("description"),
        }
        for item in root.iter("item")
    ]
    return _results(items, "title", "link", "about")[:_WEB_RESULTS]


def parse_duckduckgo(markup: str) -> list[WebResult]:
    """The results of DuckDuckGo's plain-HTML page: links with the snippet after each."""
    from urllib.parse import parse_qs

    from bs4 import BeautifulSoup

    soup = BeautifulSoup(markup, "lxml")
    snippets = [
        _clean(cell.get_text(" "), _SNIPPET_CHARS) for cell in soup.select(".result-snippet")
    ]
    items = []
    for index, link in enumerate(soup.select("a.result-link")):
        href = str(link.get("href") or "")
        if "uddg=" in href:  # DuckDuckGo's own redirect: the address is in it
            href = (parse_qs(urlsplit(href).query).get("uddg") or [""])[0]
        elif href.startswith("//"):
            href = "https:" + href
        items.append(
            {
                "title": link.get_text(" "),
                "link": href,
                "about": snippets[index] if index < len(snippets) else "",
            }
        )
    return _results(items, "title", "link", "about")[:_WEB_RESULTS]


async def _web(http: httpx.AsyncClient, query: str) -> list[WebResult]:
    """Pages from the open web: Bing's RSS, or DuckDuckGo's plain page when Bing gives none."""
    vietnamese = _is_vietnamese(query)
    headers = {"User-Agent": _BROWSER, "Accept-Language": "vi,en;q=0.8" if vietnamese else "en"}
    try:
        response = await http.get(
            _BING_URL,
            params={
                "q": query,
                "format": "rss",
                "setlang": "vi" if vietnamese else "en",
                "cc": "VN" if vietnamese else "US",
            },
            headers=headers,
            timeout=_FREE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        found = parse_web(response.text)
        if found:
            return found
    except httpx.HTTPError:
        logger.warning("ai_web_free_source_failed", error="bing")
    response = await http.post(
        _DDG_URL, data={"q": query}, headers=headers, timeout=_FREE_TIMEOUT_SECONDS
    )
    response.raise_for_status()
    return parse_duckduckgo(response.text)


async def free_sources(query: str) -> list[WebResult]:
    """Pages of the open web, news headlines and encyclopedia entries for ``query``.

    ``[]`` when none answers. Never raises: this is what is tried when everything else came
    back empty. The open web comes first - its pages can be read for their text, and a question
    about a product or a how-to is answered there and not in the news - then the news, then
    the encyclopedia.
    """
    async with httpx.AsyncClient(follow_redirects=True) as http:
        outcomes = await asyncio.gather(
            _web(http, query),
            _news(http, query),
            _encyclopedia(http, query),
            return_exceptions=True,
        )
    found: list[WebResult] = []
    for outcome in outcomes:
        if isinstance(outcome, BaseException):
            logger.warning("ai_web_free_source_failed", error=type(outcome).__name__)
            continue
        found.extend(outcome)
    return found[:RESULTS]


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
            found = await search_web(config, "what is the linux kernel", fallback=False)
        except ServiceUnavailableError:
            return WebSearchTestResult(
                ok=False, error="The search service did not accept the key or did not answer."
            )
        return WebSearchTestResult(ok=bool(found), results=len(found))
