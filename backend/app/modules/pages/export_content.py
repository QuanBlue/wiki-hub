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
- a bare header row (``<tr><th>...`` with no enclosing ``<thead>`` - exactly
  what a page's own table produces) wrapped in one, since Word export's
  table-header formatting can only paint what Pandoc's own HTML reader
  recognised as a header row in the first place, and Pandoc does not
  consider a ``<th>`` a header at all unless it sits inside a ``<thead>``;
- every attachment reference inlined as a ``data:`` URI, since the headless
  browser holds no session cookie and a plain ``/api/v1/attachments/...`` URL
  would 401.
"""

from __future__ import annotations

import base64
import re
import unicodedata
import uuid
from typing import Final

from bs4 import BeautifulSoup, Tag
from markdown_it import MarkdownIt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.models.attachment import PageAttachment
from app.models.page import WikiPage
from app.models.user import User
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


def _wrap_bare_header_rows(soup: BeautifulSoup) -> None:
    """Give Pandoc a real ``<thead>`` to work with.

    A page's own table (see rich-text-editor.tsx's
    ``TableHeaderWithBackground``/``TableRowWithHeight``) never wraps its
    header row in a ``<thead>`` - it is just an ordinary ``<tr>`` whose cells
    happen to be ``<th>``. A browser, and this app's own read-only render,
    render that identically to a ``<thead>``-wrapped one, but Pandoc's HTML
    reader does not: without a ``<thead>``, it reads a ``<th>`` as an
    ordinary cell and marks no header row at all, which is what silently
    stopped Word export's own header-row styling (see
    ``export_docx._apply_table_header_formatting``) from ever having
    anything to paint.
    """
    for table in soup.find_all("table"):
        if table.find("thead"):
            continue
        first_row = table.find("tr")
        if first_row is None or not first_row.find("th", recursive=False):
            continue
        thead = soup.new_tag("thead")
        thead.append(first_row.extract())
        table.insert(0, thead)


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


#: Recognized verbatim by export_docx.py's ``_insert_native_toc_fields``,
#: which replaces the paragraph carrying it with a real Word TOC field - see
#: ``_mark_table_of_contents_for_word``.
WORD_TOC_FIELD_MARKER: Final = "WIKIHUB_INTERNAL_TABLE_OF_CONTENTS_FIELD_MARKER"

#: Matches both the importer's placeholder (``div[data-type="tableOfContents"]``)
#: and what the TipTap editor's ``TableOfContentsNode.renderHTML`` serializes
#: when a page is saved (``nav[data-type="table-of-contents"]``).
_TOC_SELECTOR: Final = '[data-type="tableOfContents"], nav[data-type="table-of-contents"]'


def _mark_table_of_contents_for_word(soup: BeautifulSoup) -> None:
    """Leave a plain-text marker where Word's *native* Table of Contents
    field belongs, instead of rendering the custom outline
    ``_render_table_of_contents`` builds for PDF/HTML.

    Word has its own real, updatable Table of Contents mechanism - the same
    field Word itself inserts via References > Table of Contents, that a
    reader can right-click and "Update Field" on, and that shows up in
    Word's navigation pane. PDF and HTML have no such mechanism to defer to,
    which is the *only* reason they get a custom-rendered outline instead;
    Word export should use the real thing, not reinvent it. Pandoc has no
    concept of a Word field from HTML input, so this only leaves a marker
    paragraph for ``export_docx.py`` to replace once Pandoc has produced the
    heading styles the field itself relies on.
    """
    for placeholder in soup.select(_TOC_SELECTOR):
        marker = soup.new_tag("p")
        marker.string = WORD_TOC_FIELD_MARKER
        placeholder.replace_with(marker)


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

    Entries are plain ``<p>`` lines, not an ``<ol>``/``<li>`` list: PDF and
    HTML export reach the reader by reparsing this HTML back into the
    interactive editor's own schema (see the module docstring), which has no
    node for an arbitrary ``list-style``/``padding-left`` and drops both -
    left with a bare ``<ol>``, the browser then draws its *own* "1. 2. 3."
    counter on top of the "1.1./1.2." index already in each entry's text, and
    every level renders flush against the last with no indent at all. A
    leading run of non-breaking spaces is plain text, not an attribute, so it
    is the one way left to indent an entry that survives being reparsed by
    the editor, or by Pandoc, unchanged.
    """
    placeholders = soup.select(_TOC_SELECTOR)
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
        for (heading, _, _), (index, level, text) in zip(headings, numbered, strict=True):
            entry = soup.new_tag("p")
            if level > 1:
                entry.append(soup.new_string("\xa0" * ((level - 1) * 4)))
            link = soup.new_tag("a", href=f"#{heading['id']}")
            link.string = f"{index}. {text}"
            entry.append(link)
            nav.append(entry)
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


