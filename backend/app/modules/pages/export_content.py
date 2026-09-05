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
- every heading given a stable, unique id, and every table-of-contents entry
  a real ``<a href="#...">`` pointing at one - the live table of contents
  only ever *scrolls* to a heading via its in-memory document position
  (``TableOfContentsComponent``'s ``goToHeading``), which means nothing once
  there is no live document to hold that position: a static export's outline
  needs a real, followable link instead, in the PDF/HTML/Word reader alike;
- every attachment reference inlined as a ``data:`` URI, since the headless
  browser holds no session cookie and a plain ``/api/v1/attachments/...`` URL
  would 401.
"""

from __future__ import annotations

import base64
import re
import unicodedata
import uuid

from bs4 import BeautifulSoup, Tag
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

_SLUG_CHARS_RE = re.compile(r"[^a-z0-9]+")
#: Unicode gives no canonical decomposition for stroke-through letters like
#: "đ"/"Đ" - NFD leaves them untouched, so they need an explicit substitution
#: before the generic diacritic strip below runs (same trick export_service.py's
#: filename slug uses, kept local here to avoid an import cycle - export_service
#: already imports from this module).
_STROKE_LETTERS = str.maketrans({"đ": "d", "Đ": "D"})


def _slugify_heading(text: str) -> str:
    normalized = unicodedata.normalize("NFD", text.translate(_STROKE_LETTERS))
    ascii_text = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return _SLUG_CHARS_RE.sub("-", ascii_text.strip().lower()).strip("-") or "section"


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


def _assign_heading_ids(soup: BeautifulSoup) -> list[tuple[Tag, int, str]]:
    """Give every heading a stable, unique id to link to.

    A plain heading carries none - nothing in the live app ever needs to
    jump straight to one. A static export does: a table-of-contents entry
    and any other same-page link only work as a real ``<a href="#...">`` once
    something in the document actually carries that id. An id already on a
    heading (say, from imported HTML) is left alone and only recorded, so a
    later generated slug never collides with it.
    """
    used: set[str] = {element["id"] for element in soup.find_all(id=True)}
    headings: list[tuple[Tag, int, str]] = []
    for heading in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]):
        text = heading.get_text(" ", strip=True) or "Untitled section"
        heading_id = heading.get("id")
        if not heading_id:
            base = _slugify_heading(text)
            heading_id = base
            suffix = 2
            while heading_id in used:
                heading_id = f"{base}-{suffix}"
                suffix += 1
            heading["id"] = heading_id
            used.add(heading_id)
        headings.append((heading, int(heading.name[1]), text))
    return headings


def _render_table_of_contents(soup: BeautifulSoup) -> None:
    """Give a static export a real, followable table of contents.

    The live editor's ``tableOfContents`` node stores no content of its own -
    it is an empty placeholder a React node view fills in by scanning the
    *live* document's headings (see ``TableOfContentsComponent`` in
    rich-text-editor.tsx). PDF and HTML export mount that same editor and
    get this for free; Word export hands this HTML straight to Pandoc with
    no editor involved at all, so the placeholder must already hold the real
    outline by the time it gets there. Rendering it once, here, also keeps
    all three export formats in exact agreement instead of only two of them
    working by accident.

    Each entry is a real ``<a href="#...">`` rather than plain text: the live
    widget instead jumps to a heading through its in-memory document position
    (``goToHeading``), which stops meaning anything the moment there is no
    live document - a PDF, an HTML file opened later, or a Word document all
    need a link and a matching id to actually navigate anywhere.
    """
    placeholders = soup.select('[data-type="tableOfContents"]')
    if not placeholders:
        return
    headings = _assign_heading_ids(soup)
    numbered = _number_headings([(level, text) for _, level, text in headings])
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
        for (heading, _, _), (index, level, text) in zip(headings, numbered, strict=True):
            item = soup.new_tag(
                "li", style=f"list-style:none;padding-left:{(level - 1) * 16}px"
            )
            link = soup.new_tag("a", href=f"#{heading['id']}")
            link.string = f"{index}. {text}"
            item.append(link)
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
