"""DOCX table and paragraph formatting enrichment for Pandoc HTML output."""

from __future__ import annotations

import re
import zipfile
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup, Tag
from lxml import etree

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
                # Pandoc silently drops a `<w:p>` with no runs at all rather
                # than emitting an empty `<p></p>` - keeping it here would
                # shift every later paragraph in this cell out of step with
                # its Pandoc counterpart, applying each line's formatting to
                # the *next* line instead. A blank spacer line inside a code
                # sample or diagram still has runs (even if their text is
                # only spaces), so this only drops the ones Pandoc also drops.
                docx_paragraphs = [
                    p
                    for p in docx_cell.findall("./w:p", _DOCX_NS)
                    if p.find("./w:r", _DOCX_NS) is not None
                ]
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
                    if _docx_paragraph_needs_raw_rebuild(docx_paragraph):
                        _rebuild_paragraph_from_docx_runs(html_paragraph, docx_paragraph)
                        continue
                    color = _docx_paragraph_color(docx_paragraph)
                    if color:
                        if len(docx_paragraphs) == 1:
                            # A `<td>`'s own `color` attribute is part of the
                            # editor's table-cell schema (see
                            # `TableCellWithBackground` in the frontend), so
                            # setting it here is enough to survive a
                            # round-trip through the editor.
                            _merge_inline_style(html_cell, "color", color)
                        else:
                            # A paragraph has no such attribute, so a color set
                            # directly on it would be silently dropped the
                            # moment this HTML loads into the editor. Wrapping
                            # its content in a `<span style="color:...">`
                            # instead is what the text-color mark actually
                            # parses (see `TextStyleMark` in the frontend).
                            _wrap_docx_paragraph_color(html_paragraph, color)
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


#: Fonts that mean "this text is meant to line up in fixed-width columns" -
#: a hand-built code sample or box-drawn diagram, never ordinary prose.
_MONOSPACE_FONTS = frozenset(
    {
        "consolas", "courier new", "courier", "lucida console", "monaco",
        "menlo", "cascadia code", "cascadia mono", "fira code",
        "source code pro", "dejavu sans mono", "andale mono", "roboto mono",
    }
)


def _docx_run_font(run: Any) -> str | None:
    properties = run.find("./w:rPr", _DOCX_NS)
    fonts = properties.find("./w:rFonts", _DOCX_NS) if properties is not None else None
    if fonts is None:
        return None
    for attribute in ("ascii", "hAnsi"):
        value = fonts.get(f"{{{_DOCX_NS['w']}}}{attribute}")
        if value:
            return value.strip().lower()
    return None


def _docx_run_text(run: Any) -> str:
    return "".join(node.text or "" for node in run.findall("./w:t", _DOCX_NS))


def _docx_run_color(run: Any) -> str | None:
    properties = run.find("./w:rPr", _DOCX_NS)
    color = properties.find("./w:color", _DOCX_NS) if properties is not None else None
    value = (color.get(f"{{{_DOCX_NS['w']}}}val", "") if color is not None else "").lower()
    if value and value != "auto" and _DOCX_HEX.fullmatch(value):
        return f"#{value}"
    return None


def _docx_paragraph_needs_raw_rebuild(paragraph: Any) -> bool:
    """True where Pandoc's own rendering of this paragraph loses its shape.

    Pandoc treats every Word paragraph as prose: it collapses runs of spaces
    down to one, and drops direct character color entirely (as opposed to a
    named style, which it can carry over). Neither loss is visible on an
    ordinary paragraph, but a paragraph set in a monospace font, or leaning
    on two or more consecutive spaces to line up columns, is never prose -
    it is a code sample or a box-drawn diagram, and either signal alone is
    specific enough that a false match on real prose is effectively unseen.
    """
    for run in paragraph.findall("./w:r", _DOCX_NS):
        font = _docx_run_font(run)
        if font is not None and font in _MONOSPACE_FONTS:
            return True
        if "  " in _docx_run_text(run):
            return True
    return False


#: A generic-CSS-keyword-terminated stack, so a fixed-width font renders even
#: where none of the named ones are installed. What makes this rebuild worth
#: doing at all: a proportional font gives every character (and, critically,
#: the non-breaking spaces standing in for the source's indentation) its own
#: width, so the same column position drifts line to line and the box a
#: diagram was drawn in no longer lines up - the mangled shape this whole
#: function exists to avoid, just moved from Pandoc's whitespace collapsing to
#: the browser's font rendering instead.
#: Every name here is a single CSS token on purpose - a quoted multi-word
#: name (`"Cascadia Code"`) would make BeautifulSoup re-quote the whole
#: `style` attribute with single quotes to hold it, which is valid HTML but
#: needlessly inconsistent with every other style this module writes.
_PREFORMATTED_FONT_STACK = "ui-monospace, Consolas, Menlo, Monaco, monospace"


def _rebuild_paragraph_from_docx_runs(html_paragraph: Tag, docx_paragraph: Any) -> None:
    """Replace Pandoc's mangled text with a faithful copy of the source runs.

    Every space becomes non-breaking so the columns Pandoc collapsed stay
    put, every run is set in a monospace font so those columns actually line
    up once rendered, and each run's own color rides along in the same
    `<span style="...">` - the shape the editor's text-color mark actually
    parses (see `TextStyleMark` in the frontend), and the only way two runs
    of different colors in one line (a key in one color, its value in
    another) can survive as two colors instead of one or none.
    """
    html_paragraph.clear()
    factory = BeautifulSoup("", "html.parser")
    for run in docx_paragraph.findall("./w:r", _DOCX_NS):
        text = _docx_run_text(run).replace(" ", "\u00a0")
        if not text:
            continue
        style = f"font-family: {_PREFORMATTED_FONT_STACK}"
        color = _docx_run_color(run)
        if color:
            style += f"; color: {color}"
        span = factory.new_tag("span", attrs={"style": style})
        span.string = text
        html_paragraph.append(span)


def _wrap_docx_paragraph_color(paragraph: Tag, color: str) -> None:
    """Wrap a paragraph's content in a colored span rather than the paragraph.

    A `<p style="color:...">` has no home in the editor's schema - a
    paragraph node carries no such attribute, so the color is silently
    dropped the moment this HTML loads. Wrapping the paragraph's existing
    content in a `<span style="color:...">` instead is what the text-color
    mark parses, and preserves whatever Pandoc already rendered inside it
    (bold, links, and the rest) rather than replacing it.
    """
    if not paragraph.contents:
        return
    factory = BeautifulSoup("", "html.parser")
    wrapper = factory.new_tag("span", attrs={"style": f"color: {color}"})
    for child in list(paragraph.contents):
        child.extract()
        wrapper.append(child)
    paragraph.append(wrapper)


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
