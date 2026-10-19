"""Fetch a Google Sheet or Google Doc by its link, as the Office file Google exports.

The import pipeline works on files, so a link is turned into one here, in the
API request, and staged like an upload:

* a sheet is exported as `.xlsx` - the whole workbook rather than one tab as
  CSV, which keeps every tab and the formatting (merged cells, bold, colours)
  the spreadsheet reader knows how to carry over;
* a doc is exported as `.docx`, so it takes exactly the path an uploaded Word
  file does, review included.

Only files anyone with the link can view are reachable: WikiHub has no Google
account to sign in with. A private file makes Google answer with its sign-in
page, which is recognised and reported as "share it first" rather than as a
broken file.

The request never goes to an address the user typed. Only the file's id is
taken from the link, and the export URL is built from it on a fixed Google
host; redirects are followed only while they stay on Google's own domains.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import unquote, urljoin, urlsplit

import httpx

from app.core.exceptions import BadRequestError, PayloadTooLargeError, ServiceUnavailableError
from app.core.logging import get_logger

logger = get_logger(__name__)

#: `/spreadsheets/d/<id>/...` or `/document/d/<id>/...` for a shared file;
#: `/spreadsheets/d/e/<id>/...` for a sheet published to the web, which has its
#: own export path.
_FILE_ID = re.compile(
    r"^/(?P<kind>spreadsheets|document)/d/(?P<published>e/)?(?P<id>[A-Za-z0-9_-]{20,200})(?:/|$)"
)
_GOOGLE_HOSTS = ("docs.google.com",)
#: Where Google's export redirects land. Anything else is refused.
_REDIRECT_SUFFIXES = (".google.com", ".googleusercontent.com")
_MAX_REDIRECTS = 5
_TIMEOUT = httpx.Timeout(60.0, connect=10.0)
_CHUNK = 1024 * 1024

_FILENAME_STAR = re.compile(r"filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)")
_FILENAME = re.compile(r'filename\s*=\s*"([^"]+)"')


class GoogleLinkError(BadRequestError):
    """The link is not a Google Sheet or Doc WikiHub can read."""


@dataclass(frozen=True, slots=True)
class GoogleExport:
    """Where to download a linked file, and what it arrives as."""

    url: str
    #: The internal source format (`xlsx` or `docx`), which is also the extension.
    source_format: str
    content_type: str
    #: The filename used when Google does not name the download.
    fallback_name: str
    #: "Google Sheet" or "Google Doc", for messages.
    label: str


def export_for(link: str) -> GoogleExport:
    """How to download the Google Sheet or Doc ``link`` points at."""
    raw = (link or "").strip()
    if not raw:
        raise GoogleLinkError(
            "Paste a Google Sheets or Google Docs link.", code="invalid_google_link"
        )
    if "://" not in raw:
        raw = f"https://{raw}"
    parts = urlsplit(raw)
    match = _FILE_ID.match(parts.path or "")
    if parts.scheme not in {"http", "https"} or parts.hostname not in _GOOGLE_HOSTS or not match:
        raise GoogleLinkError(
            "This is not a Google Sheets or Google Docs link. It should look like "
            "https://docs.google.com/spreadsheets/d/… or https://docs.google.com/document/d/…",
            code="invalid_google_link",
        )
    file_id, published = match.group("id"), bool(match.group("published"))
    if match.group("kind") == "spreadsheets":
        url = (
            f"https://docs.google.com/spreadsheets/d/e/{file_id}/pub?output=xlsx"
            if published
            else f"https://docs.google.com/spreadsheets/d/{file_id}/export?format=xlsx"
        )
        return GoogleExport(
            url=url,
            source_format="xlsx",
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            fallback_name="Google Sheet",
            label="Google Sheet",
        )
    if published:
        # A doc published to the web has no export of its own; its sharing
        # link does, and is what Share → Copy link hands out anyway.
        raise GoogleLinkError(
            "A published Google Doc cannot be imported by its web address. Use the link "
            "from Share → Copy link instead.",
            code="invalid_google_link",
        )
    return GoogleExport(
        url=f"https://docs.google.com/document/d/{file_id}/export?format=docx",
        source_format="docx",
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fallback_name="Google Doc",
        label="Google Doc",
    )


def filename_from_disposition(header: str | None) -> str | None:
    """The filename Google offers, which is the file's own title plus its extension."""
    if not header:
        return None
    star = _FILENAME_STAR.search(header)
    if star:
        return unquote(star.group(1).strip().strip('"'))
    plain = _FILENAME.search(header)
    return plain.group(1) if plain else None


def _allowed_redirect(url: str) -> bool:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and (
        host in _GOOGLE_HOSTS or host.endswith(_REDIRECT_SUFFIXES)
    )


def _not_shared(label: str) -> GoogleLinkError:
    return GoogleLinkError(
        f"WikiHub cannot open this {label}. In Google, choose Share and set General access "
        "to \"Anyone with the link\", then try again.",
        code="google_link_not_shared",
    )


async def fetch_google_file(
    link: str, *, limit_bytes: int, limit_mb: int, client: httpx.AsyncClient | None = None
) -> tuple[str, bytes, GoogleExport]:
    """Download the file behind ``link``; returns ``(filename, data, export)``."""
    export = export_for(link)
    label = export.label
    current = export.url
    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False)
    try:
        for _ in range(_MAX_REDIRECTS + 1):
            async with http.stream("GET", current, headers={"Accept": "*/*"}) as response:
                if response.is_redirect:
                    location = urljoin(current, response.headers.get("location", ""))
                    # Google sends a private file to its sign-in page; anything
                    # off Google's domains is not followed at all.
                    if (
                        urlsplit(location).hostname == "accounts.google.com"
                        or not _allowed_redirect(location)
                    ):
                        raise _not_shared(label)
                    current = location
                    continue
                if response.status_code in {401, 403}:
                    raise _not_shared(label)
                if response.status_code == 404:
                    # Google answers 404 for some private files too, so this
                    # cannot claim the link is simply wrong.
                    raise GoogleLinkError(
                        f"This {label} was not found. Check the link, and that it is shared "
                        "with \"Anyone with the link\".",
                        code="google_link_not_found",
                    )
                if response.status_code != 200:
                    raise ServiceUnavailableError(
                        f"Google did not return the {label} (HTTP {response.status_code}). "
                        "Try again in a moment."
                    )
                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes(_CHUNK):
                    total += len(chunk)
                    if total > limit_bytes:
                        raise PayloadTooLargeError(
                            f"This {label} is larger than {limit_mb} MB.",
                            code="document_too_large",
                        )
                    chunks.append(chunk)
                data = b"".join(chunks)
                # Both exports are zip containers; a sign-in or "request
                # access" page arrives as a 200 HTML page instead.
                if not data.startswith(b"PK"):
                    raise _not_shared(label)
                extension = f".{export.source_format}"
                name = filename_from_disposition(response.headers.get("content-disposition"))
                if not name or not name.lower().endswith(extension):
                    # Appended, not swapped in: a title such as "Release 1.2"
                    # has a dot that is not an extension.
                    name = f"{name or export.fallback_name}{extension}"
                return name, data, export
        raise ServiceUnavailableError("Google redirected too many times. Try again.")
    except httpx.HTTPError as exc:
        logger.info("google_file_fetch_failed", error=type(exc).__name__)
        raise ServiceUnavailableError(
            "WikiHub could not reach Google. Check the server's internet access and try again."
        ) from exc
    finally:
        if owns_client:
            await http.aclose()
