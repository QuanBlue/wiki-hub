"""Reading the web pages a search found, so an answer can quote what is on them.

A search result is a title and a line or two of description: enough to name a page, rarely
enough to answer with ("Cam Ranh weather" says nothing of the temperature). Reading the top
pages gives the facts themselves.

The addresses come from a search service, which is to say from the internet: nothing about
them can be trusted. So a page is fetched only after its host has been resolved and every
address it resolves to has been checked to be public (never the machine itself, the private
network, a cloud metadata address); the request then goes to that very address, so the name
cannot be pointed somewhere else between the check and the request; each redirect is checked
the same way; and the answer is cut short in time and in size.
"""

from __future__ import annotations

import asyncio
import html
import ipaddress
import re
import socket
from urllib.parse import urljoin, urlsplit

import httpx

from app.core.logging import get_logger

logger = get_logger(__name__)

_TIMEOUT_SECONDS = 6.0
_MAX_BYTES = 400_000
_MAX_REDIRECTS = 3
_PORTS = {None, 80, 443}
_READABLE = ("text/html", "application/xhtml+xml", "text/plain")
_USER_AGENT = "Mozilla/5.0 (compatible; WikiHubReader/1.0)"

_DROP = re.compile(
    r"<(script|style|noscript|svg|template|head|nav|footer|form|iframe)\b[^>]*>.*?</\1\s*>",
    re.IGNORECASE | re.DOTALL,
)
_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")
_WORD = re.compile(r"\w{3,}", re.UNICODE)
#: A number with a unit or a sign of a measurement: 31°, 87%, 12 km/h, 1,2 mm, 10.0.0.5.
_MEASURE = re.compile(
    r"\d[\d.,]*\s?(?:°|%|km|mm|cm|kg|gb|mb|mph|h|m/s|usd|vnd|\$|€|đ)", re.IGNORECASE
)
#: The start of a numbered item, ``2.`` or ``3)``: "what are the N ..." is answered by a list.
_ITEM = re.compile(r"(?<![\w.,])\d{1,2}[.)]\s+[^\W\d]")


class Blocked(Exception):
    """The address is not one that may be fetched."""


async def _resolve(host: str, port: int) -> list[str]:
    """Every address ``host`` resolves to (a seam for tests)."""
    infos = await asyncio.get_running_loop().getaddrinfo(
        host, port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP
    )
    return sorted({str(info[4][0]) for info in infos})


def _public(address: str) -> bool:
    try:
        return ipaddress.ip_address(address.split("%", 1)[0]).is_global
    except ValueError:
        return False


