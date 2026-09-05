"""Reshape converted HTML into markup the Tiptap editor renders faithfully.

The reason this pass exists is a ProseMirror property that is easy to miss:
when the editor meets a node its schema does not know, it drops that node *and
everything inside it*. So a document wrapped in `<section>` or `<div>` does not
merely lose its wrapper - it loses its text. Every transform below is either
"unwrap something the schema has no node for" or "rewrite a construct into the
exact shape WikiHub's own editor produces".

Title derivation lives here too, though it does not need the walk above: every
imported page is titled after its source filename (extension stripped), so a
document's own heading stays in the body as ordinary content instead of being
promoted and removed.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup, Comment, NavigableString, Tag

from app.modules.pages.tiptap_html import new_table_of_contents, new_task_item, new_task_list
from app.schemas.page import MAX_PAGE_CONTENT_CHARS

#: Wrappers with no Tiptap equivalent. Unwrapped, never removed - their children
#: are the document.
_UNWRAP_TAGS = (
    "html", "head", "body", "section", "article", "header", "footer",
    "main", "aside", "figure", "center", "font", "small", "big",
    # pandoc wraps a task-list checkbox in a <label>; the editor has no node
    # for it, so it would take the task text down with it.
    "label",
)

#: Removed outright, content and all. None of these carry page text.
_DROP_TAGS = ("style", "meta", "link", "script", "base", "title", "colgroup", "col")

#: Attributes stripped from every element: pandoc's anchors and ids are noise in
#: an editor, and `id` collisions across imported pages break in-page links.
_STRIP_ATTRS = ("id", "name", "lang", "dir", "role", "tabindex")

#: Schemes a link may keep. Everything else becomes plain text.
_SAFE_LINK_SCHEMES = ("http://", "https://", "mailto:")

_LANGUAGE_CLASS = re.compile(r"^(?:language-)?([A-Za-z0-9+#_-]{1,32})$")

#: pandoc's own markers for a syntax-highlighted block, which we do not want.
_SOURCE_CODE_CLASSES = frozenset({"sourceCode", "sourcecode"})

TRUNCATION_NOTICE_CLASS = "import-truncation-notice"

_TABLE_OF_CONTENTS_TITLES = frozenset({"mục lục", "table of contents", "contents"})
_TOC_ENTRY_NUMBER = re.compile(r"^\s*\d+(?:\.\d+)*\.?\s+\S")
_TOC_ENTRY_DOTS = re.compile(r"\.{3,}\s*(?:\d+|error\b)", re.I)
_TOC_TITLE_PREFIX = re.compile(r"^(mục lục|table of contents|contents)\b[:.]?\s*", re.I)


def normalize_document_html(
    html: str,
    *,
    filename: str,
    max_chars: int = MAX_PAGE_CONTENT_CHARS,
) -> tuple[str, str, list[str]]:
    """Return `(html, title, warnings)` ready to be sanitized and stored."""
    warnings: list[str] = []
    soup = BeautifulSoup(html or "", "html.parser")

    _drop_comments(soup)
    _drop_tags(soup)
    _flatten_figures(soup)
    _normalize_code_blocks(soup)
    _normalize_images(soup)
    _normalize_links(soup)
    _normalize_tables(soup)
    _normalize_table_of_contents(soup)
    _unwrap_containers(soup)
    # Attribute stripping runs *before* task lists are rebuilt, and after code
    # blocks: the code pass needs pandoc's `sourceCode python` classes to read
    # the language off, while the task pass emits WikiHub's own Tailwind classes
    # that stripping would otherwise throw away.
    _strip_attributes(soup)
    _normalize_task_lists(soup)

    title = title_from_filename(filename)

    _collapse_empty_paragraphs(soup)
    result, truncated_percent = _truncate_to_blocks(soup, max_chars=max_chars)
    if truncated_percent is not None:
        warnings.append(
            f"This document was longer than WikiHub can store on one page; "
            f"about {truncated_percent}% of it was imported."
        )
    return result, title, warnings


def title_from_filename(filename: str) -> str:
    """The page title every import gets: its source filename, minus extension."""
    stem = Path(filename).stem.strip()
    # `Path(".docx").stem` is ".docx" - a dotfile has no suffix as far as
    # pathlib is concerned, and that is not a title anyone wants to read.
    if not stem or stem.startswith("."):
        return "Imported page"
    return stem[:255]


# --------------------------------------------------------------------------
# structural passes
# --------------------------------------------------------------------------


def _drop_comments(soup: BeautifulSoup) -> None:
    for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
        comment.extract()


def _drop_tags(soup: BeautifulSoup) -> None:
    for element in soup.find_all(_DROP_TAGS):
        element.decompose()


def _unwrap_containers(soup: BeautifulSoup) -> None:
    for element in soup.find_all(_UNWRAP_TAGS):
        element.unwrap()
    # Tiptap has no generic `div` node: retaining a layout wrapper means its
    # entire subtree can be discarded by ProseMirror. Keep only the div shapes
    # that our custom nodes actually understand. In particular, a report-wide
    # `<div style="width: …">` must be unwrapped so its many child blocks can
    # be stored (and, if necessary, truncated independently).
    for element in soup.find_all("div"):
        if not _is_editor_div(element):
            element.unwrap()
    for element in soup.find_all("nav"):
        if element.get("data-type") != "tableOfContents":
            element.unwrap()
    # Styled spans are inline typography and do have a Tiptap mark equivalent;
    # a bare span remains just layout scaffolding.
    for element in soup.find_all("span"):
        has_data_attribute = any(str(key).startswith("data-") for key in element.attrs)
        if not has_data_attribute and not element.get("style"):
            element.unwrap()


def _is_editor_div(element: Tag) -> bool:
    data_type = str(element.get("data-type") or "")
    if data_type in {"callout", "toggle", "toggle-summary", "toggle-content", "tableOfContents"}:
        return True
    classes = {str(value) for value in element.get("class") or []}
    return bool(classes & {"callout", "confluence-information-macro"})


def _strip_attributes(soup: BeautifulSoup) -> None:
    for element in soup.find_all(True):
        for attribute in _STRIP_ATTRS:
            element.attrs.pop(attribute, None)
        classes = element.get("class")
        if classes and not _keeps_class(element, classes):
            element.attrs.pop("class", None)


def _keeps_class(element: Tag, classes: list[str]) -> bool:
    """Only classes that carry meaning survive; the rest is source styling."""
    if element.name in {"pre", "code"}:
        return any(str(c).startswith("language-") for c in classes)
    return any(str(c).startswith(("task-", "attachment-", "import-")) for c in classes)


def _flatten_figures(soup: BeautifulSoup) -> None:
    """`<figure><img><figcaption>` has no Tiptap node; make it image + caption."""
    for figure in soup.find_all("figure"):
        caption = figure.find("figcaption")
        if caption is not None:
            text = " ".join(caption.get_text().split())
            caption.extract()
            if text:
                paragraph = soup.new_tag("p")
                emphasis = soup.new_tag("em")
                emphasis.string = text
                paragraph.append(emphasis)
                figure.insert_after(paragraph)
        figure.unwrap()


def _normalize_task_lists(soup: BeautifulSoup) -> None:
    """GFM emits `<li><input type=checkbox>`; the editor wants its own shape."""
    for unordered in soup.find_all("ul"):
        items = unordered.find_all("li", recursive=False)
        checkboxes = [item for item in items if _leading_checkbox(item) is not None]
        if not checkboxes or len(checkboxes) != len(items):
            continue

        replacement = new_task_list(soup)
        for item in items:
            checkbox = _leading_checkbox(item)
            checked = checkbox is not None and checkbox.has_attr("checked")
            if checkbox is not None:
                checkbox.extract()
            # A single wrapping <p> is pandoc's doing, not the author's; keeping
            # it would put a block inside the inline task body.
            children = [c for c in item.contents if not _is_blank(c)]
            body: Tag = item
            if len(children) == 1 and isinstance(children[0], Tag) and children[0].name == "p":
                body = children[0]
            replacement.append(new_task_item(soup, body=body, checked=checked))
        unordered.replace_with(replacement)


def _normalize_table_of_contents(soup: BeautifulSoup) -> None:
    """Replace an imported static contents page with WikiHub's live TOC node.

    Word and HTML converters usually emit a ``Mục lục`` heading followed by
    linked paragraphs, while PDF extraction has the same numbered lines without
    links. Requiring a recognised title and at least two consecutive entries
    avoids treating an ordinary numbered section as a table of contents.
    """
    # An import can be retried using content that previously passed through
    # WikiHub, so remove an older generated TOC node too.
    for node in soup.select('[data-type="tableOfContents"], nav[data-type="table-of-contents"]'):
        node.decompose()

    # A PDF's block segmentation can glue a short, distinctly styled contents
    # title onto the very next line when the two sit close together on the
    # page, producing one paragraph such as "Mục lục 1  Architecture .... 4".
    # The title's own text is too small a fraction of that paragraph's spans
    # to read as a heading, so it never becomes an <h*> tag the scan below
    # would find. Split it back into a heading-shaped element first.
    for paragraph in list(soup.find_all("p")):
        _split_leading_toc_title(soup, paragraph)

    # A real Heading style is not the only way a document titles its table of
    # contents: Word's own "Insert Table of Contents" workflow commonly sits
    # under a plain bold paragraph instead, deliberately not a heading, so
    # that the title itself does not turn up as an entry inside the very
    # table it introduces. A bare paragraph is far more common than a heading
    # in general prose, though, so - unlike a heading's title, matched loosely
    # against a prefix - a paragraph only qualifies on an exact, whole-text
    # match to a known label.
    for heading in list(soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p"])):
        title_text = heading.get_text()
        is_title = (
            _is_toc_title(title_text)
            if heading.name != "p"
            else _normalized_toc_title(title_text) in _TABLE_OF_CONTENTS_TITLES
        )
        if not is_title:
            continue

        entries: list[Tag] = []
        sibling = heading.find_next_sibling()
        # PDF extraction can insert a standalone page-number paragraph between
        # TOC entries. Once a TOC heading is identified, everything up to the
        # next real heading belongs to that static contents block.
        while isinstance(sibling, Tag) and sibling.name not in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            entries.append(sibling)
            sibling = sibling.find_next_sibling()

        if len(entries) < 2:
            continue

        heading.replace_with(new_table_of_contents(soup))
        for entry in entries:
            entry.decompose()


def _normalized_toc_title(text: str) -> str:
    return " ".join(text.casefold().split())


def _is_toc_title(text: str) -> bool:
    title = _normalized_toc_title(text)
    return title in _TABLE_OF_CONTENTS_TITLES or any(
        title.startswith(f"{label} ") for label in _TABLE_OF_CONTENTS_TITLES
    )


def _split_leading_toc_title(soup: BeautifulSoup, paragraph: Tag) -> None:
    """Split a PDF-merged "title + first entry" paragraph in two.

    Recovering the heading here - rather than teaching the PDF extractor
    about every page layout that can produce this - lets the sibling-based
    scan above take over unchanged. The remainder is required to look like an
    actual contents entry (a leading number, or dot leaders to a page number)
    so an ordinary sentence that happens to start with "Contents" is left
    alone.
    """
    text = paragraph.get_text()
    match = _TOC_TITLE_PREFIX.match(text)
    if not match:
        return
    remainder = text[match.end() :]
    if not (_TOC_ENTRY_NUMBER.match(remainder) or _TOC_ENTRY_DOTS.search(remainder)):
        return

    original = list(paragraph.contents)
    head_nodes, tail_nodes = _split_inline_nodes(soup, original, match.end())
    if not head_nodes or not tail_nodes:
        return

    for node in original:
        if node.parent is not None:
            node.extract()

    heading = soup.new_tag("h3")
    for node in head_nodes:
        heading.append(node)
    for node in tail_nodes:
        paragraph.append(node)
    paragraph.insert_before(heading)


def _split_inline_nodes(
    soup: BeautifulSoup, nodes: list[Any], offset: int
) -> tuple[list[Any], list[Any]]:
    """Split a list of inline nodes at `offset` characters of their text.

    Recurses into tags so a split that falls in the middle of one (a
    ``<strong>`` or ``<span>`` wrapping both the title and its first entry)
    still produces two well-formed fragments, each wrapped in a copy of it.
    """
    head: list[Any] = []
    tail: list[Any] = []
    remaining = offset
    for node in nodes:
        if remaining <= 0:
            tail.append(node)
            continue
        length = len(node.get_text()) if isinstance(node, Tag) else len(str(node))
        if length <= remaining:
            head.append(node)
            remaining -= length
            continue
        if isinstance(node, NavigableString):
            value = str(node)
            head.append(NavigableString(value[:remaining]))
            rest = value[remaining:]
            if rest:
                tail.append(NavigableString(rest))
        else:
            child_head, child_tail = _split_inline_nodes(soup, list(node.contents), remaining)
            if child_head:
                head_tag = soup.new_tag(node.name, attrs=dict(node.attrs))
                for child in child_head:
                    head_tag.append(child)
                head.append(head_tag)
            if child_tail:
                tail_tag = soup.new_tag(node.name, attrs=dict(node.attrs))
                for child in child_tail:
                    tail_tag.append(child)
                tail.append(tail_tag)
        remaining = 0
    return head, tail


def _is_toc_entry(element: Tag) -> bool:
    if element.name in {"h1", "h2", "h3", "h4", "h5", "h6", "nav"}:
        return False
    text = " ".join(element.get_text(" ", strip=True).split())
    return bool(
        element.find("a")
        or _TOC_ENTRY_NUMBER.match(text)
        or _TOC_ENTRY_DOTS.search(text)
    )


def _is_blank(node: object) -> bool:
    """Whitespace between tags, which pandoc emits freely."""
    return isinstance(node, NavigableString) and not str(node).strip()


def _leading_checkbox(item: Tag) -> Tag | None:
    checkbox = item.find("input", attrs={"type": "checkbox"})
    if checkbox is None:
        return None
    # Only a checkbox at the *start* of the item marks a task; one buried in the
    # middle of a sentence is content.
    for node in item.descendants:
        if isinstance(node, NavigableString) and node.strip():
            return None
        if node is checkbox:
            return checkbox
    return None


def _normalize_code_blocks(soup: BeautifulSoup) -> None:
    """Land on `<pre><code class="language-x">`, which lowlight reads."""
    for pre in soup.find_all("pre"):
        language = _language_of(pre)
        code = pre.find("code")
        if code is None:
            code = soup.new_tag("code")
            for child in list(pre.contents):
                code.append(child.extract())
            pre.append(code)
        if language is None:
            language = _language_of(code)
        pre.attrs.pop("class", None)
        code.attrs.pop("class", None)
        if language:
            code["class"] = [f"language-{language}"]


def _language_of(element: Tag | None) -> str | None:
    if element is None:
        return None
    for value in element.get("class") or []:
        token = str(value)
        if token in _SOURCE_CODE_CLASSES:
            continue
        match = _LANGUAGE_CLASS.match(token)
        if match:
            return match.group(1).lower()
    return None


def _normalize_images(soup: BeautifulSoup) -> None:
    """Every image ends up as its own `<p><img></p>`, matching the editor."""
    for img in soup.find_all("img"):
        img.attrs.pop("style", None)
        parent = img.parent
        if isinstance(parent, Tag) and parent.name in {"p", "td", "th", "li", "a"}:
            continue
        paragraph = soup.new_tag("p")
        img.replace_with(paragraph)
        paragraph.append(img)


def _normalize_links(soup: BeautifulSoup) -> None:
    for anchor in soup.find_all("a"):
        href = str(anchor.get("href") or "").strip()
        if href.startswith("#") or href.startswith(_SAFE_LINK_SCHEMES) or href.startswith("/"):
            continue
        # Not a scheme we keep. Unwrap rather than delete: the link text is
        # content the author wrote, and losing it loses meaning.
        anchor.unwrap()


def _normalize_tables(soup: BeautifulSoup) -> None:
    for table in soup.find_all("table"):
        _demote_single_row_header(soup, table)
        for cell in table.find_all(["td", "th"]):
            for attribute in ("colspan", "rowspan"):
                raw = cell.get(attribute)
                if raw is None:
                    continue
                try:
                    span = int(str(raw))
                except (TypeError, ValueError):
                    span = 0
                if span <= 1:
                    cell.attrs.pop(attribute, None)
                else:
                    cell[attribute] = str(span)


def _demote_single_row_header(soup: BeautifulSoup, table: Tag) -> None:
    """A one-row table is a styled box, not a header over a body.

    Word's default "Table Grid" style bands the first row for emphasis
    (`w:tblLook w:firstRow="1"`) whether or not the table actually has one,
    and a docx author reaches for a single-row, single-column table as
    nothing more than a bordered box - to frame a code sample or a diagram -
    far more often than as a genuine one-row table of labels. Pandoc reads
    that banding as "this is a header row" and emits `<th>`, which the
    editor renders bold by default; a plain paragraph of code has no
    business inheriting that.
    """
    rows = table.find_all("tr")
    if len(rows) != 1:
        return
    for cell in rows[0].find_all("th", recursive=False):
        cell.name = "td"
    thead = table.find("thead", recursive=False)
    if thead is None:
        return
    tbody = table.find("tbody", recursive=False)
    if tbody is None:
        tbody = soup.new_tag("tbody")
        thead.insert_after(tbody)
    for child in list(thead.contents):
        tbody.insert(0, child.extract())
    thead.decompose()


def _collapse_empty_paragraphs(soup: BeautifulSoup) -> None:
    for paragraph in soup.find_all("p"):
        if paragraph.get_text(strip=True):
            continue
        if paragraph.find(["img", "br", "table", "a"]):
            continue
        paragraph.decompose()


# --------------------------------------------------------------------------
# length
# --------------------------------------------------------------------------


def _truncate_to_blocks(soup: BeautifulSoup, *, max_chars: int) -> tuple[str, int | None]:
    """Trim to whole top-level blocks, never mid-tag.

    Returns the HTML and, when it was trimmed, roughly what percentage of the
    original survived - the number the user is told.
    """
    rendered = str(soup)
    if len(rendered) <= max_chars:
        return rendered, None

    notice = (
        f'<p class="{TRUNCATION_NOTICE_CLASS}"><em>This document was longer than WikiHub '
        "can store on one page, so it was truncated here.</em></p>"
    )
    budget = max_chars - len(notice)
    kept: list[str] = []
    used = 0
    for child in list(soup.contents):
        piece = str(child)
        if used + len(piece) > budget:
            break
        kept.append(piece)
        used += len(piece)

    percent = max(1, round(used / len(rendered) * 100))
    return "".join(kept) + notice, percent