def _render_task_lists_for_word(soup: BeautifulSoup) -> None:
    """Turn task-list items into checkbox-prefixed items for Pandoc/Word.

    TipTap's TaskItem serializes ``<li data-checked="true"><label><input
    type="checkbox"><span></span></label><div><p>Task</p></div></li>`` (and
    importers emit ``<li data-checked="true"><input type="checkbox"/><span>Task</span></li>``).
    Pandoc drops ``<input type="checkbox">`` and turns the empty ``<label>``
    into a blank paragraph above every task item, losing the checked state
    entirely. Stripping the checkbox chrome and prepending ``☑ ``/``☐ `` keeps
    each task item on a single line with its real state visible in Word.
    """
    for li in soup.select("li[data-checked]"):
        checked = str(li.get("data-checked", "")).lower() == "true"
        marker = "☑ " if checked else "☐ "
        for node in li.select('label, input[type="checkbox"]'):
            node.decompose()
        target = li.find(["p", "span"]) or li
        target.insert(0, soup.new_string(marker))


def _find_diagram_elements(soup: BeautifulSoup) -> list[Tag]:
    """Find every Mermaid diagram element in document order, matching what
    ``RichTextContent`` mounts as a ``DiagramNode`` in the browser."""
    diagrams: list[Tag] = []
    for el in soup.find_all(["div", "pre"]):
        if el.get("data-type") == "diagram":
            diagrams.append(el)
            continue
        if (
            el.name == "pre"
            and el.find_parent(attrs={"data-type": "diagram"}) is None
            and el.select_one("code.language-mermaid") is not None
        ):
            diagrams.append(el)
    return diagrams


def _render_diagrams_for_export(
    soup: BeautifulSoup, diagram_images: list[str] | None = None
) -> None:
    diagrams = _find_diagram_elements(soup)
    for i, el in enumerate(diagrams):
        raw_caption = el.get("data-caption")
        caption = str(raw_caption) if raw_caption else ""
        if diagram_images and i < len(diagram_images) and diagram_images[i]:
            img_tag = soup.new_tag("img", src=diagram_images[i], alt="Diagram")
            p_tag = soup.new_tag("p", attrs={"class": "diagram-rendered"})
            p_tag.append(img_tag)
            if caption:
                caption_tag = soup.new_tag("p", attrs={"class": "diagram-caption"})
                em = soup.new_tag("em")
                em.string = caption
                caption_tag.append(em)
                el.replace_with(p_tag)
                p_tag.insert_after(caption_tag)
            else:
                el.replace_with(p_tag)
        else:
            code_el = el.select_one("code.language-mermaid")
            raw_code = el.get("data-code")
            code = str(raw_code) if raw_code else (code_el.get_text() if code_el else "")
            pre_tag = soup.new_tag("pre", attrs={"class": "mermaid"})
            code_tag = soup.new_tag("code", attrs={"class": "language-mermaid"})
            code_tag.string = code
            pre_tag.append(code_tag)
            el.replace_with(pre_tag)


