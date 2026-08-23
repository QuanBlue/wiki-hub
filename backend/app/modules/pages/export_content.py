"""Content preparation shared by every export format.

Turns a page's stored HTML/markdown into a self-contained, static document
fit for a session-less headless browser:

- the same markdown-render + sanitizer the old WeasyPrint-based PDF export
  used (kept unchanged - do not weaken it, imported Confluence content is
  untrusted);
- every collapsed toggle forced open, since a static export has no
  interactivity to reveal it;
- every attachment reference inlined as a ``data:`` URI, since the headless
  browser holds no session cookie and a plain ``/api/v1/attachments/...`` URL
  would 401.
"""

from __future__ import annotations

import base64
import re
import uuid

from bs4 import BeautifulSoup
from markdown_it import MarkdownIt
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.models.attachment import PageAttachment
from app.models.page import WikiPage
from app.services.storage import ObjectStorage

logger = get_logger(__name__)

#: Matches this page's own attachment-content URLs, e.g.
#: "/api/v1/attachments/3fa85f64-5717-4562-b3fc-2c963f66afa6/content".
_ATTACHMENT_CONTENT_RE = re.compile(
    r"^/api/v1/attachments/"
    r"(?P<id>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
    r"/content$"
)


def _render_content(page: WikiPage) -> str:
    return (
        MarkdownIt("commonmark", {"html": True}).render(page.content)
        if page.content_format == "markdown"
        else page.content
    )


def _sanitize(soup: BeautifulSoup) -> None:
    for element in soup.find_all(["script", "iframe", "object", "embed", "form", "base"]):
        element.decompose()
    for element in soup.find_all(True):
        for attribute in list(element.attrs):
            value = str(element.attrs[attribute]).strip().lower()
            if attribute.lower().startswith("on") or value.startswith("javascript:"):
                del element.attrs[attribute]


def _force_toggles_open(soup: BeautifulSoup) -> None:
    """A static document has no interactivity to expand a collapsed section,
    so every toggle exports fully open. The toggle's content already stays in
    the DOM when collapsed on screen (hidden purely by CSS) - flipping this
    attribute is enough, no content is ever missing to begin with."""
    for element in soup.select('[data-type="toggle"]'):
        element["data-open"] = "true"


async def _inline_attachments(
    soup: BeautifulSoup, *, page: WikiPage, storage: ObjectStorage, session: AsyncSession
) -> None:
    cache: dict[uuid.UUID, str | None] = {}
    total_bytes = 0

    async def resolve(attachment_id: uuid.UUID) -> str | None:
        nonlocal total_bytes
        if attachment_id in cache:
            return cache[attachment_id]

        attachment = await session.get(PageAttachment, attachment_id)
        # An attachment that doesn't exist, or belongs to a different page,
        # is never dereferenced with the exporter's authority - a stale or
        # forged reference is simply left un-inlined.
        if attachment is None or attachment.page_id != page.id:
            cache[attachment_id] = None
            return None
        if attachment.size_bytes > settings.export_max_inline_asset_bytes:
            logger.info(
                "export_asset_skipped_too_large", attachment_id=str(attachment_id),
                size_bytes=attachment.size_bytes,
            )
            cache[attachment_id] = None
            return None
        if total_bytes + attachment.size_bytes > settings.export_max_inline_total_bytes:
            logger.info("export_asset_skipped_total_cap", attachment_id=str(attachment_id))
            cache[attachment_id] = None
            return None

        data = await storage.get(attachment.object_key)
        total_bytes += len(data)
        data_uri = f"data:{attachment.content_type};base64,{base64.b64encode(data).decode()}"
        cache[attachment_id] = data_uri
        return data_uri

    for img in soup.find_all("img", src=True):
        match = _ATTACHMENT_CONTENT_RE.match(img["src"])
        if not match:
            continue
        data_uri = await resolve(uuid.UUID(match.group("id")))
        if data_uri is not None:
            img["src"] = data_uri

    for anchor in soup.find_all("a", href=True):
        match = _ATTACHMENT_CONTENT_RE.match(anchor["href"])
        if not match:
            continue
        data_uri = await resolve(uuid.UUID(match.group("id")))
        if data_uri is None:
            continue
        anchor["href"] = data_uri
        # The attachment card/link node already carries the filename in
        # data-attachment (see rich-text-editor.tsx's AttachmentNode); reusing
        # it here is what turns the inlined card into a real, working
        # download instead of just a picture of a link.
        anchor["download"] = anchor.get("data-attachment", "")


async def prepare_export_html(
    page: WikiPage, *, storage: ObjectStorage, session: AsyncSession
) -> str:
    """Return a self-contained HTML fragment ready for a session-less
    headless-browser render or a direct PDF conversion."""
    soup = BeautifulSoup(_render_content(page), "html.parser")
    _sanitize(soup)
    _force_toggles_open(soup)
    await _inline_attachments(soup, page=page, storage=storage, session=session)
    return str(soup)