async def check(url: str) -> tuple[str, str, int, str]:
    """``(scheme, host, port, address)`` of a page that may be fetched; raises :class:`Blocked`."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise Blocked("scheme")
    if parts.username or parts.password:
        raise Blocked("credentials")
    host = parts.hostname or ""
    if not host:
        raise Blocked("host")
    try:
        port = parts.port
    except ValueError as exc:
        raise Blocked("port") from exc
    if port not in _PORTS:
        raise Blocked("port")
    port = port or (443 if parts.scheme == "https" else 80)
    try:
        addresses = await _resolve(host, port)
    except OSError as exc:
        raise Blocked("unresolvable") from exc
    # One private address among the public ones is enough to refuse: which of them the
    # connection would use is not something to gamble on.
    if not addresses or not all(_public(a) for a in addresses):
        raise Blocked("not public")
    return parts.scheme, host, port, addresses[0]


def _pinned(url: str, scheme: str, port: int, address: str) -> str:
    parts = urlsplit(url)
    host = f"[{address}]" if ":" in address else address
    default = 443 if scheme == "https" else 80
    netloc = host if port == default else f"{host}:{port}"
    return parts._replace(netloc=netloc).geturl()


def readable_text(markup: str) -> str:
    """The words of a page: no scripts, menus or tags, one space between words."""
    text = _COMMENT.sub(" ", markup)
    text = _DROP.sub(" ", text)
    text = html.unescape(_TAG.sub(" ", text))
    return _SPACE.sub(" ", text).strip()


def best_excerpt(text: str, query: str, chars: int = 3000) -> str:
    """The part of ``text`` that most looks like the answer to ``query``: :func:`split_excerpt`."""
    return split_excerpt(text, query, chars)[0]


def _joined(stretches: list[str], indexes: list[int]) -> str:
    """The stretches at ``indexes``, in page order: neighbours run on, a gap is marked."""
    pieces: list[str] = []
    previous = -2
    for index in indexes:
        pieces.append(stretches[index] if index == previous + 1 else " ... " + stretches[index])
        previous = index
    return " ".join("".join(pieces).split()).removeprefix("... ")


def split_excerpt(text: str, query: str, chars: int = 3000) -> tuple[str, str]:
    """The part of ``text`` that most looks like the answer to ``query``, and the rest of it.

    Pages open with menus and close with fine print; the facts are in the middle. The text is
    cut into stretches, each scored - together with the one after it - by the query's words it
    holds, the measurements in it (a temperature, a price, a percentage) and the numbered items
    in it, and the best ones are joined, in page order. Each chosen stretch brings the one after
    it: "the 8 values" is followed by the eight, and a list cut in two at a stretch's end, half
    of it given to the model, is a list the model completes on its own.

    The rest - what was left out, in page order - is what the model reads on with when the
    excerpt does not hold the whole answer. ``""`` when the page fits whole.
    """
    if len(text) <= chars:
        return text, ""
    words = {w.lower() for w in _WORD.findall(query)}
    size = max(200, chars // 6)
    stretches = [text[i : i + size] for i in range(0, len(text), size)]

    def score(index: int) -> float:
        run = "".join(stretches[index : index + 2])
        lowered = run.lower()
        # A word counts once: a menu repeating the page's title is not the page.
        return (
            sum(w in lowered for w in words)
            + 2 * len(_MEASURE.findall(run))
            + len(_ITEM.findall(run))
        )

    room = max(1, chars // size)
    chosen: set[int] = set()
    for best in sorted(range(len(stretches)), key=score, reverse=True):
        for index in (best, best + 1):
            if index < len(stretches) and len(chosen) < room:
                chosen.add(index)
        if len(chosen) >= room:
            break
    left = [index for index in range(len(stretches)) if index not in chosen]
    return _joined(stretches, sorted(chosen))[:chars], _joined(stretches, left)


def next_part(unread: str, chars: int) -> tuple[str, str]:
    """The next ``chars`` of what is left of a page, ended at a word, and what is left after."""
    if len(unread) <= chars:
        return unread, ""
    cut = unread.rfind(" ", chars // 2, chars)
    cut = cut if cut > 0 else chars
    return unread[:cut].rstrip(), unread[cut:].lstrip()


async def fetch_text(url: str) -> str:
    """The readable text of ``url``; ``""`` when it cannot or may not be read."""
    try:
        current = url
        for _ in range(_MAX_REDIRECTS + 1):
            scheme, host, port, address = await check(current)
            extensions = {"sni_hostname": host} if scheme == "https" else {}
            async with (
                httpx.AsyncClient(timeout=_TIMEOUT_SECONDS, follow_redirects=False) as http,
                http.stream(
                    "GET",
                    _pinned(current, scheme, port, address),
                    headers={
                        "Host": host,
                        "User-Agent": _USER_AGENT,
                        "Accept": "text/html,*/*;q=0.5",
                    },
                    extensions=extensions,
                ) as response,
            ):
                if response.is_redirect:
                    location = response.headers.get("location", "")
                    if not location:
                        return ""
                    current = urljoin(current, location)
                    continue
                if response.status_code != 200:
                    return ""
                kind = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                if kind not in _READABLE:
                    return ""
                body = b""
                async for chunk in response.aiter_bytes():
                    body += chunk
                    if len(body) >= _MAX_BYTES:
                        break
                body = body[:_MAX_BYTES]
                charset = response.charset_encoding or "utf-8"
            return readable_text(body.decode(charset, errors="replace"))
        return ""  # too many redirects
    except Blocked as exc:
        # Which address was refused is worth knowing; what the page said is not logged.
        logger.info("ai_web_page_blocked", reason=str(exc))
        return ""
    except (httpx.HTTPError, LookupError, ValueError) as exc:
        logger.info("ai_web_page_unreadable", error=type(exc).__name__)
        return ""
