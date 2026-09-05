"""Content preparation shared by every export format.

Turns a page's stored HTML/markdown into a self-contained, static document
fit for a session-less headless browser:

- the same markdown-render + sanitizer the old WeasyPrint-based PDF export
  used (kept unchanged - do not weaken it, imported Confluence content is
  untrusted);
- every collapsed toggle forced open, since a static export has no
  interactivity to reveal it;
- a table of contents and an image caption both rendered as real, visible
  content - the live editor produces both live, client-side, from a bare
  placeholder/attribute the stored HTML alone does not carry (see
  ``_render_table_of_contents`` and ``_render_image_captions``); Word export
  has no editor in its own pipeline at all to do that for it, so it has to
  already be done by the time this function returns;
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


def _number_headings(headings: list[tuple[int, str]]) -> list[tuple[str, int, str]]:
    """Port of the frontend's ``numberTableOfContentsHeadings`` - same
    counters-per-level algorithm, so a static export's outline numbering
    matches what a reader saw in the live table of contents exactly."""
    counters = [0] * 6
    numbered: list[tuple[str, int, str]] = []
    for raw_level, text in headings:
        level = min(max(raw_level, 1), len(counters))
        counter_index = level - 1
        counters[counter_index] += 1
        for index in range(level, len(counters)):
            counters[index] = 0
        # A document can start at a nested heading. Keep its displayed
        # outline meaningful instead of rendering a zero-valued parent
        # (for example "0.1").
        for index in range(counter_index):
            if counters[index] == 0:
                counters[index] = 1
        numbered.append((".".join(str(c) for c in counters[: level]), level, text))
    return numbered


def _render_table_of_contents(soup: BeautifulSoup) -> None:
    """Give a static export a real table of contents.

    The live editor's ``tableOfContents`` node stores no content of its own -
    it is an empty placeholder a React node view fills in by scanning the
    *live* document's headings (see ``TableOfContentsComponent`` in
    rich-text-editor.tsx). PDF and HTML export mount that same editor and
    get this for free; Word export hands this HTML straight to Pandoc with
    no editor involved at all, so the placeholder must already hold the real
    outline by the time it gets there. Rendering it once, here, also keeps
    all three export formats in exact agreement instead of only two of them
    working by accident.
    """
    placeholders = soup.select('[data-type="tableOfContents"]')
    if not placeholders:
        return
    headings = [
        (int(heading.name[1]), heading.get_text(" ", strip=True) or "Untitled section")
        for heading in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"])
    ]
    for placeholder in placeholders:
        if not headings:
            placeholder.decompose()
            continue
        nav = soup.new_tag("nav")
        title = soup.new_tag("p")
        title_strong = soup.new_tag("strong")
        title_strong.string = "Table of contents"
        title.append(title_strong)
        nav.append(title)
        entries = soup.new_tag("ol", style="list-style:none;margin:0;padding-left:0")
        for index, level, text in _number_headings(headings):
            item = soup.new_tag(
                "li", style=f"list-style:none;padding-left:{(level - 1) * 16}px"
            )
            item.string = f"{index}. {text}"
            entries.append(item)
        nav.append(entries)
        placeholder.replace_with(nav)


def _render_image_captions(soup: BeautifulSoup) -> None:
    """Give a static export a real, visible image caption.

    Same shape of problem as the table of contents above: the editor stores
    a caption as a bare ``data-caption`` attribute on the ``<img>`` itself,
    turned into visible text only by that same image's own React node view
    (see ``ResizableImageComponent``). Wrapping the pair in
    ``<figure>/<figcaption>`` - rather than only inserting a paragraph -
    also earns it Pandoc's own "Image Caption" style in the Word export,
    instead of an unstyled line of text.
    """
    for img in soup.find_all("img", attrs={"data-caption": True}):
        caption_text = (img.get("data-caption") or "").strip()
        del img["data-caption"]
        if not caption_text:
            continue
        host = img.find_parent("p") or img
        figure = soup.new_tag("figure")
        host.replace_with(figure)
        figure.append(img)
        figcaption = soup.new_tag("figcaption")
        figcaption.string = caption_text
        figure.append(figcaption)


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
    _render_table_of_contents(soup)
    _render_image_captions(soup)
    await _inline_attachments(soup, page=page, storage=storage, session=session)
    return str(soup)
