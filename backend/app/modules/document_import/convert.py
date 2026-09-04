"""Turn one uploaded document into HTML plus a list of extracted images.

Every reader here returns the same `ExtractedDocument`, so the rest of the
import pipeline never branches on format. Images are *not* resolved to URLs at
this stage: an attachment needs a `page_id`, and the page does not exist yet.
Instead each image gets an opaque token written into the HTML in place of its
`src`, which the worker swaps for the real attachment URL once the page is
created. See `service.py` for that ordering.

Security posture, since everything this module touches is attacker-authored:

* pandoc is invoked with `raw_html` disabled on every reader, so its AST has no
  place to put a `<script>` or an event handler. That is the first of two XSS
  layers; `sanitize.py` is the second.
* `--standalone` and `--embed-resources` are never passed. Both make pandoc
  fetch remote resources, which turns an uploaded `.html` file into SSRF.
* `--extract-media` writes files, and the paths in the resulting `<img src>`
  come from the document. Every one of them is checked against the media root
  before it is read. See `_collect_pandoc_media`.
"""

from __future__ import annotations

import asyncio
import hashlib
import html as html_module
import mimetypes
import re
import urllib.parse
import uuid
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import anyio.to_thread
from bs4 import BeautifulSoup, Tag
from lxml import etree
from soupsieve import SelectorSyntaxError

from app.core.config import settings
from app.core.exceptions import BadRequestError, ServiceUnavailableError
from app.core.logging import get_logger

logger = get_logger(__name__)

#: Extension -> internal format name. `.docm` and friends are deliberately
#: absent: macro-enabled containers have no place in an import path.
FORMAT_BY_EXTENSION: dict[str, str] = {
    "docx": "docx",
    "odt": "odt",
    "rtf": "rtf",
    "epub": "epub",
    "html": "html",
    "htm": "html",
    "md": "markdown",
    "markdown": "markdown",
    "pdf": "pdf",
}

#: pandoc reader per format. The `-raw_html` suffix disables pass-through of raw
#: HTML *at the reader*, which is why an uploaded `.html` or `.md` cannot carry
#: markup pandoc does not understand into the output.
_PANDOC_READER: dict[str, str] = {
    "docx": "docx",
    "odt": "odt",
    "rtf": "rtf",
    "epub": "epub",
    "html": "html-raw_html",
    # pandoc's own Markdown reader, not `gfm`: verified against pandoc 3.5,
    # `gfm-raw_html` still passes `<script>` straight through to the output,
    # while `markdown-raw_html` escapes it to text. Both keep pipe tables and
    # task lists, so this costs nothing and is the one that actually holds.
    "markdown": "markdown-raw_html",
}

#: Formats whose source file can carry embedded binary media.
_EXTRACTS_MEDIA = frozenset({"docx", "odt", "rtf", "epub"})

#: Prefix of the placeholder written into the HTML in place of an image `src`.
#: Opaque and uuid-suffixed so it cannot collide with real document content.
MEDIA_TOKEN_PREFIX = "wikihub-import-media:"  # noqa: S105 - a placeholder, not a secret

_MEDIA_TOKEN_RE = re.compile(re.escape(MEDIA_TOKEN_PREFIX) + r"[0-9a-f]{32}")


class DocumentTooComplexError(BadRequestError):
    """The document is within the size limit but unpacks past a resource ceiling."""


@dataclass(slots=True)
class ExtractedMedia:
    """One image pulled out of a document, not yet attached to any page."""

    token: str
    filename: str
    data: bytes
    content_type: str


@dataclass(slots=True)
class ExtractedDocument:
    html: str
    media: list[ExtractedMedia] = field(default_factory=list)
    metadata_title: str | None = None
    warnings: list[str] = field(default_factory=list)


def format_for_filename(filename: str) -> str | None:
    """The internal format name for `filename`, or None if unsupported."""
    return FORMAT_BY_EXTENSION.get(Path(filename).suffix.lower().lstrip("."))


def new_media_token() -> str:
    return f"{MEDIA_TOKEN_PREFIX}{uuid.uuid4().hex}"


def replace_media_tokens(html: str, urls: dict[str, str]) -> str:
    """Swap every media token for its attachment URL.

    A token with no entry in `urls` belongs to an image that was rejected (too
    large, disallowed type). Its `<img>` is removed rather than left pointing at
    a placeholder that would render as a broken image forever.
    """
    if not html:
        return html
    soup = BeautifulSoup(html, "html.parser")
    for img in soup.find_all("img"):
        if not isinstance(img, Tag):
            continue
        src = str(img.get("src") or "")
        if not src.startswith(MEDIA_TOKEN_PREFIX):
            continue
        resolved = urls.get(src)
        if resolved is None:
            _drop_image(img)
            continue
        img["src"] = resolved
    result = str(soup)
    # Belt and braces: a token surviving anywhere else (an alt text, a stray
    # attribute) must not be stored as if it were content.
    return _MEDIA_TOKEN_RE.sub("", result)


def _drop_image(img: Tag) -> None:
    """Remove an image, and the paragraph wrapping it if that leaves it empty."""
    parent = img.parent
    img.decompose()
    if (
        isinstance(parent, Tag)
        and parent.name == "p"
        and not parent.get_text(strip=True)
        and not parent.find_all(["img", "table", "a"])
    ):
        parent.decompose()


async def extract_document(source: Path, *, filename: str, workdir: Path) -> ExtractedDocument:
    """Convert `source` to HTML plus its embedded media.

    `workdir` must be a directory this call may write into freely; the caller
    owns its lifetime (one temp dir per file, see `service.py`).
    """
    doc_format = format_for_filename(filename)
    if doc_format is None:
        raise BadRequestError(f"WikiHub cannot import {Path(filename).suffix or 'this file type'}.")
    if doc_format == "pdf":
        return await extract_pdf(source)
    return await extract_with_pandoc(source, doc_format=doc_format, workdir=workdir)


# --------------------------------------------------------------------------
# pandoc-backed formats
# --------------------------------------------------------------------------


def build_pandoc_args(source: Path, *, doc_format: str, workdir: Path) -> list[str]:
    """The exact argv. Split out so a test can assert on it without a subprocess."""
    output = workdir / "converted.html"
    args = [
        settings.pandoc_binary,
        f"--from={_PANDOC_READER[doc_format]}",
        "--to=html",
        # No hard-wrapped source: Tiptap does its own wrapping, and wrapped
        # output makes the normalisation pass fight with stray whitespace.
        "--wrap=none",
        # Plain `<pre><code class="language-x">` rather than pandoc's
        # `<div class="sourceCode">` span soup, which is what the editor's
        # lowlight extension expects.
        "--no-highlight",
    ]
    if doc_format in _EXTRACTS_MEDIA:
        args.append(f"--extract-media={workdir / 'media'}")
    args += ["-o", str(output), str(source)]
    return args


async def extract_with_pandoc(
    source: Path, *, doc_format: str, workdir: Path
) -> ExtractedDocument:
    output = workdir / "converted.html"
    args = build_pandoc_args(source, doc_format=doc_format, workdir=workdir)

    try:
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=settings.document_import_convert_timeout_seconds,
        )
    except TimeoutError as exc:
        raise ServiceUnavailableError(
            "Converting this document timed out. It may be too large or too complex."
        ) from exc
    except OSError as exc:
        raise ServiceUnavailableError(
            "Document conversion is not available on this server."
        ) from exc

    if process.returncode != 0 or not output.exists():
        logger.error(
            "document_conversion_failed",
            doc_format=doc_format,
            returncode=process.returncode,
            stderr=stderr.decode("utf-8", errors="replace")[:2000],
        )
        raise BadRequestError(
            "This document could not be converted. It may be corrupt or password-protected."
        )

    # Check the size before reading: a zip bomb converts to enormous HTML, and
    # `read_text` on it would be the thing that kills the worker.
    if output.stat().st_size > settings.document_import_max_media_bytes:
        raise DocumentTooComplexError(
            "This document converts to more content than WikiHub can process."
        )

    html = output.read_text(encoding="utf-8", errors="replace")
    if doc_format == "docx":
        html = _enrich_docx_table_formatting(html, source)
    elif doc_format == "html":
        html = _preserve_html_table_formatting(source, html)
    return _collect_pandoc_media(html, workdir=workdir, doc_format=doc_format)


_DOCX_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
_DOCX_HEX = re.compile(r"^[0-9a-fA-F]{6}$")


def _enrich_docx_table_formatting(html: str, source: Path) -> str:
    """Carry Word table formatting into Pandoc's HTML fragment.

    Pandoc intentionally focuses on semantic HTML and can omit direct OOXML
    table properties (notably cell shading and paragraph alignment).  Those
    properties are safe to copy as a small inline-style allowlist because the
    result still passes through ``sanitize_imported_html`` later.
    """
    try:
        with zipfile.ZipFile(source) as archive:
            document = etree.fromstring(
                archive.read("word/document.xml"),
                parser=etree.XMLParser(resolve_entities=False, no_network=True),
            )
    except (OSError, KeyError, etree.XMLSyntaxError, zipfile.BadZipFile):
        # A malformed DOCX will be rejected by Pandoc; do not turn a missing
        # optional fidelity enhancement into a different import failure.
        return html

    soup = BeautifulSoup(html or "", "html.parser")
    html_tables = soup.find_all("table")
    docx_tables = document.findall(".//w:tbl", _DOCX_NS)
    for html_table, docx_table in zip(html_tables, docx_tables, strict=False):
        column_widths = _docx_table_column_widths(docx_table)
        total_width = sum(column_widths)
        if total_width:
            _merge_inline_style(html_table, "width", "100%")
        html_rows = _direct_html_table_rows(html_table)
        docx_rows = docx_table.findall("./w:tr", _DOCX_NS)
        for html_row, docx_row in zip(html_rows, docx_rows, strict=False):
            html_cells = html_row.find_all(["th", "td"], recursive=False)
            docx_cells = docx_row.findall("./w:tc", _DOCX_NS)
            column = 0
            for html_cell, docx_cell in zip(html_cells, docx_cells, strict=False):
                span = _docx_cell_grid_span(docx_cell)
                widths = column_widths[column : column + span]
                if widths and total_width:
                    width_percent = sum(widths) / total_width * 100
                    _merge_inline_style(html_cell, "width", f"{width_percent:.4f}%")
                column += span
                cell_properties = docx_cell.find("./w:tcPr", _DOCX_NS)
                if cell_properties is not None:
                    _apply_docx_cell_style(html_cell, cell_properties)

                html_paragraphs = html_cell.find_all("p", recursive=False)
                docx_paragraphs = docx_cell.findall("./w:p", _DOCX_NS)
                if not html_paragraphs and docx_paragraphs:
                    alignment = _docx_paragraph_alignment(docx_paragraphs[0])
                    if alignment:
                        _merge_inline_style(html_cell, "text-align", alignment)
                    color = _docx_paragraph_color(docx_paragraphs[0])
                    if color:
                        _merge_inline_style(html_cell, "color", color)
                for html_paragraph, docx_paragraph in zip(
                    html_paragraphs, docx_paragraphs, strict=False
                ):
                    css_alignment = _docx_paragraph_alignment(docx_paragraph)
                    if css_alignment:
                        if len(docx_paragraphs) == 1:
                            _merge_inline_style(html_cell, "text-align", css_alignment)
                        _merge_inline_style(html_paragraph, "text-align", css_alignment)
                    color = _docx_paragraph_color(docx_paragraph)
                    if color:
                        if len(docx_paragraphs) == 1:
                            _merge_inline_style(html_cell, "color", color)
                        _merge_inline_style(html_paragraph, "color", color)
    return str(soup)


def _direct_html_table_rows(table: Tag) -> list[Tag]:
    """Return this table's rows without accidentally including nested tables."""
    rows: list[Tag] = []
    sections = table.find_all(["thead", "tbody", "tfoot"], recursive=False)
    containers = sections or [table]
    for container in containers:
        rows.extend(container.find_all("tr", recursive=False))
    return rows


