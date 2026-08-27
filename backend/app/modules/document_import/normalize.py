"""Reshape converted HTML into markup the Tiptap editor renders faithfully.

The reason this pass exists is a ProseMirror property that is easy to miss:
when the editor meets a node its schema does not know, it drops that node *and
everything inside it*. So a document wrapped in `<section>` or `<div>` does not
merely lose its wrapper - it loses its text. Every transform below is either
"unwrap something the schema has no node for" or "rewrite a construct into the
exact shape WikiHub's own editor produces".

Title derivation lives here too, because it is the same walk: the first heading
becomes the page title *and is removed from the body*, since WikiHub renders the
title above the content and leaving it would show it twice.
"""

from __future__ import annotations

import re
from pathlib import Path

from bs4 import BeautifulSoup, Comment, NavigableString, Tag

from app.modules.pages.tiptap_html import new_task_item, new_task_list
from app.schemas.page import MAX_PAGE_CONTENT_CHARS

#: Wrappers with no Tiptap equivalent. Unwrapped, never removed - their children
#: are the document.
_UNWRAP_TAGS = (
    "html", "head", "body", "section", "article", "header", "footer",
    "main", "nav", "aside", "figure", "center", "font", "small", "big",
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

#: A metadata title that is really a filename - Word writes these constantly.
_FILENAME_TITLE = re.compile(r"^(microsoft word\s*-\s*)?\S+\.(doc|docx|pdf|rtf|odt|txt)$", re.I)

TRUNCATION_NOTICE_CLASS = "import-truncation-notice"


def normalize_document_html(
    html: str,
    *,
    filename: str,
    metadata_title: str | None = None,
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
    _unwrap_containers(soup)
    # Attribute stripping runs *before* task lists are rebuilt, and after code
    # blocks: the code pass needs pandoc's `sourceCode python` classes to read
    # the language off, while the task pass emits WikiHub's own Tailwind classes
    # that stripping would otherwise throw away.
    _strip_attributes(soup)
    _normalize_task_lists(soup)

    title = _take_title(soup, metadata_title=metadata_title, filename=filename)

    _collapse_empty_paragraphs(soup)
    result, truncated_percent = _truncate_to_blocks(soup, max_chars=max_chars)
    if truncated_percent is not None:
        warnings.append(
            f"This document was longer than WikiHub can store on one page; "
            f"about {truncated_percent}% of it was imported."
        )
    return result, title, warnings


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
    # A `div` or `span` carrying an editor data-attribute is a real node; a bare
    # one is layout scaffolding the editor would drop along with its text.
    for element in soup.find_all(["div", "span"]):
        if not any(str(key).startswith("data-") for key in element.attrs):
            element.unwrap()


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


def _collapse_empty_paragraphs(soup: BeautifulSoup) -> None:
    for paragraph in soup.find_all("p"):
        if paragraph.get_text(strip=True):
            continue
        if paragraph.find(["img", "br", "table", "a"]):
            continue
        paragraph.decompose()


# --------------------------------------------------------------------------
# title
# --------------------------------------------------------------------------


#: How much text may precede a heading for it to still count as the document's
#: title. A cover line, a date or a document number is fine; a page of prose
#: means the heading is a section heading, and consuming it would delete it.
_TITLE_LEAD_IN_CHARS = 200


def _take_title(soup: BeautifulSoup, *, metadata_title: str | None, filename: str) -> str:
    """The leading heading, removed from the body, else metadata, else the filename."""
    heading = _leading_heading(soup)
    if heading is not None:
        text = " ".join(heading.get_text().split())
        heading.decompose()
        return text

    if metadata_title:
        cleaned = " ".join(metadata_title.split())
        if cleaned and not _FILENAME_TITLE.match(cleaned):
            return cleaned[:255]

    stem = Path(filename).stem.strip()
    # `Path(".docx").stem` is ".docx" - a dotfile has no suffix as far as
    # pathlib is concerned, and that is not a title anyone wants to read.
    if not stem or stem.startswith("."):
        return "Imported page"
    return stem[:255]


def _leading_heading(soup: BeautifulSoup) -> Tag | None:
    """The first heading, provided it actually leads the document."""
    preceding = 0
    for element in soup.children:
        if _is_blank(element):
            continue
        if isinstance(element, Tag) and element.name in {"h1", "h2", "h3"}:
            text = " ".join(element.get_text().split())
            return element if 1 <= len(text) <= 255 else None
        text = element.get_text() if isinstance(element, Tag) else str(element)
        preceding += len(text.strip())
        if preceding > _TITLE_LEAD_IN_CHARS:
            return None
    return None


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