async def _render_child_pages_for_export(
    soup: BeautifulSoup, *, page: WikiPage, session: AsyncSession
) -> None:
    """Expand live `<div data-type="childPages">` blocks into static tables or lists."""
    blocks = soup.select('div[data-type="childPages"]')
    if not blocks:
        return
    all_pages = list(
        await session.scalars(
            select(WikiPage)
            .where(WikiPage.space_id == page.space_id, WikiPage.deleted_at.is_(None))
            .order_by(WikiPage.title)
        )
    )
    children_by_parent: dict[uuid.UUID | None, list[WikiPage]] = {}
    for item in all_pages:
        children_by_parent.setdefault(item.parent_id, []).append(item)

    def collect_descendants(parent_id: uuid.UUID, depth_mode: str) -> list[tuple[WikiPage, int]]:
        result: list[tuple[WikiPage, int]] = []
        stack: list[tuple[WikiPage, int]] = [
            (child, 0) for child in reversed(children_by_parent.get(parent_id, []))
        ]
        seen: set[uuid.UUID] = set()
        while stack:
            node, lvl = stack.pop()
            if node.id in seen:
                continue
            seen.add(node.id)
            result.append((node, lvl))
            if depth_mode == "all":
                for grand in reversed(children_by_parent.get(node.id, [])):
                    stack.append((grand, lvl + 1))
        return result

    owner_ids: set[uuid.UUID] = set()
    for p in all_pages:
        raw_props = getattr(p, "properties", None)
        if isinstance(raw_props, dict) and raw_props.get("owner_id"):
            try:
                owner_ids.add(uuid.UUID(str(raw_props["owner_id"])))
            except ValueError:
                pass
    owner_map: dict[str, str] = {}
    if owner_ids:
        owners = list(await session.scalars(select(User).where(User.id.in_(owner_ids))))
        for u in owners:
            owner_map[str(u.id)] = u.full_name or u.username

    status_labels = {
        "draft": "Draft",
        "in_progress": "In Progress",
        "verified": "Verified",
        "outdated": "Outdated",
        "archived": "Archived",
    }

    for block in blocks:
        view_mode = str(block.get("data-view-mode") or "table")
        depth_mode = str(block.get("data-depth") or "direct")
        filter_status = str(block.get("data-filter-status") or "").strip()
        rows = collect_descendants(page.id, depth_mode)
        if filter_status:
            rows = [
                (p, lvl)
                for p, lvl in rows
                if isinstance(getattr(p, "properties", None), dict)
                and p.properties.get("status") == filter_status
            ]
        if not rows:
            empty_p = soup.new_tag("p")
            em = soup.new_tag("em")
            em.string = "No child pages."
            empty_p.append(em)
            block.replace_with(empty_p)
            continue

        if view_mode == "tree":
            ul = soup.new_tag("ul")
            for p, lvl in rows:
                li = soup.new_tag("li")
                prefix = "— " * lvl if lvl > 0 else ""
                props = p.properties if isinstance(getattr(p, "properties", None), dict) else {}
                st = status_labels.get(str(props.get("status") or ""), "")
                li.string = f"{prefix}{p.title}" + (f" [{st}]" if st else "")
                ul.append(li)
            block.replace_with(ul)
        else:
            table = soup.new_tag("table")
            thead = soup.new_tag("thead")
            tr_head = soup.new_tag("tr")
            for heading in ("Page", "Status", "Owner", "Updated"):
                th = soup.new_tag("th")
                th.string = heading
                tr_head.append(th)
            thead.append(tr_head)
            table.append(thead)
            tbody = soup.new_tag("tbody")
            for p, lvl in rows:
                props = p.properties if isinstance(getattr(p, "properties", None), dict) else {}
                tr = soup.new_tag("tr")
                td_title = soup.new_tag("td")
                td_title.string = ("  " * lvl) + p.title
                td_status = soup.new_tag("td")
                td_status.string = status_labels.get(str(props.get("status") or ""), "—")
                td_owner = soup.new_tag("td")
                td_owner.string = owner_map.get(str(props.get("owner_id") or ""), "—")
                td_upd = soup.new_tag("td")
                td_upd.string = p.updated_at.strftime("%Y-%m-%d") if p.updated_at else "—"
                for td in (td_title, td_status, td_owner, td_upd):
                    tr.append(td)
                tbody.append(tr)
            table.append(tbody)
            block.replace_with(table)


def _render_custom_inline_and_blocks_for_export(soup: BeautifulSoup) -> None:
    """Ensure status badges, math blocks, and whiteboards export cleanly."""
    for badge in soup.select('span[data-type="statusBadge"]'):
        label = str(badge.get("data-label") or badge.get_text() or "STATUS").strip()
        badge.string = f"[{label}]"

    for math_el in soup.select('span[data-type="inlineMath"], div[data-type="blockMath"]'):
        latex = str(math_el.get("data-latex") or math_el.get_text() or "").strip()
        if math_el.name == "div":
            pre = soup.new_tag("pre")
            code = soup.new_tag("code")
            code.string = latex
            pre.append(code)
            math_el.replace_with(pre)
        else:
            code = soup.new_tag("code")
            code.string = latex
            math_el.replace_with(code)

    for wb in soup.select('div[data-type="whiteboard"]'):
        svg_b64 = str(wb.get("data-svg") or "").strip()
        caption = str(wb.get("data-caption") or "").strip()
        if svg_b64.startswith("data:image/svg+xml;base64,"):
            img = soup.new_tag("img", src=svg_b64, alt=caption or "Whiteboard")
            p = soup.new_tag("p")
            p.append(img)
            wb.replace_with(p)
        else:
            p = soup.new_tag("p")
            em = soup.new_tag("em")
            em.string = f"[Whiteboard{f': {caption}' if caption else ''}]"
            p.append(em)
            wb.replace_with(p)


async def prepare_export_html(
    page: WikiPage,
    *,
    storage: ObjectStorage,
    session: AsyncSession,
    native_word_toc: bool = False,
    diagram_images: list[str] | None = None,
) -> str:
    """Return a self-contained HTML fragment ready for a session-less
    headless-browser render or a direct PDF/Word conversion.

    ``native_word_toc`` is set only by the Word export branch of
    export_service.py: Word gets a real, native TOC field instead of the
    custom-rendered outline PDF/HTML fall back to (see
    ``_mark_table_of_contents_for_word`` vs. ``_render_table_of_contents``).
    """
    soup = BeautifulSoup(_render_content(page), "html.parser")
    _sanitize(soup)
    _force_toggles_open(soup)
    await _render_child_pages_for_export(soup, page=page, session=session)
    _render_custom_inline_and_blocks_for_export(soup)
    _wrap_bare_header_rows(soup)
    if native_word_toc:
        _mark_table_of_contents_for_word(soup)
        _render_task_lists_for_word(soup)
        _render_diagrams_for_export(soup, diagram_images=diagram_images)
    else:
        _render_table_of_contents(soup)
    _render_image_captions(soup)
    await _inline_attachments(soup, page=page, storage=storage, session=session)
    return str(soup)