def _docx_table_column_widths(table: Any) -> list[int]:
    grid = table.findall("./w:tblGrid/w:gridCol", _DOCX_NS)
    widths: list[int] = []
    for column in grid:
        raw = column.get(f"{{{_DOCX_NS['w']}}}w")
        try:
            width = int(raw or "0")
        except ValueError:
            width = 0
        widths.append(width if width > 0 else 0)
    return widths


def _docx_cell_grid_span(cell: Any) -> int:
    span = cell.find("./w:tcPr/w:gridSpan", _DOCX_NS)
    raw = span.get(f"{{{_DOCX_NS['w']}}}val") if span is not None else None
    try:
        return max(1, int(raw or "1"))
    except ValueError:
        return 1


def _apply_docx_cell_style(cell: Tag, properties: Any) -> None:
    shading = properties.find("./w:shd", _DOCX_NS)
    fill = shading.get(f"{{{_DOCX_NS['w']}}}fill") if shading is not None else None
    if fill and _DOCX_HEX.fullmatch(fill):
        _merge_inline_style(cell, "background-color", f"#{fill.lower()}")

    vertical = properties.find("./w:vAlign", _DOCX_NS)
    vertical_value = vertical.get(f"{{{_DOCX_NS['w']}}}val") if vertical is not None else None
    css_vertical = {"top": "top", "center": "middle", "bottom": "bottom"}.get(vertical_value or "")
    if css_vertical:
        _merge_inline_style(cell, "vertical-align", css_vertical)

    borders = properties.find("./w:tcBorders", _DOCX_NS)
    if borders is not None:
        colors = []
        for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
            border = borders.find(f"./w:{side}", _DOCX_NS)
            color = border.get(f"{{{_DOCX_NS['w']}}}color") if border is not None else None
            if color and _DOCX_HEX.fullmatch(color):
                colors.append(color.lower())
        if colors:
            _merge_inline_style(cell, "border", f"1px solid #{colors[0]}")


def _docx_paragraph_alignment(paragraph: Any) -> str | None:
    properties = paragraph.find("./w:pPr", _DOCX_NS)
    alignment = properties.find("./w:jc", _DOCX_NS) if properties is not None else None
    value = alignment.get(f"{{{_DOCX_NS['w']}}}val") if alignment is not None else None
    return {
        "start": "left",
        "left": "left",
        "center": "center",
        "end": "right",
        "right": "right",
        "both": "justify",
    }.get(value or "")


def _docx_paragraph_color(paragraph: Any) -> str | None:
    colors = {
        color.get(f"{{{_DOCX_NS['w']}}}val", "").lower()
        for color in paragraph.findall("./w:r/w:rPr/w:color", _DOCX_NS)
    }
    colors.discard("")
    colors.discard("auto")
    if len(colors) == 1 and _DOCX_HEX.fullmatch(next(iter(colors))):
        return f"#{next(iter(colors))}"
    return None


def _merge_inline_style(element: Tag, property_name: str, value: str) -> None:
    """Set one declaration without discarding styles already emitted by Pandoc."""
    declarations: dict[str, str] = {}
    for declaration in str(element.get("style") or "").split(";"):
        if ":" not in declaration:
            continue
        name, existing_value = declaration.split(":", 1)
        declarations[name.strip().lower()] = existing_value.strip()
    declarations[property_name] = value
    element["style"] = "; ".join(
        f"{name}: {existing_value}" for name, existing_value in declarations.items()
    )


_HTML_FORMATTING_PROPERTIES = frozenset(
    {
        "background-color",
        "border",
        "border-collapse",
        "border-color",
        "border-style",
        "border-width",
        "color",
        "display",
        "font-family",
        "font-size",
        "font-style",
        "font-weight",
        "padding",
        "text-align",
        "text-decoration",
        "vertical-align",
        "white-space",
        "width",
    }
)

# Applying a report stylesheet requires matching every selector against every
# source node.  For multi-megabyte scanner exports this can inflate the HTML
# far beyond the editor's storage ceiling (and make an otherwise valid import
# collapse to its truncation notice).  Keep the semantic Pandoc output intact
# for these reports; table structure and text are more important than cosmetic
# source CSS.
MAX_HTML_STYLE_ENRICHMENT_BYTES = 1_000_000


def _preserve_html_table_formatting(source: Path, converted_html: str) -> str:
    """Carry safe CSS formatting from an HTML report into Pandoc's fragment.

    Pandoc keeps the table structure but does not keep a document stylesheet.
    Applying the stylesheet to the source DOM first lets us copy only the
    computed formatting onto corresponding table nodes in Pandoc's output.
    """
    try:
        if source.stat().st_size > MAX_HTML_STYLE_ENRICHMENT_BYTES:
            return converted_html
        source_soup = BeautifulSoup(
            source.read_text(encoding="utf-8", errors="replace"), "html.parser"
        )
    except OSError:
        return converted_html
    _apply_safe_html_styles(source_soup)
    target_soup = BeautifulSoup(converted_html or "", "html.parser")
    _preserve_html_block_formatting(source_soup, target_soup)
    source_tables = source_soup.find_all("table")
    target_tables = target_soup.find_all("table")
    for source_table, target_table in zip(source_tables, target_tables, strict=False):
        _copy_safe_style(source_table, target_table)
        source_rows = _direct_html_table_rows(source_table)
        target_rows = _direct_html_table_rows(target_table)
        for source_row, target_row in zip(source_rows, target_rows, strict=False):
            _copy_safe_style(source_row, target_row)
            row_style = _safe_css_declarations(str(source_row.get("style") or ""))
            source_cells = source_row.find_all(["th", "td"], recursive=False)
            target_cells = target_row.find_all(["th", "td"], recursive=False)
            for source_cell, target_cell in zip(source_cells, target_cells, strict=False):
                _copy_safe_style(source_cell, target_cell)
                if row_style.get("background-color") and not _safe_css_declarations(
                    str(source_cell.get("style") or "")
                ).get("background-color"):
                    _merge_inline_style(
                        target_cell, "background-color", row_style["background-color"]
                    )
                _apply_html_text_marks(target_cell)
        _repair_html_table_grid(source_table, target_table)
    return str(target_soup)


_FORMATTED_BLOCK_TAGS = ("p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "li")
_INLINE_STYLE_PROPERTIES = ("color", "font-size")
_LIST_INHERITED_STYLE_PROPERTIES = frozenset(
    {
        "color",
        "font-family",
        "font-size",
        "font-style",
        "font-weight",
        "text-align",
        "text-decoration",
    }
)


def _preserve_html_block_formatting(source_soup: BeautifulSoup, target_soup: BeautifulSoup) -> None:
    """Copy text formatting that Pandoc intentionally omits from HTML output.

    Report styles frequently use CSS selectors instead of inline markup. The
    source stylesheet has already been reduced to the safe allowlist above;
    match like-for-like block elements outside tables, then express typography
    through marks that the Tiptap schema understands.
    """
    for name in _FORMATTED_BLOCK_TAGS:
        source_blocks = _blocks_outside_tables(source_soup, name)
        target_blocks = _blocks_outside_tables(target_soup, name)
        for source_block, target_block in zip(source_blocks, target_blocks, strict=False):
            style = _block_style(source_block)
            if not style:
                continue
            _copy_style_declarations(target_block, style)
            _apply_html_text_marks(target_block)
            _wrap_inline_text_style(target_block, style)


def _blocks_outside_tables(soup: BeautifulSoup, name: str) -> list[Tag]:
    return [element for element in soup.find_all(name) if element.find_parent("table") is None]


def _block_style(block: Tag) -> dict[str, str]:
    style: dict[str, str] = {}
    # List formatting (for example `ul { text-align: center }`) is inherited by
    # its list items in a browser. Make that inheritance explicit so it survives
    # Tiptap, whose list wrapper does not store arbitrary CSS attributes.
    if block.name == "li":
        parents = [parent for parent in block.parents if isinstance(parent, Tag)]
        for parent in reversed(parents):
            if parent.name in {"ul", "ol"}:
                style.update(
                    {
                        name: value
                        for name, value in _safe_css_declarations(
                            str(parent.get("style") or "")
                        ).items()
                        if name in _LIST_INHERITED_STYLE_PROPERTIES
                    }
                )
    style.update(_safe_css_declarations(str(block.get("style") or "")))
    return style


def _copy_style_declarations(target: Tag, declarations: dict[str, str]) -> None:
    for property_name, value in declarations.items():
        _merge_inline_style(target, property_name, value)


def _wrap_inline_text_style(block: Tag, style: dict[str, str]) -> None:
    inline_style = {
        name: style[name] for name in _INLINE_STYLE_PROPERTIES if name in style
    }
    if not inline_style or not block.contents:
        return
    wrapper = BeautifulSoup("", "html.parser").new_tag("span")
    wrapper["style"] = "; ".join(
        f"{name}: {value}" for name, value in inline_style.items()
    )
    for child in list(block.contents):
        child.extract()
        wrapper.append(child)
    block.append(wrapper)


def _repair_html_table_grid(source_table: Tag, target_table: Tag) -> None:
    """Remove a column that only exists because a source colspan is too wide.

    Browsers are forgiving when a report has a heading such as
    ``<th colspan=\"6\">`` followed by five-column data rows: the final grid
    column has zero visible width. Pandoc materialises that implied column,
    however, and ProseMirror faithfully displays it as a blank sixth cell.

    A real table can use colspans, so this deliberately repairs only a span
    wider than the widest *physical* row in that same source table. This is the
    malformed-report case and leaves valid merged-cell tables untouched.
    """
    source_rows = _direct_html_table_rows(source_table)
    physical_widths = [
        len(row.find_all(["th", "td"], recursive=False)) for row in source_rows
    ]
    canonical_width = max(physical_widths, default=0)
    if canonical_width < 2:
        return

    # Do nothing for a well-formed table. In particular, do not collapse a
    # valid 5-column table merely because it also has a two-cell row with a
    # normal colspan.
    has_oversized_span = any(
        _table_cell_span(cell, "colspan") > canonical_width
        for row in source_rows
        for cell in row.find_all(["th", "td"], recursive=False)
    )
    if not has_oversized_span:
        return

    for row in _direct_html_table_rows(target_table):
        occupied = 0
        for cell in list(row.find_all(["th", "td"], recursive=False)):
            span = _table_cell_span(cell, "colspan")
            remaining = canonical_width - occupied
            if remaining <= 0:
                cell.decompose()
                continue
            if span > remaining:
                if remaining == 1:
                    cell.attrs.pop("colspan", None)
                else:
                    cell["colspan"] = str(remaining)
                span = remaining
            occupied += span


def _table_cell_span(cell: Tag, attribute: str) -> int:
    try:
        return max(1, int(str(cell.get(attribute) or "1")))
    except (TypeError, ValueError):
        return 1


def _apply_safe_html_styles(soup: BeautifulSoup) -> None:
    css = "\n".join(style.get_text() for style in soup.find_all("style"))
    # Stylesheets exported by report tools commonly begin with a remote font
    # import, and some omit the optional semicolon. We never fetch remote CSS;
    # remove the whole directive before parsing local formatting rules.
    css = re.sub(r"@import\s+(?:url\([^)]*\)|[\"'][^\"']*[\"'])\s*;?", "", css, flags=re.I)
    inline_styles = {
        id(element): _safe_css_declarations(str(element.get("style") or ""))
        for element in soup.find_all(True)
    }
    priorities: dict[int, dict[str, tuple[int, int]]] = {}
    for order, match in enumerate(re.finditer(r"([^{}]+)\{([^{}]*)\}", css)):
        declarations = _safe_css_declarations(match.group(2))
        if not declarations:
            continue
        for selector in match.group(1).split(","):
            selector = selector.strip()
            # @font-face, @media and other at-rules have no DOM selector. The
            # simple report-CSS walker below deliberately handles only ordinary
            # local selectors; skipping at-rules also prevents malformed remote
            # imports from rejecting an otherwise usable HTML document.
            if not selector or selector.startswith("@"):
                continue
            try:
                elements = soup.select(selector)
            except (SelectorSyntaxError, TypeError, ValueError):
                continue
            specificity = _css_specificity(selector)
            for element in elements:
                element_id = id(element)
                element_priorities = priorities.setdefault(element_id, {})
                for property_name, value in declarations.items():
                    previous = element_priorities.get(property_name)
                    if previous is None or (specificity, order) >= previous:
                        _merge_inline_style(element, property_name, value)
                        element_priorities[property_name] = (specificity, order)
    for element in soup.find_all(True):
        for property_name, value in inline_styles.get(id(element), {}).items():
            _merge_inline_style(element, property_name, value)


def _safe_css_declarations(css: str) -> dict[str, str]:
    declarations: dict[str, str] = {}
    for declaration in css.split(";"):
        if ":" not in declaration:
            continue
        property_name, value = declaration.split(":", 1)
        property_name = property_name.strip().lower()
        value = value.strip()
        if property_name in _HTML_FORMATTING_PROPERTIES and value:
            declarations[property_name] = value
    return declarations


def _css_specificity(selector: str) -> int:
    """A small CSS specificity score sufficient for report-style selectors."""
    return (
        selector.count("#") * 100
        + (selector.count(".") + selector.count("[") + selector.count(":")) * 10
        + len(re.findall(r"(?:^|[ >+~])([a-zA-Z][\w-]*)", selector))
    )


def _copy_safe_style(source: Tag, target: Tag) -> None:
    style = _safe_css_declarations(str(source.get("style") or ""))
    if style:
        target["style"] = "; ".join(f"{name}: {value}" for name, value in style.items())


def _apply_html_text_marks(cell: Tag) -> None:
    style = _safe_css_declarations(str(cell.get("style") or ""))
    marks: list[str] = []
    if style.get("font-weight", "").lower() in {"bold", "bolder", "600", "700", "800", "900"}:
        marks.append("strong")
    if style.get("font-style", "").lower() in {"italic", "oblique"}:
        marks.append("em")
    if "underline" in style.get("text-decoration", "").lower():
        marks.append("u")
    for name in marks:
        if cell.find(name, recursive=False) is not None:
            continue
        wrapper = BeautifulSoup("", "html.parser").new_tag(name)
        for child in list(cell.contents):
            child.extract()
            wrapper.append(child)
        cell.append(wrapper)


def _collect_pandoc_media(
    html: str, *, workdir: Path, doc_format: str
) -> ExtractedDocument:
    """Read every extracted image and replace its `src` with a token.

    The traversal guard is the point of this function. `--extract-media` rewrites
    `<img src>` to a path relative to the output file, but the *name* inside that
    path comes from the document, so a crafted `.docx` can ask for
    `../../etc/passwd`. Order matters: `is_symlink()` is tested on the
    unresolved path, because `resolve()` follows the link and would launder a
    symlink into a path that genuinely is under the media root.
    """
    media_root = (workdir / "media").resolve()
    soup = BeautifulSoup(html, "html.parser")
    media: list[ExtractedMedia] = []
    messages: list[str] = []
    dropped = 0
    total_bytes = 0

    for img in soup.find_all("img"):
        if not isinstance(img, Tag):
            continue
        raw = str(img.get("src") or "").strip()
        if not raw:
            _drop_image(img)
            continue
        if raw.startswith(("http://", "https://")):
            # Kept as-is and never fetched: following it server-side is SSRF.
            continue
        if raw.startswith("data:"):
            # pandoc does not emit these once --extract-media is on, and we are
            # not going to parse an attacker-supplied data URI.
            _drop_image(img)
            dropped += 1
            continue

        resolved = _resolve_media_path(raw, workdir=workdir, media_root=media_root)
        if resolved is None:
            _drop_image(img)
            dropped += 1
            continue

        if len(media) >= settings.document_import_max_media_count:
            raise DocumentTooComplexError(
                f"This document contains more than "
                f"{settings.document_import_max_media_count} images."
            )
        size = resolved.stat().st_size
        total_bytes += size
        if total_bytes > settings.document_import_max_media_bytes:
            raise DocumentTooComplexError(
                "The images in this document exceed what WikiHub will unpack."
            )

        token = new_media_token()
        media.append(
            ExtractedMedia(
                token=token,
                filename=resolved.name,
                data=resolved.read_bytes(),
                content_type=_guess_image_type(resolved.name),
            )
        )
        img["src"] = token

    if dropped and doc_format in {"html", "markdown"}:
        messages.append(
            f"{dropped} image{'s' if dropped != 1 else ''} referenced files that were not "
            "uploaded, so they were removed."
        )
    elif dropped:
        messages.append(
            f"{dropped} image{'s' if dropped != 1 else ''} could not be read from the document."
        )

    return ExtractedDocument(html=str(soup), media=media, metadata_title=None, warnings=messages)


def _resolve_media_path(raw: str, *, workdir: Path, media_root: Path) -> Path | None:
    """The real file for a pandoc-extracted `src`, or None if it is not one."""
    relative = urllib.parse.unquote(raw)
    try:
        candidate = workdir / relative
        # Tested before resolve(): resolve() follows symlinks, so a link placed
        # inside the media root would pass the containment check below.
        if candidate.is_symlink():
            return None
        resolved = candidate.resolve()
    except (OSError, ValueError):
        return None
    if not resolved.is_relative_to(media_root):
        return None
    if not resolved.is_file() or resolved.is_symlink():
        return None
    return resolved


def _guess_image_type(filename: str) -> str:
    guessed, _ = mimetypes.guess_type(filename)
    if guessed and guessed.startswith("image/"):
        return guessed
    return "application/octet-stream"


# --------------------------------------------------------------------------
# PDF
# --------------------------------------------------------------------------

#: The placed size on the page is the primary filter: a horizontal rule, a
#: bullet glyph or a spacer is small no matter how it compresses.
_MIN_PDF_IMAGE_EDGE = 8.0
#: A secondary catch for degenerate images that are placed large but carry no
#: detail (a solid-colour rectangle used as a background wash). Kept low on
#: purpose - a simple line diagram can compress very well and is still content.
_MIN_PDF_IMAGE_BYTES = 512

#: How many pages to sample when deciding what body-text size looks like.
_PDF_FONT_SAMPLE_PAGES = 20

#: Font-size ratios (against modal body size) that promote a block to a heading.
_H1_RATIO, _H2_RATIO, _H3_RATIO = 1.6, 1.35, 1.15

_PDF_BOLD_FLAG = 1 << 4
_PDF_CALLOUT_FILL = (0.99, 0.60, 0.0)
#: A code block's own background reads as "code" by being dark, not by
#: matching one specific hue - exporters range from near-black through navy
#: to neutral gray. The page background itself is painted white, so this
#: comfortably separates the two without needing a color to calibrate against
#: for every new document.
_PDF_CODE_MAX_CHANNEL = 0.35


async def extract_pdf(source: Path) -> ExtractedDocument:
    """PyMuPDF is blocking and CPU-bound, so it runs off the event loop."""
    return await anyio.to_thread.run_sync(_extract_pdf_sync, source)


def _extract_pdf_sync(source: Path) -> ExtractedDocument:
    import pymupdf  # imported here so the module stays importable without it

    try:
        document = pymupdf.open(str(source))
    except Exception as exc:  # any failure here means "not a readable PDF"
        raise BadRequestError(
            "This PDF could not be read. It may be corrupt or password-protected."
        ) from exc

    with document:
        if document.needs_pass:
            raise BadRequestError("This PDF is password-protected.")
        if document.page_count > settings.document_import_max_pdf_pages:
            raise DocumentTooComplexError(
                f"This PDF has {document.page_count} pages; the limit is "
                f"{settings.document_import_max_pdf_pages}."
            )

        font_styles = _pdf_font_styles(document)
        body_size = _modal_font_size(document, font_styles)
        parts: list[str] = []
        media: list[ExtractedMedia] = []
        seen_images: set[str] = set()
        total_bytes = 0
        text_blocks = 0
        # A table's last row(s) sometimes carry on the next page - PyMuPDF finds
        # tables per page, so without this a wall-to-wall table split by a page
        # break becomes two separate `<table>` elements with a repeated header
        # in between. Carries the *previous* page's trailing table across the
        # `for page in document` loop; reset to None whenever that table turns
        # out not to have been the last thing on its page (see below).
        pending_continuation: dict[str, Any] | None = None
        # A list's own last item routinely ends at the very bottom of one page
        # and picks up with its next sibling - or, worse, its own nested
        # child - at the top of the next, with no blank line or heading in
        # between to mark a real break. All three of these are shared across
        # the whole `for page in document` loop, not reset per page, so that
        # continuation keeps its nesting level instead of restarting at zero
        # the moment a page boundary falls in the middle of a list. Cleared
        # wherever `_flush_pdf_list` ends the list for real.
        list_items: list[tuple[int, str]] = []
        previous_list_bbox: tuple[float, float, float, float] | None = None
        indent_positions: list[float] = []

        for page in document:
            # `sort=True` gives blocks in reading order, and image blocks arrive
            # interleaved with text - which is what places a figure where it
            # actually belongs instead of dumping every image at the end.
            blocks = _pdf_strip_watermark_lines(
                page.get_text("dict", sort=True).get("blocks", [])
            )
            regions = _pdf_special_regions(page)
            underline_rects = _pdf_underline_rects(page)
            rendered_regions: set[int] = set()
            tables = _pdf_tables(page, regions)
            rendered_tables: set[int] = set()
            # The table (if any) rendered last on this page, so far - becomes
            # next page's `pending_continuation` only if nothing else follows it.
            last_table_info: dict[str, Any] | None = None

            for block in blocks:
                table_index = _pdf_table_for_block(block, tables)
                if table_index is not None:
                    _flush_pdf_list(parts, list_items, indent_positions)
                    previous_list_bbox = None
                    if table_index not in rendered_tables:
                        is_first_table_on_page = not rendered_tables
                        rendered_tables.add(table_index)
                        # A page made up entirely of one or more tables has no
                        # ordinary text block to trip this counter, and would
                        # otherwise be reported as a scanned PDF with nothing
                        # selectable - wrong, since a table is exactly that.
                        text_blocks += 1
                        entry = tables[table_index]
                        rendered_html = _render_pdf_table(
                            entry["html"],
                            rows=entry["rows"],
                            background=entry["background"],
                            text_color=entry["text_color"],
                            header_bottom=entry["header_bottom"],
                        )
                        entry_columns = _pdf_table_column_count(entry["html"])
                        merged_html = None
                        if (
                            is_first_table_on_page
                            and pending_continuation is not None
                            and pending_continuation["column_count"] == entry_columns
                            and abs(pending_continuation["rect"][0] - entry["rect"][0]) <= 8
                        ):
                            merged_html = _merge_pdf_table_continuation(
                                parts[pending_continuation["parts_index"]],
                                rendered_html,
                                pending_continuation["header_rows"],
                                entry["rows"],
                                entry["header_bottom"],
                                # A continuation page that repeats no header has
                                # nothing but position to prove it belongs here,
                                # so it is held to the tighter, both-edges bound;
                                # one whose header text actually matches already
                                # has stronger proof and can tolerate a table
                                # whose right edge drifted a little (a column
                                # that came out narrower on that page).
                                strict_margins=_pdf_table_shares_margins(
                                    pending_continuation["rect"], entry["rect"]
                                ),
                            )
                        if merged_html is not None:
                            parts[pending_continuation["parts_index"]] = merged_html
                            last_table_info = pending_continuation
                        else:
                            parts.append(rendered_html)
                            last_table_info = {
                                "parts_index": len(parts) - 1,
                                "rect": entry["rect"],
                                "column_count": entry_columns,
                                "header_rows": _pdf_table_header_rows_html(
                                    entry["html"], entry["rows"], entry["header_bottom"]
                                ),
                            }
                    continue
                region_index = _pdf_region_for_block(block, regions)
                if region_index is not None:
                    _flush_pdf_list(parts, list_items, indent_positions)
                    previous_list_bbox = None
                    if region_index in rendered_regions:
                        continue
                    rendered_regions.add(region_index)
                    rendered = _render_pdf_region(blocks, regions[region_index])
                    if rendered:
                        parts.append(rendered)
                    continue
                if block.get("type") == 1:
                    _flush_pdf_list(parts, list_items, indent_positions)
                    previous_list_bbox = None
                    rendered, total_bytes = _pdf_image_block(
                        block, media, seen_images, total_bytes, image_decoder=pymupdf
                    )
                    if rendered:
                        parts.append(rendered)
                    continue
                if _pdf_is_page_number(page, block):
                    _flush_pdf_list(parts, list_items, indent_positions)
                    previous_list_bbox = None
                    continue
                if tables:
                    # A block that failed the *whole-block* 0.95 overlap test
                    # above can still have some of its lines sitting inside a
                    # table: PyMuPDF groups text into one physical block by
                    # proximity, not by semantics, so a table's last row or two
                    # - typically ones missing the ruling line `find_tables`
                    # needs to include them - end up fused with the caption or
                    # footnote sitting right underneath. Left whole, that block
                    # would either repeat the table's own text as a stray
                    # paragraph or bury the footnote inside a 0.95 check it
                    # cannot pass. Drop exactly the lines a table already
                    # accounts for and keep the rest.
                    trimmed = _pdf_block_outside_tables(block, tables)
                    if trimmed is None:
                        _flush_pdf_list(parts, list_items, indent_positions)
                        previous_list_bbox = None
                        continue
                    block = trimmed
                numbered_paragraphs = _pdf_block_numbered_paragraphs(
                    block, body_size, font_styles, underline_rects
                )
                if numbered_paragraphs is not None:
                    _flush_pdf_list(parts, list_items, indent_positions)
                    previous_list_bbox = None
                    if numbered_paragraphs:
                        text_blocks += 1
                        parts.extend(numbered_paragraphs)
                    continue
                list_level = _pdf_list_marker_level(page, block)
                rendered_text = _pdf_text_block(block, body_size, font_styles, underline_rects)
                if rendered_text:
                    text_blocks += 1
                    pre, pre_lines, text_items, post, post_lines = _pdf_block_list_parts(
                        block, body_size, font_styles, indent_positions, underline_rects
                    )
                    if not text_items and not rendered_text.startswith("<h"):
                        # Keep the text-based fallback for PDFs that expose a
                        # whole list as one visual line instead of line data -
                        # but only for a block that is not already a heading.
                        # It scans the *whole rendered text* for a bullet
                        # character, and a plain hyphen used as title
                        # punctuation ("Group - Telecom") would otherwise be
                        # mistaken for a list marker and tear the heading in
                        # two.
                        pre, text_items = _pdf_text_list_parts(rendered_text)
                        pre_lines, post, post_lines = [], None, []
                    if text_items:
                        if pre and list_items and _pdf_is_list_continuation(
                            {"type": 0, "bbox": pre_lines[0].get("bbox")} if pre_lines else block,
                            previous_list_bbox,
                        ):
                            # A wrapped sentence fragment from the *previous*
                            # block's last item, split there only because a
                            # ruled table, a page break or the list's own
                            # markers started a new PDF block right after it.
                            _append_pdf_list_continuation(list_items, f"<p>{pre}</p>")
                        elif pre:
                            # Introductory prose belongs above the list, not
                            # inside the final item of a preceding list. A
                            # numbered section heading immediately followed by
                            # its own bullet list - one PDF block, no blank
                            # line between them - must not lose its heading
                            # level just because the block's *average* run is
                            # diluted by the plain list text; judge it by its
                            # own lines instead.
                            _flush_pdf_list(parts, list_items, indent_positions)
                            level = _lines_heading_level(pre_lines, body_size, font_styles)
                            if level:
                                parts.append(f"<h{level}>{pre}</h{level}>")
                            else:
                                parts.append(f"<p>{pre}</p>")
                        list_items.extend(text_items)
                        previous_list_bbox = tuple(block["bbox"])
                        if post:
                            # Unmarked text left over after the list ends
                            # within this same block - most often a heading
                            # placed hard against the list above it, with no
                            # blank paragraph in between.
                            _flush_pdf_list(parts, list_items, indent_positions)
                            level = _lines_heading_level(post_lines, body_size, font_styles)
                            if level:
                                parts.append(f"<h{level}>{post}</h{level}>")
                            else:
                                parts.append(f"<p>{post}</p>")
                            previous_list_bbox = None
                    elif list_level is not None:
                        list_items.append((list_level, rendered_text))
                        previous_list_bbox = tuple(block["bbox"])
                    elif list_items and _pdf_is_list_continuation(block, previous_list_bbox):
                        _append_pdf_list_continuation(list_items, rendered_text)
                        previous_list_bbox = tuple(block["bbox"])
                    else:
                        _flush_pdf_list(parts, list_items, indent_positions)
                        parts.append(rendered_text)
                        previous_list_bbox = None

            # Only a table that is still the very last thing on its page is
            # eligible to continue on the next one - one followed by so much
            # as a caption, a footnote, or a list still being built up (not
            # yet flushed to `parts`, but still real content after it) has
            # already ended, no matter how the margins line up. The list
            # itself is deliberately *not* flushed here - see the comment
            # where it is declared, above the `for page in document` loop.
            pending_continuation = (
                last_table_info
                if last_table_info is not None
                and not list_items
                and last_table_info["parts_index"] == len(parts) - 1
                else None
            )

        _flush_pdf_list(parts, list_items, indent_positions)
        title = _pdf_metadata_title(document)

    warnings: list[str] = []
    if text_blocks == 0:
        warnings.append(
            "This PDF appears to be scanned - no selectable text could be extracted, "
            "so only its images were imported."
        )

    return ExtractedDocument(
        html="".join(parts),
        media=media,
        metadata_title=title,
        warnings=warnings,
    )


def _pdf_tables(
    page: Any, regions: list[dict[str, Any]] | None = None
) -> list[dict[str, Any]]:
    """Extract ruled tables before processing ordinary text blocks.

    PDFs exported from Word retain table rules but not an HTML table structure.
    PyMuPDF's strict line strategy uses those real rules and avoids mistaking
    underlined text or paragraph baselines for additional columns.

    `refine=True` reconstructs merged cells into real colspan/rowspan instead
    of a flat grid that repeats one merged cell's text into empty "ghost"
    cells. That matters most for a two-row header - a numbered "DC"/"DR"
    sub-header under a wider label - which a flat extraction renders as a
    bogus, half-empty data row instead of part of the header.

    A Confluence-style code macro has its own outer border and a divider
    under its language label - to `find_tables` that is indistinguishable
    from a two-row, one-column table, and it would win over the language's
    own code renderer (see `_pdf_special_regions`) since table detection is
    checked first for every block. `regions` lets a table candidate be
    dropped when it is really one of those - or a callout box - so the code
    or callout path gets a real chance to run instead of a garbled `<table>`
    full of code text with its own line-number gutter still attached.
    """
    try:
        found = page.find_tables(
            vertical_strategy="lines_strict",
            horizontal_strategy="lines_strict",
            refine=True,
        )
    except (AttributeError, RuntimeError, TypeError, ValueError):
        return []

    tables: list[dict[str, Any]] = []
    for table in found.tables:
        rows = table.extract()
        if not rows or not any(cell and str(cell).strip() for row in rows for cell in row):
            continue
        html = _pdf_table_html(page, table)
        if not html or ("<th" not in html and "<td" not in html):
            continue
        if regions and _pdf_rect_in_regions(table.bbox, regions):
            continue
        background, text_color, header_bottom = _pdf_table_header_paint(page, table.bbox)
        tables.append({
            "rect": table.bbox,
            "html": html,
            "rows": table.rows,
            "background": background,
            "text_color": text_color,
            "header_bottom": header_bottom,
        })
    return tables


def _pdf_table_html(page: Any, table: Any) -> str:
    """`table.to_html()`, with every cell's text re-read straight off the page.

    `find_tables()` assembles a cell's text through its own lower-level
    per-character pass, which - unlike the `get_text("dict")` line grouping
    the rest of this module relies on - does not separate a diagonal
    watermark/e-signature tracking stamp from the real text it happens to
    cross. Left to it, a stamp sweeping through the table interleaves its own
    characters into a cell's text as unrecognisable fragments, or crowds the
    real content out of the cell entirely. Re-reading each placement's own
    bbox through `_pdf_clean_table_cell_text` sidesteps that with no edits to
    the page itself - falls back to the original `to_html()` wherever the
    placement grid or the renderer it needs isn't available.
    """
    placements = getattr(table, "placements", None)
    if not placements:
        return table.to_html()
    try:
        from pymupdf.table import render_table_html
    except ImportError:
        return table.to_html()
    for row in placements:
        for cell in row:
            bbox = getattr(cell, "bbox", None)
            if bbox is None:
                continue
            text = _pdf_clean_table_cell_text(page, bbox)
            if text:
                cell.text = text
    return render_table_html(placements, getattr(table, "section_rows", ()))


def _pdf_clean_table_cell_text(page: Any, bbox: tuple[float, float, float, float]) -> str:
    """One table cell's text, read fresh from `bbox` and skipping any
    watermark line crossing it - see `_pdf_table_html`."""
    lines: list[tuple[float, str]] = []
    for block in page.get_text("dict", clip=bbox).get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            if not _pdf_line_is_horizontal(line):
                continue
            text = _pdf_line_text(line)
            if text.strip():
                lines.append((float((line.get("bbox") or (0.0, 0.0, 0.0, 0.0))[1]), text))
    lines.sort(key=lambda item: item[0])
    return "\n".join(text for _, text in lines)


def _pdf_rect_in_regions(
    bbox: tuple[float, float, float, float], regions: list[dict[str, Any]]
) -> bool:
    x0, y0, x1, y1 = bbox
    area = max(1.0, (x1 - x0) * (y1 - y0))
    for region in regions:
        rect = region["rect"]
        overlap_width = max(0.0, min(x1, rect.x1) - max(x0, rect.x0))
        overlap_height = max(0.0, min(y1, rect.y1) - max(y0, rect.y0))
        if overlap_width * overlap_height / area >= 0.5:
            return True
    return False


def _pdf_table_header_paint(page: Any, bbox: Any) -> tuple[str | None, str | None, float]:
    """The header's own painted background, text color, and how far down it
    extends - or `(None, None, top)` if the header carries no fill at all.

    The painted rectangle commonly covers more than one physical row (a
    numbered "DC"/"DR" sub-header under a wider label, say); every row it
    covers should be painted, not just the first.
    """
    left, top, right, bottom = bbox
    search_bottom = min(bottom, top + max(18, (bottom - top) * 0.18))
    for drawing in page.get_drawings():
        fill = drawing.get("fill")
        rect = drawing.get("rect")
        if not fill or not rect or rect.x1 < left or rect.x0 > right:
            continue
        if rect.y1 < top or rect.y0 > search_bottom:
            continue
        red, green, blue = (round(float(value) * 255) for value in fill[:3])
        if max(red, green, blue) - min(red, green, blue) < 18:
            continue
        background = f"background-color:#{red:02x}{green:02x}{blue:02x}"
        text_color = _pdf_band_text_color(
            page, top=top, bottom=rect.y1, left=left, right=right
        )
        return background, text_color, rect.y1
    return None, None, top


def _pdf_band_text_color(
    page: Any, *, top: float, bottom: float, left: float, right: float
) -> str | None:
    """The dominant color of text painted in a band, or None if it is plain
    black - which needs no inline override to read correctly on any fill."""
    counter: Counter[int] = Counter()
    for block in page.get_text("dict").get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                span_bbox = span.get("bbox")
                text = str(span.get("text") or "").strip()
                if not span_bbox or not text:
                    continue
                if span_bbox[1] < top - 1 or span_bbox[3] > bottom + 1:
                    continue
                if span_bbox[0] < left - 1 or span_bbox[2] > right + 1:
                    continue
                counter[int(span.get("color", 0) or 0)] += len(text)
    if not counter:
        return None
    color = counter.most_common(1)[0][0]
    if color == 0:
        return None
    red, green, blue = (color >> 16 & 255, color >> 8 & 255, color & 255)
    return f"color:#{red:02x}{green:02x}{blue:02x}"


def _pdf_table_for_block(block: dict[str, Any], tables: list[dict[str, Any]]) -> int | None:
    if block.get("type") != 0 or not block.get("bbox"):
        return None
    x0, y0, x1, y1 = block["bbox"]
    for index, table in enumerate(tables):
        left, top, right, bottom = table["rect"]
        overlap_width = max(0.0, min(x1, right) - max(x0, left))
        overlap_height = max(0.0, min(y1, bottom) - max(y0, top))
        block_area = max(1.0, (x1 - x0) * (y1 - y0))
        # A text run in a table cell is much smaller than the table itself.
        # Measure how much of *the run* is covered, not how much of the whole
        # table it occupies, otherwise the extractor renders every cell again
        # as a paragraph below the table.
        if overlap_width * overlap_height / block_area >= 0.95:
            return index
    return None


def _pdf_block_outside_tables(
    block: dict[str, Any], tables: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """Drop whichever of `block`'s lines already belong to a detected table.

    Judged per line rather than for the block as a whole: a block that fails
    `_pdf_table_for_block`'s 0.95 overlap test can still have *some* of its
    lines sitting inside a table, most often a table's last row or two -
    missing the ruling line `find_tables` needs to include them - fused by
    proximity into the same PDF block as the caption or footnote directly
    below. Returns a trimmed copy of `block` (bbox recomputed from what is
    left), or None if every line turned out to be inside a table.
    """
    if block.get("type") != 0:
        return block
    lines = block.get("lines", [])
    kept = [line for line in lines if not _pdf_line_in_tables(line, tables)]
    if len(kept) == len(lines):
        return block
    if not kept:
        return None
    xs0, ys0, xs1, ys1 = zip(*(line.get("bbox") or (0.0, 0.0, 0.0, 0.0) for line in kept))
    return {**block, "lines": kept, "bbox": (min(xs0), min(ys0), max(xs1), max(ys1))}


def _pdf_line_in_tables(line: dict[str, Any], tables: list[dict[str, Any]]) -> bool:
    bbox = line.get("bbox")
    if not bbox:
        return False
    x0, y0, x1, y1 = bbox
    line_area = max(1.0, (x1 - x0) * (y1 - y0))
    for table in tables:
        left, top, right, bottom = table["rect"]
        overlap_width = max(0.0, min(x1, right) - max(x0, left))
        overlap_height = max(0.0, min(y1, bottom) - max(y0, top))
        if overlap_width * overlap_height / line_area >= 0.6:
            return True
    return False


def _render_pdf_table(
    html: str,
    *,
    rows: list[Any],
    background: str | None,
    text_color: str | None,
    header_bottom: float,
) -> str:
    """Paint a PyMuPDF-reconstructed table's header band onto the cells it
    actually covers.

    `to_html()` already gives real colspan/rowspan and marks likely header
    cells `<th>` on its own (a font-boldness heuristic), but knows nothing
    about the PDF's own painted header fill - that is sampled separately from
    the page's drawing commands. Styling by row position rather than by
    `<th>`/`<td>` also means a sub-header row `to_html()` tags as plain `<td>`
    (a "DC"/"DR" pair under a wider merged label) still gets painted along
    with the rest of the band it visually belongs to.
    """
    if background is None and text_color is None:
        return html
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    if table is None:
        return html
    style = ";".join(part for part in (background, text_color) if part)
    for row, tr in zip(rows, table.find_all("tr", recursive=False), strict=False):
        if row.bbox[1] >= header_bottom - 1:
            break
        for cell in tr.find_all(["th", "td"], recursive=False):
            cell["style"] = style
    return str(table)


def _pdf_table_shares_margins(
    pending_rect: tuple[float, float, float, float], entry_rect: tuple[float, float, float, float]
) -> bool:
    """Whether two tables sit at the same left/right position on the page.

    Only meaningful as the *tighter* of two continuation checks: a repeated
    header on the new table is already strong proof by itself, but a
    continuation page that prints no header again has nothing else to go on,
    so that case additionally demands both edges - not just the left one -
    line up.
    """
    left_p, _, right_p, _ = pending_rect
    left_e, _, right_e, _ = entry_rect
    return abs(left_p - left_e) <= 6 and abs(right_p - right_e) <= 6


def _pdf_table_column_count(html: str) -> int:
    """The physical column count of a table's first row, colspans included."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    first_row = table.find("tr") if table is not None else None
    if first_row is None:
        return 0
    count = 0
    for cell in first_row.find_all(["th", "td"], recursive=False):
        try:
            count += max(1, int(str(cell.get("colspan") or "1")))
        except (TypeError, ValueError):
            count += 1
    return count


def _pdf_table_header_rows_html(html: str, rows: list[Any], header_bottom: float) -> list[Tag]:
    """The physical `<tr>` elements this table's own painted header band covers."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    if table is None:
        return []
    header_rows: list[Tag] = []
    for row, tr in zip(rows, table.find_all("tr", recursive=False), strict=False):
        if row.bbox[1] >= header_bottom - 1:
            break
        header_rows.append(tr)
    return header_rows


def _pdf_header_row_matches(a: Tag, b: Tag) -> bool:
    """Same header row, allowing for a caption line PyMuPDF fused onto one of
    them (`to_html()` has no notion of "this text does not belong here" - it
    just reports whatever spans landed in that cell's rectangle)."""
    a_cells = [c.get_text(" ", strip=True).casefold() for c in a.find_all(["th", "td"], recursive=False)]
    b_cells = [c.get_text(" ", strip=True).casefold() for c in b.find_all(["th", "td"], recursive=False)]
    if not a_cells or len(a_cells) != len(b_cells):
        return False
    return all(x == y or (x and y and (x in y or y in x)) for x, y in zip(a_cells, b_cells))


def _merge_pdf_table_continuation(
    pending_html: str,
    new_html: str,
    pending_header_rows: list[Tag],
    new_rows: list[Any],
    new_header_bottom: float,
    *,
    strict_margins: bool,
) -> str | None:
    """Splice a table continuing from the previous page onto the end of it.

    Only called on two tables that already share a column count and left
    margin - too weak a signal on its own to act on, since most tables in a
    report share the page's body width. A genuine continuation usually
    repeats its header rows verbatim (give or take a caption line stuck onto
    the first cell - see `_pdf_header_row_matches`), and that match is proof
    enough by itself: drop exactly as many of the new table's leading rows as
    actually matched. Some documents print the header only once, though, and
    a continuation page picks straight back up with data - `drop` in that
    case is 0, and `pending_header_rows` is the only thing left to fall back
    on: knowing what this table's *own* header actually looked like is still
    real evidence that it is one being continued, even though this page has
    nothing to compare it against. A table with no detected header at all
    (drop stays 0 *and* `pending_header_rows` is empty) has offered no
    evidence beyond sharing the page's body width - which every table in a
    plain, uncoloured report tends to do - so that case is never merged, no
    matter how well `strict_margins` says the edges line up.
    """
    new_header_rows = _pdf_table_header_rows_html(new_html, new_rows, new_header_bottom)
    drop = 0
    for header_row in pending_header_rows:
        if drop < len(new_header_rows) and _pdf_header_row_matches(header_row, new_header_rows[drop]):
            drop += 1
        else:
            break
    if drop == 0 and not (strict_margins and pending_header_rows):
        return None
    pending_soup = BeautifulSoup(pending_html, "html.parser")
    pending_table = pending_soup.find("table")
    new_soup = BeautifulSoup(new_html, "html.parser")
    new_table = new_soup.find("table")
    if pending_table is None or new_table is None:
        return None
    all_rows = new_table.find_all("tr", recursive=False)
    dropped_rows, kept_rows = all_rows[:drop], all_rows[drop:]
    _pdf_table_carry_rowspans(pending_table, dropped_rows, kept_rows)
    for row in kept_rows:
        pending_table.append(row.extract())
    return str(pending_table)


def _pdf_table_carry_rowspans(
    pending_table: Tag, dropped_rows: list[Tag], kept_rows: list[Tag]
) -> None:
    """Preserve a dropped header cell's rowspan where it reaches past the drop.

    With no ruling line inside one page to break it up, `to_html()` can give
    a column that carries a single value across the whole page - typically
    the leftmost "STT" cell continuing a group started on the previous page -
    a rowspan covering *every* row it finds, header included. Deleting the
    duplicate header rows outright would delete that cell along with them,
    silently dropping a column from every real data row still underneath it
    and shifting the rest of each row one cell to the left.

    The preferred fix is to extend whichever cell in `pending_table` already
    reaches its own last row in that column - the genuine remainder of the
    same value, split only by the page break, so the merged table reads "6"
    all the way down rather than "6" then a blank gap. An empty placeholder
    is the fallback for a column with nothing there to extend.
    """
    if not kept_rows or not dropped_rows:
        return
    total_dropped = len(dropped_rows)
    occupied_until: dict[int, int] = {}
    carries: dict[int, int] = {}
    for row_index, row in enumerate(dropped_rows):
        column = 0
        for cell in row.find_all(["th", "td"], recursive=False):
            while occupied_until.get(column, 0) > row_index:
                column += 1
            colspan = _table_cell_span(cell, "colspan")
            rowspan = _table_cell_span(cell, "rowspan")
            end_row = row_index + rowspan
            if end_row > total_dropped:
                for offset in range(colspan):
                    carries[column + offset] = end_row - total_dropped
            for offset in range(colspan):
                occupied_until[column + offset] = end_row
            column += colspan
    if not carries:
        return

    carries = _pdf_table_extend_open_rowspans(pending_table, carries)
    if not carries:
        return

    first_kept = kept_rows[0]
    existing_cells = [cell.extract() for cell in first_kept.find_all(["th", "td"], recursive=False)]
    tag_factory = BeautifulSoup("", "html.parser")
    merged_cells: list[Tag] = []
    column = 0
    cell_index = 0
    last_column = max(carries)
    while column <= last_column or cell_index < len(existing_cells):
        if column in carries:
            placeholder = tag_factory.new_tag("td")
            span = carries[column]
            if span > 1:
                placeholder["rowspan"] = str(span)
            merged_cells.append(placeholder)
            column += 1
            continue
        if cell_index >= len(existing_cells):
            # No cell claims this column and nothing carried into it either -
            # should not happen in a well-formed grid, but advance rather
            # than lose a still-pending carry at a higher column index.
            column += 1
            continue
        cell = existing_cells[cell_index]
        merged_cells.append(cell)
        column += _table_cell_span(cell, "colspan")
        cell_index += 1
    merged_cells.extend(existing_cells[cell_index:])
    for cell in merged_cells:
        first_kept.append(cell)


def _pdf_table_extend_open_rowspans(
    pending_table: Tag, carries: dict[int, int]
) -> dict[int, int]:
    """Grow a cell already reaching `pending_table`'s last row, per column.

    Returns whichever of `carries` could *not* be resolved this way (no cell
    in that column reaches the last row), left for the caller's placeholder
    fallback.
    """
    rows = pending_table.find_all("tr", recursive=False)
    total_rows = len(rows)
    if total_rows == 0:
        return carries
    occupied_until: dict[int, int] = {}
    owner_by_column: dict[int, Tag] = {}
    for row_index, row in enumerate(rows):
        column = 0
        for cell in row.find_all(["th", "td"], recursive=False):
            while occupied_until.get(column, 0) > row_index:
                column += 1
            colspan = _table_cell_span(cell, "colspan")
            rowspan = _table_cell_span(cell, "rowspan")
            end_row = row_index + rowspan
            for offset in range(colspan):
                occupied_until[column + offset] = end_row
                if end_row == total_rows:
                    owner_by_column[column + offset] = cell
            column += colspan
    unresolved: dict[int, int] = {}
    for column, extra in carries.items():
        owner = owner_by_column.get(column)
        if owner is None:
            unresolved[column] = extra
            continue
        owner["rowspan"] = str(_table_cell_span(owner, "rowspan") + extra)
    return unresolved


def _pdf_font_styles(document: Any) -> dict[str, dict[str, bool]]:
    """Read style metadata that Chromium leaves in Type3 font descriptors."""
    styles: dict[str, dict[str, bool]] = {}
    for xref in range(1, document.xref_length()):
        try:
            font_object = document.xref_object(xref, compressed=False)
        except (RuntimeError, ValueError):
            continue
        if "/Type /Font" not in font_object:
            continue
        descriptor_match = re.search(r"/FontDescriptor (\d+)", font_object)
        if not descriptor_match:
            continue
        try:
            descriptor = document.xref_object(int(descriptor_match.group(1)), compressed=False)
        except (RuntimeError, ValueError):
            continue
        weight_match = re.search(r"/FontWeight\s+(-?\d+(?:\.\d+)?)", descriptor)
        angle_match = re.search(r"/ItalicAngle\s+(-?\d+(?:\.\d+)?)", descriptor)
        name_match = re.search(r"/FontName\s+/([^\s]+)", descriptor)
        family_match = re.search(r"/FontFamily\s*\(([^)]*)\)", descriptor)
        weight = float(weight_match.group(1)) if weight_match else 400.0
        angle = float(angle_match.group(1)) if angle_match else 0.0
        name = (name_match.group(1) if name_match else "").lower()
        family = (family_match.group(1) if family_match else "").lower()
        styles[f"Type3 ({xref} 0 R)"] = {
            "bold": weight >= 600,
            "italic": angle != 0 or "italic" in name or "italic" in family,
            "code": "mono" in family or "mono" in name,
        }
    return styles


def _pdf_span_style(
    span: dict[str, Any], font_styles: dict[str, dict[str, bool]] | None
) -> dict[str, bool]:
    style = dict((font_styles or {}).get(str(span.get("font", "")), {}))
    font_name = str(span.get("font", "")).lower()
    flags = int(span.get("flags", 0))
    style["bold"] = (
        bool(style.get("bold"))
        or bool(flags & _PDF_BOLD_FLAG)
        or "bold" in font_name
    )
    style["italic"] = (
        bool(style.get("italic"))
        # PyMuPDF's span flags are a bit *field*: bit 0 superscript, bit 1
        # italic, bit 2 serifed, bit 3 monospaced, bit 4 bold - `1 << 1`, not
        # `1 << 6`, which never matches any real span and so never overrode
        # the substring fallback below.
        or bool(flags & (1 << 1))
        # A Word/LibreOffice export often abbreviates the PostScript name to
        # "...BoldItal" rather than spelling out "Italic" in full.
        or "ital" in font_name
        or "oblique" in font_name
    )
    return style


def _pdf_underline_rects(page: Any) -> list[tuple[float, float, float, float]]:
    """Thin, wide drawn rectangles that are really an underline under text.

    A PDF underline is not a font attribute exposed on a span - PyMuPDF has
    no flag for it - it is drawn as a thin filled bar sitting directly under
    the text's baseline, distinguished from an ordinary ruling line mostly by
    how closely it hugs one line of text rather than framing a table or box.
    """
    rects: list[tuple[float, float, float, float]] = []
    for drawing in page.get_drawings():
        rect = drawing.get("rect")
        if not rect or rect.height > 2.0 or rect.width < 6.0:
            continue
        rects.append((rect.x0, rect.y0, rect.x1, rect.y1))
    return rects


def _pdf_span_is_underlined(
    bbox: tuple[float, float, float, float] | None,
    underline_rects: list[tuple[float, float, float, float]] | None,
) -> bool:
    if not bbox or not underline_rects:
        return False
    x0, _y0, x1, y1 = bbox
    span_width = max(1.0, x1 - x0)
    for left, top, right, _bottom in underline_rects:
        # The bar sits at, or a couple of points either side of, the span's
        # own bottom edge - a descender's bbox commonly reaches a bit below
        # where the bar is actually drawn, and PDF exports vary in whether
        # the bar starts a hair above or below the reported baseline.
        if top < y1 - 3 or top > y1 + 4:
            continue
        overlap = max(0.0, min(x1, right) - max(x0, left))
        if overlap / span_width >= 0.6:
            return True
    return False


def _wrap_pdf_marks(marks: tuple[bool, bool, bool, bool], value: str) -> str:
    is_code, is_bold, is_italic, is_underline = marks
    if is_code:
        return f"<code>{value}</code>"
    if is_underline:
        value = f"<u>{value}</u>"
    if is_italic:
        value = f"<em>{value}</em>"
    if is_bold:
        value = f"<strong>{value}</strong>"
    return value


def _pdf_special_regions(page: Any) -> list[dict[str, Any]]:
    """Find large painted regions that represent WikiHub semantic blocks.

    A code block's background is not always one single rectangle spanning the
    whole snippet - some exporters instead paint one thin bar per *line* (the
    same look as an editor's line highlighting), each well under the height
    a region is otherwise required to clear on its own. Those bars are merged
    into one run first - by shared left/right edges, the same fill, and no
    gap between them - so a code block built that way is still recognised as
    one region instead of many bars each too short to qualify.
    """
    fills: list[tuple[Any, tuple[float, float, float]]] = []
    for drawing in page.get_drawings():
        rect = drawing.get("rect")
        fill = drawing.get("fill")
        if not rect or not fill:
            continue
        fills.append((rect, tuple(float(value) for value in fill[:3])))

    regions: list[dict[str, Any]] = []
    seen: set[tuple[float, float, float, float, str]] = set()
    for rect, fill_tuple in _merge_pdf_fill_runs(fills):
        if rect.width < 200 or rect.height < 30:
            continue
        if max(fill_tuple) <= _PDF_CODE_MAX_CHANNEL:
            kind = "code"
        elif _is_close_rgb(fill_tuple, _PDF_CALLOUT_FILL, tolerance=0.025):
            kind = "callout"
        else:
            continue
        key = (*tuple(round(float(value), 1) for value in rect), kind)
        if key in seen:
            continue
        seen.add(key)
        regions.append({"kind": kind, "rect": rect})
    return sorted(regions, key=lambda region: (region["rect"].y0, region["rect"].x0))


def _merge_pdf_fill_runs(
    fills: list[tuple[Any, tuple[float, float, float]]],
) -> list[tuple[Any, tuple[float, float, float]]]:
    """Merge same-colour filled rects that share edges into contiguous runs.

    Grouped by (rounded) left/right edge and fill colour, then merged along Y
    wherever consecutive rects touch or nearly touch (a hairline gap is
    common between an exporter's per-line bars). A rect with nothing to merge
    into passes through unchanged, so this is a no-op for the ordinary case
    of one big background rectangle.
    """
    import pymupdf  # imported here so the module stays importable without it

    groups: dict[tuple[float, float, float, float, float], list[Any]] = {}
    for rect, fill_tuple in fills:
        key = (round(rect.x0, 1), round(rect.x1, 1), *(round(value, 3) for value in fill_tuple))
        groups.setdefault(key, []).append(rect)

    merged: list[tuple[Any, tuple[float, float, float]]] = []
    for key, rects in groups.items():
        fill_tuple = key[2:]
        for rect in sorted(rects, key=lambda item: item.y0):
            if merged and merged[-1][1] == fill_tuple:
                last_rect, _ = merged[-1]
                if (
                    last_rect.x0 == rect.x0
                    and last_rect.x1 == rect.x1
                    and rect.y0 - last_rect.y1 <= 2
                    and rect.y1 > last_rect.y1
                ):
                    merged[-1] = (
                        pymupdf.Rect(last_rect.x0, last_rect.y0, last_rect.x1, rect.y1),
                        fill_tuple,
                    )
                    continue
            merged.append((rect, fill_tuple))
    return merged


def _is_close_rgb(
    actual: tuple[float, ...], expected: tuple[float, ...], *, tolerance: float
) -> bool:
    return len(actual) >= 3 and all(
        abs(actual[index] - expected[index]) <= tolerance for index in range(3)
    )


def _pdf_region_for_block(
    block: dict[str, Any], regions: list[dict[str, Any]]
) -> int | None:
    if block.get("type") != 0:
        return None
    bbox = block.get("bbox")
    if not bbox:
        return None
    x0, y0, x1, y1 = bbox
    for index, region in enumerate(regions):
        rect = region["rect"]
        if (
            x0 >= rect.x0 - 1
            and y0 >= rect.y0 - 1
            and x1 <= rect.x1 + 1
            and y1 <= rect.y1 + 1
        ):
            return index
    return None


def _pdf_list_marker_level(page: Any, block: dict[str, Any]) -> int | None:
    """Match text blocks to the small circular bullet drawings beside them."""
    bbox = block.get("bbox")
    if not bbox or block.get("type") != 0:
        return None
    x0, y0, _x1, y1 = bbox
    candidates: list[tuple[float, float]] = []
    all_markers: list[float] = []
    for drawing in page.get_drawings():
        rect = drawing.get("rect")
        items = drawing.get("items") or []
        if not rect or not drawing.get("fill") or not 2.0 <= rect.width <= 6.0:
            continue
        if not 2.0 <= rect.height <= 6.0 or not any(
            item and item[0] == "c" for item in items
        ):
            continue
        all_markers.append(rect.x0)
        if rect.x1 > x0 + 1 or x0 - rect.x1 > 16 or rect.y1 < y0 - 2 or rect.y0 > y1 + 2:
            continue
        candidates.append((rect.x0, rect.y0))
    if not candidates:
        return None
    marker_x = min(candidates, key=lambda candidate: abs(candidate[1] - y0))[0]
    return max(0, round((marker_x - min(all_markers)) / 18))


_PDF_LIST_LINE = re.compile(
    r"^\s*(?:[\u2022\u25aa\u25ab\u25e6\uf02b\uf0b7]|o|[-–])\s+(?P<body>.+)$"
)


def _register_pdf_indent(indent_positions: list[float], position: float) -> int:
    """Assign `position` to an existing indent cluster, or start a new one.

    `indent_positions` is shared by every block of one running list (see the
    caller in `_extract_pdf_sync`), so the returned index is a nesting level
    that stays comparable across blocks: "-" at 90pt and "o" at 126pt land at
    different depths even when they come from two different PDF blocks,
    instead of each block restarting its own indent count from zero.
    """
    for index, existing in enumerate(indent_positions):
        if abs(existing - position) < 8:
            return index
    insert_at = 0
    while insert_at < len(indent_positions) and indent_positions[insert_at] < position:
        insert_at += 1
    indent_positions.insert(insert_at, position)
    return insert_at


def _pdf_visual_lines(block: dict[str, Any]) -> list[dict[str, Any]]:
    """`block`'s lines, with same-baseline fragments merged into one.

    Word PDF exports sometimes split a single visual row into a marker line
    and a text line that share the same baseline (for example ``-`` and
    ``Design notes`` as two separate PDF lines). Callers that judge a line by
    its own text - a bullet marker, a "(1)" numbered lead-in - need it merged
    back into one line first, or they see only the fragment with the marker.
    """
    visual_lines: list[dict[str, Any]] = []
    for source_line in block.get("lines", []):
        source_bbox = source_line.get("bbox") or [0, 0, 0, 0]
        if visual_lines:
            previous = visual_lines[-1]
            previous_bbox = previous.get("bbox") or [0, 0, 0, 0]
            if abs(float(source_bbox[1]) - float(previous_bbox[1])) <= 2:
                previous["spans"].extend(source_line.get("spans", []))
                previous["bbox"] = (
                    min(float(previous_bbox[0]), float(source_bbox[0])),
                    min(float(previous_bbox[1]), float(source_bbox[1])),
                    max(float(previous_bbox[2]), float(source_bbox[2])),
                    max(float(previous_bbox[3]), float(source_bbox[3])),
                )
                continue
        visual_lines.append({
            "bbox": tuple(source_bbox),
            "spans": list(source_line.get("spans", [])),
        })
    return visual_lines


def _pdf_line_text(line: dict[str, Any]) -> str:
    return "".join(str(span.get("text") or "") for span in line.get("spans", []))


def _pdf_line_is_horizontal(line: dict[str, Any]) -> bool:
    """False for a line of text drawn at an angle.

    That is the tell for a diagonal "signed by .../tracking-stamp" watermark
    some document systems overlay across every page - as opposed to normal
    horizontal body text, which is all a PDF ever sets in practice otherwise.
    """
    direction = line.get("dir") or (1.0, 0.0)
    return abs(float(direction[1])) <= 0.05


def _pdf_strip_watermark_lines(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop watermark lines - see `_pdf_line_is_horizontal` - before any other
    block-level pass sees them.

    Left in, one becomes a bogus heading of its own: its huge rotated bbox
    (an axis-aligned box around a diagonal string spans most of the page)
    reads as one oversized-font paragraph. Worse, `_pdf_table_for_block` /
    `_pdf_line_in_tables` measure overlap against that same bloated bbox, so
    the block can get mis-attributed to whatever table or paragraph the
    watermark happens to sweep through.
    """
    cleaned: list[dict[str, Any]] = []
    for block in blocks:
        if block.get("type") != 0:
            cleaned.append(block)
            continue
        lines = block.get("lines", [])
        kept = [line for line in lines if _pdf_line_is_horizontal(line)]
        if not kept:
            continue
        if len(kept) == len(lines):
            cleaned.append(block)
            continue
        xs0, ys0, xs1, ys1 = zip(
            *(line.get("bbox") or (0.0, 0.0, 0.0, 0.0) for line in kept)
        )
        cleaned.append({**block, "lines": kept, "bbox": (min(xs0), min(ys0), max(xs1), max(ys1))})
    return cleaned


_PDF_NUMBERED_PARAGRAPH_LINE = re.compile(r"^\(\d{1,3}\)\s+(?P<body>.+)$")


def _pdf_block_numbered_paragraphs(
    block: dict[str, Any],
    body_size: float,
    font_styles: dict[str, dict[str, bool]],
    underline_rects: list[tuple[float, float, float, float]] | None,
) -> list[str] | None:
    """Split a block of "(1) ... (2) ..." narrative steps into paragraphs.

    A numbered walkthrough like a transaction's step-by-step description is
    routinely exported as consecutive PDF lines with no blank line between
    them, so PyMuPDF's own layout heuristics fuse the whole thing into one
    physical block - and flattening a block to one `<p>` (`_pdf_text_block`)
    then runs every step into a single wall of text with no line breaks at
    all. Returns None when fewer than two lines carry a "(N)" lead-in - a
    lone numbered heading is left to the normal heading path - otherwise one
    rendered `<p>` per step, with an unmarked wrapped line folded into
    whichever step it visually continues rather than starting a new one.
    """
    visual_lines = _pdf_visual_lines(block)
    marker_indexes = {
        index
        for index, line in enumerate(visual_lines)
        if _PDF_NUMBERED_PARAGRAPH_LINE.match(_pdf_line_text(line))
    }
    if len(marker_indexes) < 2:
        return None
    groups: list[list[dict[str, Any]]] = []
    for index, line in enumerate(visual_lines):
        if index in marker_indexes or not groups:
            groups.append([line])
        else:
            groups[-1].append(line)
    paragraphs = [
        _pdf_inline_html({"lines": group}, body_size, font_styles, underline_rects).strip()
        for group in groups
    ]
    return [f"<p>{paragraph}</p>" for paragraph in paragraphs if paragraph]


def _pdf_strip_line_prefix(line: dict[str, Any], length: int) -> dict[str, Any]:
    """A copy of `line` with its first `length` characters of text removed.

    Used to drop a list marker - and the whitespace after it - from a line
    before rendering its body, so the body is rendered from its *own* spans
    (keeping whatever bold/italic marks they carry) rather than falling back
    to the plain matched text, which has none.
    """
    remaining = length
    spans: list[dict[str, Any]] = []
    for span in line.get("spans", []):
        text = str(span.get("text") or "")
        if remaining >= len(text):
            remaining -= len(text)
            continue
        spans.append({**span, "text": text[remaining:]})
        remaining = 0
    return {**line, "spans": spans}


def _pdf_block_list_parts(
    block: dict[str, Any],
    body_size: float,
    font_styles: dict[str, dict[str, bool]],
    indent_positions: list[float],
    underline_rects: list[tuple[float, float, float, float]] | None = None,
) -> tuple[str | None, list[dict[str, Any]], list[tuple[int, str]], str | None, list[dict[str, Any]]]:
    """Build list items from PDF *lines*, preserving item boundaries.

    PDF text blocks often contain several visual list rows. Flattening the
    block first loses those boundaries and produces one malformed list item.
    We inspect each line before applying inline formatting, and attach an
    indented unmarked line to the preceding item as its wrapped continuation.

    Returns `(pre, pre_lines, items, post, post_lines)`. `pre` is text found
    before the first marker (a heading glued to its own list, or a wrapped
    sentence continuing the previous block's last item); `post` is unmarked
    text left over *after* the list ends within this same block (most often a
    heading PDF placed hard against the list above it). `pre_lines`/
    `post_lines` are the raw line data behind each, kept so the caller can
    judge *just those lines* for a heading level instead of the whole block's
    diluted average.
    """
    pre: list[str] = []
    pre_lines: list[dict[str, Any]] = []
    post: list[str] = []
    post_lines: list[dict[str, Any]] = []
    items: list[tuple[int, str]] = []
    marker_x: float | None = None
    visual_lines = _pdf_visual_lines(block)

    for line in visual_lines:
        line_text = _pdf_line_text(line)
        match = _PDF_LIST_LINE.match(line_text)
        line_html = _pdf_inline_html({"lines": [line]}, body_size, font_styles, underline_rects).strip()
        if not line_html:
            continue
        line_x = float(line.get("bbox", [0])[0])
        if match:
            # The marker may be emitted in its own styled span, so the body
            # is re-rendered from the line's spans with the marker's
            # characters trimmed off the front - not lifted from plain
            # matched text - or a bold/italic bullet line would lose that
            # formatting entirely once the marker was stripped from it.
            body_line = _pdf_strip_line_prefix(line, match.start("body"))
            content = _pdf_inline_html(
                {"lines": [body_line]}, body_size, font_styles, underline_rects
            ).strip()
            if content:
                level = _register_pdf_indent(indent_positions, line_x)
                items.append((level, f"<p>{content}</p>"))
                marker_x = line_x
            continue
        if items and marker_x is not None and line_x >= marker_x + 8:
            _append_pdf_list_continuation(items, f"<p>{line_html}</p>")
        elif items:
            # A left-aligned unmarked line arriving *after* the list ends,
            # not a continuation of the previous bullet.
            post.append(line_html)
            post_lines.append(line)
        else:
            pre.append(line_html)
            pre_lines.append(line)
    return (
        (" ".join(pre).strip() or None),
        pre_lines,
        items,
        (" ".join(post).strip() or None),
        post_lines,
    )


def _pdf_text_list_parts(
    rendered: str,
) -> tuple[str | None, list[tuple[int, str]]]:
    inner = (
        rendered[3:-4]
        if rendered.startswith("<p>") and rendered.endswith("</p>")
        else rendered
    )
    # Word-to-PDF exports use both Symbol's private-use bullet and the normal
    # Unicode bullet. Treat either as a list marker; a hyphen remains a marker
    # only when separated from a word so prose such as "end-to-end" is safe.
    matches = list(re.finditer(r"[\uf02b•]|(?<!\w)-(?=\s+)", inner))
    if not matches:
        # Depending on the embedded font, a Word-exported bullet can arrive
        # as a standard Unicode bullet, a private-use glyph, or a geometric
        # bullet. Escaped code points keep this independent of file encoding.
        matches = list(
            re.finditer(r"[\u2022\uf02b\uf0b7\u25aa\u25ab\u25e6]", inner)
        )
    if not matches:
        return None, []
    leading = inner[: matches[0].start()].strip() or None
    items: list[tuple[int, str]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(inner)
        content = inner[match.end() : end].strip()
        if content:
            level = 1 if match.group(0) in {"\uf02b", "•"} else 0
            # Position data is not available for glyphs embedded in a text
            # run, so treating these as siblings is safer than fabricating
            # nested lists. Drawn bullets retain x-coordinate nesting.
            items.append((0, f"<p>{content}</p>"))
    return leading, items


def _pdf_is_page_number(page: Any, block: dict[str, Any]) -> bool:
    """Recognise a PDF footer page number without hiding section numbers."""
    text = _pdf_block_plain_text(block)
    if not re.fullmatch(r"\d+(?:\s*/\s*\d+)?", text):
        return False
    bbox = block.get("bbox")
    if not bbox:
        return False
    _x0, y0, _x1, _y1 = bbox
    page_rect = page.rect
    # Different Word/PDF templates place the footer number left, centre, or
    # right. A standalone number in the footer band is never useful page body
    # content, while an in-body section number remains above that band.
    return y0 >= page_rect.height * 0.78


def _pdf_is_list_continuation(
    block: dict[str, Any], previous_bbox: tuple[float, float, float, float] | None
) -> bool:
    if previous_bbox is None or block.get("type") != 0 or not block.get("bbox"):
        return False
    x0, y0, _x1, _y1 = block["bbox"]
    _previous_x0, _previous_y0, _previous_x1, previous_y1 = previous_bbox
    return y0 - previous_y1 <= 14 and x0 >= 90 and y0 >= _previous_y0


def _append_pdf_list_continuation(
    items: list[tuple[int, str]], rendered: str
) -> None:
    if not items:
        return
    continuation = (
        rendered[3:-4]
        if rendered.startswith("<p>") and rendered.endswith("</p>")
        else rendered
    )
    level, existing = items[-1]
    existing_inner = (
        existing[3:-4]
        if existing.startswith("<p>") and existing.endswith("</p>")
        else existing
    )
    items[-1] = (level, f"<p>{existing_inner.strip()} {continuation.strip()}</p>")


def _render_pdf_list(items: list[tuple[int, str]]) -> str:
    """Render adjacent PDF bullet items as a semantic nested unordered list."""
    html: list[str] = []
    current_level = -1
    # A freshly flushed run can begin at an indented PDF coordinate. Its first
    # item is still the root of this HTML list.
    base_level = items[0][0]
    for raw_level, content in items:
        content = re.sub(r"^<p>(.*)</p>$", r"\1", content, flags=re.DOTALL)
        level = max(0, raw_level - base_level)
        # Indentation is inferred independently for PDF blocks. Do not allow
        # a new block to jump from level 0 straight to level 2: that would
        # create an unpaired <li> and malformed editor HTML.
        if current_level >= 0:
            level = min(level, current_level + 1)
        if current_level < 0 or level > current_level:
            html.append("<ul><li>")
        elif level == current_level:
            html.append("</li><li>")
        else:
            html.append("</li></ul>" * (current_level - level))
            html.append("</li><li>")
        html.append(content)
        current_level = level
    if current_level >= 0:
        html.append("</li></ul>" * (current_level + 1))
    return "".join(html)


def _flush_pdf_list(
    parts: list[str], items: list[tuple[int, str]], indent_positions: list[float]
) -> None:
    if items:
        parts.append(_render_pdf_list(items))
        items.clear()
        # A new list starting after this one has no relation to this one's
        # indentation - never carry "-" at 90pt over to a list that starts at
        # 72pt one section later.
        #
        # Only clear when there was an actual list to flush: a heading whose
        # own PDF block is glued to the *first* line of a brand new list (see
        # the `pre` handling in `_extract_pdf_sync`) calls this to flush
        # whatever came *before* it, while `indent_positions` may already
        # hold that new list's own first marker, registered moments ago by
        # the same block's `_pdf_block_list_parts` call. `items` is still
        # empty at that point - clearing unconditionally would erase that
        # registration before the new list's second marker ever sees it.
        indent_positions.clear()


def _render_pdf_region(
    blocks: list[dict[str, Any]], region: dict[str, Any]
) -> str | None:
    rect = region["rect"]
    text_blocks = [
        block for block in blocks if _pdf_region_for_block(block, [region]) == 0
    ]
    if region["kind"] == "callout":
        text = " ".join(_pdf_block_plain_text(block) for block in text_blocks).strip()
        return (
            '<div data-type="callout" data-callout-type="warning">'
            f"<p>{html_module.escape(text)}</p></div>"
            if text
            else None
        )

    lines: dict[float, list[tuple[float, str]]] = {}
    language: str | None = None
    sizes: list[float] = []
    for block in text_blocks:
        for line in block.get("lines", []):
            line_bbox = line.get("bbox") or block.get("bbox")
            if not line_bbox:
                continue
            line_text = "".join(
                str(span.get("text", "")) for span in line.get("spans", [])
            )
            stripped = line_text.strip()
            if not stripped:
                continue
            if line_bbox[1] <= rect.y0 + 26 and line_bbox[0] >= rect.x1 - 90:
                language = _normalise_pdf_language(stripped)
                continue
            if line_bbox[0] <= rect.x0 + 45 and re.fullmatch(r"\d+", stripped):
                continue
            y = round(float(line_bbox[1]), 1)
            lines.setdefault(y, []).append((float(line_bbox[0]), line_text.rstrip()))
            sizes.extend(
                float(span.get("size") or 0)
                for span in line.get("spans", [])
                if float(span.get("size") or 0) > 0
            )
    ordered_lines = sorted(lines.items())
    if not ordered_lines:
        return None
    if region["kind"] == "code":
        # A PDF has no literal indentation characters - a nested line is
        # simply text placed further right, in units of a monospace
        # character's width. Reconstruct that as real leading spaces,
        # measured from this block's own least-indented line (its column
        # zero) - otherwise every line comes out flush-left the moment it is
        # no longer sitting inside its own bordered, backgrounded region.
        left_edge = min(x for _y, items in ordered_lines for x, _text in items)
        char_width = (sum(sizes) / len(sizes) if sizes else 9.0) * 0.6
        code_lines = [
            " " * max(0, round((min(x for x, _t in items) - left_edge) / char_width))
            + "".join(text for _x, text in sorted(items))
            for _y, items in ordered_lines
        ]
    else:
        code_lines = [
            "".join(text for _x, text in sorted(items)) for _y, items in ordered_lines
        ]
    code = html_module.escape("\n".join(code_lines).rstrip())
    class_attribute = f' class="language-{language}"' if language else ""
    return f"<pre><code{class_attribute}>{code}</code></pre>" if code else None


def _pdf_block_plain_text(block: dict[str, Any]) -> str:
    return " ".join(
        "".join(str(span.get("text", "")) for span in line.get("spans", []))
        for line in block.get("lines", [])
    ).strip()


def _normalise_pdf_language(value: str) -> str | None:
    language = re.sub(r"[^a-z0-9+#_-].*$", "", value.lower())
    return language[:32] if re.fullmatch(r"[a-z0-9+#_-]{1,32}", language) else None


def _pdf_image_block(
    block: dict[str, Any],
    media: list[ExtractedMedia],
    seen: set[str],
    total_bytes: int,
    *,
    image_decoder: Any,
) -> tuple[str | None, int]:
    data = block.get("image")
    if not data:
        return None, total_bytes

    bbox = block.get("bbox") or (0, 0, 0, 0)
    width, height = bbox[2] - bbox[0], bbox[3] - bbox[1]
    if width < _MIN_PDF_IMAGE_EDGE or height < _MIN_PDF_IMAGE_EDGE:
        return None, total_bytes
    if len(data) < _MIN_PDF_IMAGE_BYTES:
        return None, total_bytes
    if width <= 120 and height <= 100 and _pdf_is_decorative_card(data, image_decoder):
        return None, total_bytes

    # A logo in the header of every page is one image, not forty.
    digest = hashlib.sha256(data).hexdigest()
    if digest in seen:
        return None, total_bytes
    seen.add(digest)

    if len(media) >= settings.document_import_max_media_count:
        raise DocumentTooComplexError(
            f"This PDF contains more than {settings.document_import_max_media_count} images."
        )
    total_bytes += len(data)
    if total_bytes > settings.document_import_max_media_bytes:
        raise DocumentTooComplexError("The images in this PDF exceed what WikiHub will unpack.")

    extension = str(block.get("ext") or "png").lower()
    token = new_media_token()
    media.append(
        ExtractedMedia(
            token=token,
            filename=f"image-{len(media) + 1}.{extension}",
            data=bytes(data),
            content_type=_guess_image_type(f"x.{extension}"),
        )
    )
    return f'<p><img src="{token}" alt=""/></p>', total_bytes


def _pdf_is_decorative_card(data: bytes, image_decoder: Any) -> bool:
    """Drop blank card shells painted into PDFs exported by the web UI."""
    try:
        pixmap = image_decoder.Pixmap(data)
        samples = pixmap.samples
        channels = max(1, int(pixmap.n))
        luminance = [
            sum(samples[index : index + min(3, channels)]) / min(3, channels)
            for index in range(0, len(samples), channels)
        ]
    except (RuntimeError, TypeError, ValueError):
        return False
    if not luminance:
        return False
    white_ratio = sum(value > 245 for value in luminance) / len(luminance)
    dark_ratio = sum(value < 40 for value in luminance) / len(luminance)
    return white_ratio >= 0.75 and dark_ratio >= 0.04


def _pdf_text_block(
    block: dict[str, Any],
    body_size: float,
    font_styles: dict[str, dict[str, bool]] | None = None,
    underline_rects: list[tuple[float, float, float, float]] | None = None,
) -> str | None:
    text, size, bold = _join_block_lines(block, font_styles)
    if not text:
        return None
    escaped = _pdf_inline_html(block, body_size, font_styles, underline_rects)
    level = _heading_level(size, bold, body_size)
    if level is None:
        return f"<p>{escaped}</p>"
    return f"<h{level}>{escaped}</h{level}>"


def _pdf_inline_html(
    block: dict[str, Any],
    body_size: float,
    font_styles: dict[str, dict[str, bool]] | None = None,
    underline_rects: list[tuple[float, float, float, float]] | None = None,
) -> str:
    """Preserve the small monospace snippets used as inline code in exports."""
    lines: list[str] = []
    for line in block.get("lines", []):
        raw_spans = [
            (
                str(span.get("text", "")),
                str(span.get("font", "")),
                float(span.get("size", 0.0) or 0.0),
                int(span.get("color", 0) or 0),
                span.get("bbox"),
            )
            for span in line.get("spans", [])
        ]
        span_styles = [
            _pdf_span_style({"font": font, "size": size}, font_styles)
            for _value, font, size, _color, _bbox in raw_spans
        ]
        code_states = [
            bool(value.strip())
            and (
                bool(style.get("code"))
                or any(token in font.lower() for token in ("mono", "courier", "consolas"))
                or (body_size > 0 and size <= body_size * 0.92)
            )
            for (value, font, size, _color, _bbox), style in zip(raw_spans, span_styles, strict=False)
        ]
        # Chromium may emit spaces as separate spans between glyph runs. Keep
        # those spaces inside the same code mark so one identifier does not
        # become a sequence of adjacent <code> elements.
        for index, (value, _font, _size, _color, _bbox) in enumerate(raw_spans):
            if value.strip() or index == 0 or index == len(raw_spans) - 1:
                continue
            code_states[index] = code_states[index - 1] and code_states[index + 1]

        segments: list[tuple[tuple[bool, bool, bool, bool], str]] = []
        for index, (value, _font, size, color, bbox) in enumerate(raw_spans):
            if not value:
                continue
            style = span_styles[index]
            marks = (
                code_states[index],
                bool(style.get("bold")),
                bool(style.get("italic")),
                _pdf_span_is_underlined(bbox, underline_rects),
            )
            escaped = html_module.escape(value)
            if color or (not style.get("bold") and body_size > 0 and abs(size - body_size) / body_size > 0.08):
                red, green, blue = (color >> 16 & 255, color >> 8 & 255, color & 255)
                declarations = []
                if color:
                    declarations.append(f"color:#{red:02x}{green:02x}{blue:02x}")
                if not style.get("bold") and body_size > 0 and abs(size - body_size) / body_size > 0.08:
                    declarations.append(f"font-size:{size:.1f}pt")
                escaped = f'<span style="{";".join(declarations)}">{escaped}</span>'
            if segments and segments[-1][0] == marks:
                segments[-1] = (marks, segments[-1][1] + escaped)
            else:
                segments.append((marks, escaped))
        line_html = "".join(
            _wrap_pdf_marks(marks, value) for marks, value in segments
        )
        if line_html:
            lines.append(line_html)
    return " ".join(lines) or html_module.escape(_pdf_block_plain_text(block))


def _join_block_lines(
    block: dict[str, Any], font_styles: dict[str, dict[str, bool]] | None = None
) -> tuple[str, float, bool]:
    """Flatten a block to text, plus the dominant font size and boldness."""
    pieces: list[str] = []
    sizes: list[float] = []
    bold_spans = 0
    total_spans = 0

    for line in block.get("lines", []):
        line_text = ""
        for span in line.get("spans", []):
            line_text += span.get("text", "")
            sizes.append(float(span.get("size", 0.0)))
            total_spans += 1
            if _pdf_span_style(span, font_styles).get("bold"):
                bold_spans += 1
        if not line_text:
            continue
        if pieces and pieces[-1].endswith("-"):
            # De-hyphenate across a line break rather than storing "exam- ple".
            pieces[-1] = pieces[-1][:-1] + line_text.lstrip()
        else:
            pieces.append(line_text)

    text = " ".join(" ".join(pieces).split())
    size = max(sizes) if sizes else 0.0
    bold = total_spans > 0 and bold_spans / total_spans >= 0.6
    return text, size, bold


def _heading_level(size: float, bold: bool, body_size: float) -> int | None:
    if body_size <= 0:
        return None
    ratio = size / body_size
    if ratio >= _H1_RATIO and bold:
        return 1
    if ratio >= _H2_RATIO:
        return 2
    if ratio >= _H3_RATIO and bold:
        return 3
    return None


def _lines_heading_level(
    lines: list[dict[str, Any]],
    body_size: float,
    font_styles: dict[str, dict[str, bool]] | None,
) -> int | None:
    """`_heading_level`, judged from a handful of lines rather than a block.

    A numbered section heading is often followed immediately by its own
    bullet list, with no blank paragraph between them - so both land in the
    same PDF block. Judging the heading by the whole block's font mix dilutes
    its boldness ratio below what `_heading_level` requires, since the list
    body contributes far more (non-bold) spans than the heading line itself.
    """
    sizes: list[float] = []
    bold_spans = 0
    total_spans = 0
    for line in lines:
        for span in line.get("spans", []):
            sizes.append(float(span.get("size", 0.0) or 0.0))
            total_spans += 1
            if _pdf_span_style(span, font_styles).get("bold"):
                bold_spans += 1
    if not sizes:
        return None
    bold = total_spans > 0 and bold_spans / total_spans >= 0.6
    return _heading_level(max(sizes), bold, body_size)


def _modal_font_size(
    document: Any, font_styles: dict[str, dict[str, bool]] | None = None
) -> float:
    """The most common span size in the first pages - i.e. the body text size.

    The mode rather than the mean: a document with a huge title page would drag
    a mean upward and leave every real heading looking like body text.
    """
    counter: Counter[float] = Counter()
    for index, page in enumerate(document):
        if index >= _PDF_FONT_SAMPLE_PAGES:
            break
        for block in page.get_text("dict").get("blocks", []):
            if block.get("type") == 1:
                continue
            for line in block.get("lines", []):
                # A diagonal watermark line's characters would otherwise count
                # toward "the" body size just like real text - and on a page
                # with little other text, a large stamp can outweigh it.
                if not _pdf_line_is_horizontal(line):
                    continue
                for span in line.get("spans", []):
                    text = str(span.get("text", "")).strip()
                    if text and not _pdf_span_style(span, font_styles).get("code"):
                        counter[round(float(span.get("size", 0.0)), 1)] += len(text)
    if not counter:
        return 0.0
    return counter.most_common(1)[0][0]


def _pdf_metadata_title(document: Any) -> str | None:
    metadata = getattr(document, "metadata", None) or {}
    title = str(metadata.get("title") or "").strip()
    return title or None
