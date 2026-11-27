"""DOCX table and paragraph formatting enrichment for Pandoc HTML output."""

from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup, Tag
from lxml import etree

_DOCX_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
_W = f"{{{_DOCX_NS['w']}}}"
_DOCX_HEX = re.compile(r"^[0-9a-fA-F]{6}$")

_NO_BORDER_CSS = "0px solid transparent"
_DEFAULT_BORDER_COLOR = "var(--border-strong)"
_FRAME_BORDER_COLOR = "var(--foreground)"

_OOXML_BORDER_STYLE_MAP: dict[str, str] = {
    "none": "none",
    "nil": "none",
    "single": "solid",
    "thick": "solid",
    "dotted": "dotted",
    "dashed": "dashed",
    "dashsmallgap": "dashed",
    "dotdash": "dashed",
    "dotdotdash": "dashed",
    "dashdotstroked": "dashed",
    "double": "double",
    "triple": "double",
    "thinthicksmallgap": "double",
    "thickthinsmallgap": "double",
    "thinthickthinsmallgap": "double",
    "thinthickmediumgap": "double",
    "thickthinmediumgap": "double",
    "thinthickthinmediumgap": "double",
    "thinthicklargegap": "double",
    "thickthinlargegap": "double",
    "thinthickthinlargegap": "double",
    "wave": "double",
    "doublewave": "double",
    "threedengrave": "groove",
    "threedemboss": "ridge",
    "inset": "inset",
    "outset": "outset",
}

_OOXML_HIGHLIGHT_HEX: dict[str, str] = {
    "yellow": "#fef08a",
    "green": "#bbf7d0",
    "cyan": "#a5f3fc",
    "magenta": "#f5d0fe",
    "blue": "#bfdbfe",
    "red": "#fecaca",
    "darkblue": "#93c5fd",
    "darkcyan": "#99f6e4",
    "darkgreen": "#86efac",
    "darkmagenta": "#e9d5ff",
    "darkred": "#fca5a5",
    "darkyellow": "#fde047",
    "darkgray": "#d1d5db",
    "lightgray": "#e5e7eb",
}


@dataclass(slots=True)
class _DocxGridCell:
    """One logical (non-continuation) Word table cell with its 2D grid bounds."""

    row_start: int
    row_end: int
    col_start: int
    col_end: int
    tc: Any
    bottom_tc: Any


def _enrich_docx_table_formatting(html: str, source: Path) -> str:
    """Carry Word table and body formatting into Pandoc's HTML fragment.

    Pandoc intentionally focuses on semantic HTML and omits direct OOXML
    table properties (borders, borderless layout tables, cell shading,
    vertical/horizontal alignment, column widths) as well as body paragraph
    alignment and text color. Those properties are safe to copy as a small
    inline-style allowlist because the result still passes through
    ``sanitize_imported_html`` later.
    """
    parser = etree.XMLParser(resolve_entities=False, no_network=True)
    styles_root: Any = None
    try:
        with zipfile.ZipFile(source) as archive:
            document = etree.fromstring(archive.read("word/document.xml"), parser=parser)
            if "word/styles.xml" in archive.namelist():
                try:
                    styles_root = etree.fromstring(archive.read("word/styles.xml"), parser=parser)
                except etree.XMLSyntaxError:
                    styles_root = None
    except (OSError, KeyError, etree.XMLSyntaxError, zipfile.BadZipFile):
        # A malformed DOCX will be rejected by Pandoc; do not turn a missing
        # optional fidelity enhancement into a different import failure.
        return html

    table_styles, default_table_style = _parse_docx_table_styles(styles_root)
    paragraph_styles = _parse_docx_paragraph_styles(styles_root)

    soup = BeautifulSoup(html or "", "html.parser")
    _enrich_docx_body_formatting(soup, document, paragraph_styles)

    html_tables = soup.find_all("table")
    docx_tables = document.findall(".//w:tbl", _DOCX_NS)
    pending_splits: list[tuple[Tag, int]] = []
    for html_table, docx_table in zip(html_tables, docx_tables, strict=False):
        split_at = _enrich_single_docx_table(
            soup, html_table, docx_table, table_styles, default_table_style
        )
        if split_at is not None and html_table.find_parent("table") is None:
            pending_splits.append((html_table, split_at))
    for html_table, split_at in pending_splits:
        _split_html_table_at_row(soup, html_table, split_at)
    return str(soup)


def _parse_docx_table_styles(
    styles_root: Any,
) -> tuple[dict[str, dict[str, str]], str | None]:
    """Extract inherited ``tblBorders`` maps for every table style in ``styles.xml``."""
    if styles_root is None:
        return {}, None

    raw_borders: dict[str, dict[str, str]] = {}
    based_on: dict[str, str] = {}
    default_style: str | None = None

    for style in styles_root.findall("./w:style", _DOCX_NS):
        if style.get(f"{_W}type") != "table":
            continue
        style_id = style.get(f"{_W}styleId")
        if not style_id:
            continue
        if style.get(f"{_W}default") in {"1", "true", "on"} and default_style is None:
            default_style = style_id
        parent = style.find("./w:basedOn", _DOCX_NS)
        if parent is not None:
            parent_id = parent.get(f"{_W}val")
            if parent_id:
                based_on[style_id] = parent_id
        tbl_borders = style.find("./w:tblPr/w:tblBorders", _DOCX_NS)
        raw_borders[style_id] = _parse_border_container(tbl_borders)

    resolved: dict[str, dict[str, str]] = {}

    def resolve(style_id: str, seen: set[str]) -> dict[str, str]:
        if style_id in resolved:
            return resolved[style_id]
        if style_id in seen:
            return {}
        seen.add(style_id)
        merged: dict[str, str] = {}
        parent_id = based_on.get(style_id)
        if parent_id and parent_id in raw_borders:
            merged.update(resolve(parent_id, seen))
        merged.update(raw_borders.get(style_id, {}))
        resolved[style_id] = merged
        return merged

    for style_id in raw_borders:
        resolve(style_id, set())

    return resolved, default_style


def _parse_docx_paragraph_styles(styles_root: Any) -> dict[str, dict[str, str]]:
    """Extract inherited alignment (``jc``) for paragraph styles in ``styles.xml``."""
    if styles_root is None:
        return {}

    raw: dict[str, dict[str, str]] = {}
    based_on: dict[str, str] = {}

    for style in styles_root.findall("./w:style", _DOCX_NS):
        if style.get(f"{_W}type") != "paragraph":
            continue
        style_id = style.get(f"{_W}styleId")
        if not style_id:
            continue
        parent = style.find("./w:basedOn", _DOCX_NS)
        if parent is not None:
            parent_id = parent.get(f"{_W}val")
            if parent_id:
                based_on[style_id] = parent_id
        props: dict[str, str] = {}
        jc = style.find("./w:pPr/w:jc", _DOCX_NS)
        if jc is not None:
            mapped = _map_docx_jc(jc.get(f"{_W}val"))
            if mapped:
                props["jc"] = mapped
        raw[style_id] = props

    resolved: dict[str, dict[str, str]] = {}

    def resolve(style_id: str, seen: set[str]) -> dict[str, str]:
        if style_id in resolved:
            return resolved[style_id]
        if style_id in seen:
            return {}
        seen.add(style_id)
        merged: dict[str, str] = {}
        parent_id = based_on.get(style_id)
        if parent_id and parent_id in raw:
            merged.update(resolve(parent_id, seen))
        merged.update(raw.get(style_id, {}))
        resolved[style_id] = merged
        return merged

    for style_id in raw:
        resolve(style_id, set())

    return resolved


def _parse_ooxml_border(border: Any) -> str | None:
    """Convert one OOXML border element (``w:top``, ``w:insideH``, etc.) to CSS."""
    if border is None:
        return None
    raw_val = (border.get(f"{_W}val") or "").strip()
    raw_color = (border.get(f"{_W}color") or "").strip()
    raw_sz = (border.get(f"{_W}sz") or "").strip()

    val_lower = raw_val.lower()
    if val_lower in {"none", "nil"}:
        return _NO_BORDER_CSS

    if not val_lower:
        if not (_DOCX_HEX.fullmatch(raw_color) or (raw_sz.isdigit() and int(raw_sz) > 0)):
            return None
        css_style = "solid"
    else:
        css_style = _OOXML_BORDER_STYLE_MAP.get(val_lower, "solid")

    try:
        sz = int(raw_sz) if raw_sz else 4
    except ValueError:
        sz = 4

    if css_style == "double":
        # CSS collapses `1px double` and `2px double` into a single solid line;
        # 3px is the minimum width that visibly renders two parallel strokes.
        width = "4px" if sz > 8 else "3px"
    elif sz <= 8:
        width = "1px"
    elif sz <= 14:
        width = "2px"
    elif sz <= 20:
        width = "3px"
    else:
        width = "4px"

    if _DOCX_HEX.fullmatch(raw_color):
        color = f"#{raw_color.lower()}"
    elif css_style == "double" or sz >= 16:
        color = _FRAME_BORDER_COLOR
    else:
        color = _DEFAULT_BORDER_COLOR

    return f"{width} {css_style} {color}"


def _parse_border_container(container: Any) -> dict[str, str]:
    if container is None:
        return {}
    result: dict[str, str] = {}
    for side in ("top", "left", "bottom", "right", "insideH", "insideV", "tl2br", "tr2bl"):
        parsed = _parse_ooxml_border(container.find(f"./w:{side}", _DOCX_NS))
        if parsed is not None:
            result[side] = parsed
    return result


def _table_border_defaults(
    docx_table: Any,
    table_styles: dict[str, dict[str, str]],
    default_table_style: str | None,
) -> dict[str, str]:
    tbl_pr = docx_table.find("./w:tblPr", _DOCX_NS)
    style_id = None
    if tbl_pr is not None:
        tbl_style = tbl_pr.find("./w:tblStyle", _DOCX_NS)
        if tbl_style is not None:
            style_id = tbl_style.get(f"{_W}val")
    effective_style = style_id or default_table_style
    defaults: dict[str, str] = {}
    if effective_style and effective_style in table_styles:
        defaults.update(table_styles[effective_style])
    if tbl_pr is not None:
        defaults.update(_parse_border_container(tbl_pr.find("./w:tblBorders", _DOCX_NS)))
    return defaults


def _is_vmerge_continuation(docx_cell: Any) -> bool:
    vmerge = docx_cell.find("./w:tcPr/w:vMerge", _DOCX_NS)
    if vmerge is None:
        return False
    val = (vmerge.get(f"{_W}val") or "").strip().lower()
    return val != "restart"


def _build_docx_table_grid(
    docx_rows: list[Any],
) -> tuple[list[list[_DocxGridCell]], dict[tuple[int, int], _DocxGridCell], int]:
    """Map every logical (non-continuation) cell to its 2D row/col span.

    In OOXML, vertically merged continuation cells remain as ``<w:tc>`` tags in
    subsequent rows with ``<w:vMerge/>`` (no ``w:val="restart"``), whereas
    Pandoc omits those continuation cells from HTML ``<tr>`` elements because
    the originating cell already carries ``rowspan``. Filtering them out here
    keeps every row aligned 1-to-1 with Pandoc's HTML cells.
    """
    row_real_cells: list[list[_DocxGridCell]] = []
    grid: dict[tuple[int, int], _DocxGridCell] = {}
    max_cols = 0

    for row_index, docx_row in enumerate(docx_rows):
        real_cells: list[_DocxGridCell] = []
        col = 0
        for docx_cell in docx_row.findall("./w:tc", _DOCX_NS):
            span = _docx_cell_grid_span(docx_cell)
            if _is_vmerge_continuation(docx_cell):
                origin = grid.get((row_index - 1, col)) if row_index > 0 else None
                if origin is not None:
                    origin.row_end = max(origin.row_end, row_index)
                    origin.bottom_tc = docx_cell
                    for c in range(col, col + span):
                        grid[(row_index, c)] = origin
                col += span
                continue

            entry = _DocxGridCell(
                row_start=row_index,
                row_end=row_index,
                col_start=col,
                col_end=col + span - 1,
                tc=docx_cell,
                bottom_tc=docx_cell,
            )
            real_cells.append(entry)
            for c in range(col, col + span):
                grid[(row_index, c)] = entry
            col += span

        max_cols = max(max_cols, col)
        row_real_cells.append(real_cells)

    return row_real_cells, grid, max_cols


def _resolve_table_cell_borders(
    row_real_cells: list[list[_DocxGridCell]],
    grid: dict[tuple[int, int], _DocxGridCell],
    num_rows: int,
    num_cols: int,
    tbl_defaults: dict[str, str],
) -> tuple[dict[int, dict[str, str]], dict[int, tuple[str | None, str | None]]]:
    """Compute final per-side CSS borders and diagonal borders for every cell."""
    sides_by_cell: dict[int, dict[str, str]] = {}
    diagonals_by_cell: dict[int, tuple[str | None, str | None]] = {}

    for row_cells in row_real_cells:
        for cell in row_cells:
            top_tc_borders = _parse_border_container(cell.tc.find("./w:tcPr/w:tcBorders", _DOCX_NS))
            bottom_tc_borders = (
                top_tc_borders
                if cell.bottom_tc is cell.tc
                else _parse_border_container(cell.bottom_tc.find("./w:tcPr/w:tcBorders", _DOCX_NS))
            )

            top = (
                top_tc_borders.get("top")
                or tbl_defaults.get("top" if cell.row_start == 0 else "insideH")
                or _NO_BORDER_CSS
            )
            bottom = (
                bottom_tc_borders.get("bottom")
                or tbl_defaults.get("bottom" if cell.row_end == num_rows - 1 else "insideH")
                or _NO_BORDER_CSS
            )
            left = (
                top_tc_borders.get("left")
                or tbl_defaults.get("left" if cell.col_start == 0 else "insideV")
                or _NO_BORDER_CSS
            )
            right = (
                top_tc_borders.get("right")
                or tbl_defaults.get("right" if cell.col_end == num_cols - 1 else "insideV")
                or _NO_BORDER_CSS
            )

            sides_by_cell[id(cell)] = {
                "top": top,
                "right": right,
                "bottom": bottom,
                "left": left,
            }

            diag_down = top_tc_borders.get("tl2br")
            diag_up = top_tc_borders.get("tr2bl")
            if diag_down == _NO_BORDER_CSS:
                diag_down = None
            if diag_up == _NO_BORDER_CSS:
                diag_up = None
            if diag_down or diag_up:
                diagonals_by_cell[id(cell)] = (diag_down, diag_up)

    # Reconcile shared interior edges where Word emits `w:val="nil"` on one
    # cell and the visible border on its adjacent neighbour (for example,
    # col N has `right: single` while col N+1 has `left: nil`). Adopting the
    # neighbour's visible stroke keeps CSS border-collapse and the editor's
    # border inspector consistent.
    for row_cells in row_real_cells:
        for cell in row_cells:
            sides = sides_by_cell[id(cell)]
            if sides["left"] == _NO_BORDER_CSS and cell.col_start > 0:
                neighbor_borders = {
                    sides_by_cell[id(n)]["right"]
                    for r in range(cell.row_start, cell.row_end + 1)
                    if (n := grid.get((r, cell.col_start - 1))) is not None
                }
                if len(neighbor_borders) == 1:
                    candidate = next(iter(neighbor_borders))
                    if candidate != _NO_BORDER_CSS:
                        sides["left"] = candidate
            if sides["right"] == _NO_BORDER_CSS and cell.col_end + 1 < num_cols:
                neighbor_borders = {
                    sides_by_cell[id(n)]["left"]
                    for r in range(cell.row_start, cell.row_end + 1)
                    if (n := grid.get((r, cell.col_end + 1))) is not None
                }
                if len(neighbor_borders) == 1:
                    candidate = next(iter(neighbor_borders))
                    if candidate != _NO_BORDER_CSS:
                        sides["right"] = candidate
            if sides["top"] == _NO_BORDER_CSS and cell.row_start > 0:
                neighbor_borders = {
                    sides_by_cell[id(n)]["bottom"]
                    for c in range(cell.col_start, cell.col_end + 1)
                    if (n := grid.get((cell.row_start - 1, c))) is not None
                }
                if len(neighbor_borders) == 1:
                    candidate = next(iter(neighbor_borders))
                    if candidate != _NO_BORDER_CSS:
                        sides["top"] = candidate
            if sides["bottom"] == _NO_BORDER_CSS and cell.row_end + 1 < num_rows:
                neighbor_borders = {
                    sides_by_cell[id(n)]["top"]
                    for c in range(cell.col_start, cell.col_end + 1)
                    if (n := grid.get((cell.row_end + 1, c))) is not None
                }
                if len(neighbor_borders) == 1:
                    candidate = next(iter(neighbor_borders))
                    if candidate != _NO_BORDER_CSS:
                        sides["bottom"] = candidate

    return sides_by_cell, diagonals_by_cell


def _apply_resolved_borders(
    html_cell: Tag,
    sides: dict[str, str],
    diagonals: tuple[str | None, str | None] | None,
) -> None:
    top, right, bottom, left = sides["top"], sides["right"], sides["bottom"], sides["left"]
    if top == right == bottom == left:
        _merge_inline_style(html_cell, "border", top)
    else:
        _merge_inline_style(html_cell, "border-top", top)
        _merge_inline_style(html_cell, "border-right", right)
        _merge_inline_style(html_cell, "border-bottom", bottom)
        _merge_inline_style(html_cell, "border-left", left)
    if diagonals:
        diag_down, diag_up = diagonals
        if diag_down:
            html_cell["data-diagonal-down"] = diag_down
        if diag_up:
            html_cell["data-diagonal-up"] = diag_up


def _demote_layout_header_row(soup: BeautifulSoup, html_table: Tag, first_row: Tag) -> None:
    """Demote Pandoc's synthetic ``<thead><th>`` on borderless/cover layout tables."""
    for cell in first_row.find_all("th", recursive=False):
        cell.name = "td"
    thead = html_table.find("thead", recursive=False)
    if thead is None:
        return
    tbody = html_table.find("tbody", recursive=False)
    if tbody is None:
        tbody = soup.new_tag("tbody")
        thead.insert_after(tbody)
    for child in list(thead.contents):
        tbody.insert(0, child.extract())
    thead.decompose()


def _docx_row_starts_with_page_break(docx_row: Any) -> bool:
    first_cell = docx_row.find("./w:tc", _DOCX_NS)
    if first_cell is None:
        return False
    first_p = first_cell.find("./w:p", _DOCX_NS)
    if first_p is None:
        return False
    if first_p.find("./w:pPr/w:pageBreakBefore", _DOCX_NS) is not None:
        return True
    for br in first_p.findall("./w:r/w:br", _DOCX_NS):
        if (br.get(f"{_W}type") or "").strip().lower() == "page":
            return True
    return False


def _split_html_table_at_row(soup: BeautifulSoup, html_table: Tag, split_index: int) -> None:
    """Split a Word cover-frame + data-table hybrid into two clean tables."""
    all_rows = _direct_html_table_rows(html_table)
    if split_index <= 0 or split_index >= len(all_rows):
        return

    top_rows = all_rows[:split_index]
    bottom_rows = all_rows[split_index:]

    second_table = soup.new_tag("table")
    if html_table.get("style"):
        second_table["style"] = html_table["style"]
    second_tbody = soup.new_tag("tbody")
    for row in bottom_rows:
        second_tbody.append(row.extract())
    second_table.append(second_tbody)

    # Clean up stale multi-column `colspan` on the now 1-column cover table.
    for row in top_rows:
        cells = row.find_all(["th", "td"], recursive=False)
        if len(cells) == 1:
            cells[0].attrs.pop("colspan", None)

    # Pandoc turns the leading `<w:br w:type="page"/>` into a stray `<br/>`
    # at the top of the first cell of the split-off table; remove it so the
    # header label aligns with its sibling cells.
    first_bottom_cell = bottom_rows[0].find(["th", "td"], recursive=False)
    if first_bottom_cell is not None:
        first_br = first_bottom_cell.find("br")
        if first_br is not None:
            preceding = "".join(
                str(s) for s in first_br.previous_siblings if isinstance(s, str)
            ).strip()
            if not preceding:
                first_br.decompose()

    html_table.insert_after(second_table)


def _docx_row_height_px(docx_row: Any) -> int | None:
    tr_height = docx_row.find("./w:trPr/w:trHeight", _DOCX_NS)
    if tr_height is None:
        return None
    raw = tr_height.get(f"{_W}val")
    try:
        twips = int(raw or "0")
    except ValueError:
        return None
    if twips < 900:
        return None
    return min(140, max(36, round(twips / 30)))


def _insert_cover_cell_spacers(
    soup: BeautifulSoup,
    html_cell: Tag,
    docx_cell: Any,
    html_paragraphs: list[Tag],
    docx_paragraphs: list[Any],
) -> None:
    """Preserve intentional vertical blank-line gaps inside cover/frame cells."""
    if not html_paragraphs or not docx_paragraphs:
        return
    p_to_html = dict(zip(docx_paragraphs, html_paragraphs, strict=False))
    empty_run = 0
    seen_content = False
    for child in docx_cell:
        if child.tag == f"{_W}tbl":
            seen_content = True
            empty_run = 0
        elif child.tag == f"{_W}p":
            if child in p_to_html:
                if seen_content and empty_run >= 2:
                    target = p_to_html[child]
                    for _ in range(min(3, empty_run // 2)):
                        spacer = soup.new_tag("p")
                        spacer.append(soup.new_tag("br"))
                        target.insert_before(spacer)
                seen_content = True
                empty_run = 0
            elif not "".join(child.itertext()).strip():
                empty_run += 1


def _enrich_single_docx_table(
    soup: BeautifulSoup,
    html_table: Tag,
    docx_table: Any,
    table_styles: dict[str, dict[str, str]],
    default_table_style: str | None,
) -> int | None:
    column_widths = _docx_table_column_widths(docx_table)
    total_width = sum(column_widths)
    if total_width:
        _merge_inline_style(html_table, "width", "100%")

    html_rows = _direct_html_table_rows(html_table)
    docx_rows = docx_table.findall("./w:tr", _DOCX_NS)
    if not html_rows or not docx_rows:
        return None

    row_real_cells, grid, num_cols = _build_docx_table_grid(docx_rows)
    tbl_defaults = _table_border_defaults(docx_table, table_styles, default_table_style)
    sides_by_cell, diagonals_by_cell = _resolve_table_cell_borders(
        row_real_cells,
        grid,
        len(docx_rows),
        max(num_cols, len(column_widths)),
        tbl_defaults,
    )

    table_is_borderless = all(
        all(v == _NO_BORDER_CSS for v in sides_by_cell[id(cell)].values())
        for r_cells in row_real_cells
        for cell in r_cells
    )

    # Pandoc promotes row 0 of almost every Word table into `<thead><th>`, which
    # adds header shading and bold styling. When row 0 is NOT marked as a header
    # (`w:tblHeader`), has no cell shading, and either contains a nested table
    # (cover-page frame) or belongs to a completely borderless layout table,
    # demote it back to `<td>`.
    first_docx_row = docx_rows[0]
    first_row_has_tbl_header = first_docx_row.find("./w:trPr/w:tblHeader", _DOCX_NS) is not None
    if not first_row_has_tbl_header and row_real_cells[0]:
        first_row_has_shading = any(
            _docx_cell_fill(cell.tc) is not None for cell in row_real_cells[0]
        )
        first_row_has_nested_table = any(
            cell.tc.find("./w:tbl", _DOCX_NS) is not None for cell in row_real_cells[0]
        )
        if not first_row_has_shading and (first_row_has_nested_table or table_is_borderless):
            _demote_layout_header_row(soup, html_table, html_rows[0])

    # Detect a cover-page frame fused onto a multi-column table across a page break.
    split_index: int | None = None
    for idx in range(1, min(len(docx_rows), len(html_rows))):
        if (
            _docx_row_starts_with_page_break(docx_rows[idx])
            and len(row_real_cells[idx]) >= 2
            and all(len(row_real_cells[r]) == 1 for r in range(idx))
        ):
            split_index = idx
            break

    for html_row, docx_row, real_cells in zip(html_rows, docx_rows, row_real_cells, strict=False):
        if table_is_borderless:
            height_px = _docx_row_height_px(docx_row)
            if height_px is not None:
                _merge_inline_style(html_row, "height", f"{height_px}px")
        html_cells = html_row.find_all(["th", "td"], recursive=False)
        for html_cell, grid_cell in zip(html_cells, real_cells, strict=False):
            docx_cell = grid_cell.tc
            widths = column_widths[grid_cell.col_start : grid_cell.col_end + 1]
            if widths and total_width:
                width_percent = sum(widths) / total_width * 100
                _merge_inline_style(html_cell, "width", f"{width_percent:.4f}%")

            cell_properties = docx_cell.find("./w:tcPr", _DOCX_NS)
            if cell_properties is not None:
                _apply_docx_cell_style(html_cell, cell_properties, apply_borders=False)

            _apply_resolved_borders(
                html_cell,
                sides_by_cell[id(grid_cell)],
                diagonals_by_cell.get(id(grid_cell)),
            )

            html_paragraphs = html_cell.find_all("p", recursive=False)
            # Pandoc silently drops a `<w:p>` with no runs at all rather than
            # emitting an empty `<p></p>` - keeping it here would shift every
            # later paragraph in this cell out of step with its Pandoc
            # counterpart, applying each line's formatting to the *next* line
            # instead. A blank spacer line inside a code sample or diagram
            # still has runs (even if their text is only spaces), so this only
            # drops the ones Pandoc also drops.
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
                font_size = _docx_paragraph_font_size(docx_paragraphs[0])
                if font_size:
                    _merge_inline_style(html_cell, "font-size", font_size)
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
                font_size = _docx_paragraph_font_size(docx_paragraph)
                if color and len(docx_paragraphs) == 1:
                    # A `<td>`'s own `color` attribute is part of the editor's
                    # table-cell schema (`TableCellWithBackground`), so setting
                    # it here survives a round-trip through the editor.
                    _merge_inline_style(html_cell, "color", color)
                    color = None
                if font_size and len(docx_paragraphs) == 1:
                    _merge_inline_style(html_cell, "font-size", font_size)
                    font_size = None
                if color or font_size:
                    _wrap_docx_paragraph_inline_style(
                        html_paragraph, color=color, font_size=font_size
                    )
            if docx_cell.find("./w:tbl", _DOCX_NS) is not None:
                _insert_cover_cell_spacers(
                    soup, html_cell, docx_cell, html_paragraphs, docx_paragraphs
                )

    return split_index


def _normalize_match_text(text: str) -> str:
    return " ".join(text.split())


def _enrich_docx_body_formatting(
    soup: BeautifulSoup,
    document: Any,
    paragraph_styles: dict[str, dict[str, str]],
) -> None:
    """Carry body paragraph/heading alignment and text color into Pandoc HTML.

    Pandoc drops ``w:jc`` (center/right/justify) and direct run ``w:color`` on
    body paragraphs and headings outside tables. Matching each HTML block to
    its source ``<w:p>`` by normalized text in a bounded forward window avoids
    ever drifting out of step when Pandoc drops blank lines or groups lists.
    """
    body = document.find("./w:body", _DOCX_NS)
    if body is None:
        return

    source_paragraphs: list[tuple[str, Any]] = []
    for child in body:
        if child.tag == f"{_W}p":
            text = _normalize_match_text("".join(child.itertext()))
            if text:
                source_paragraphs.append((text, child))

    if not source_paragraphs:
        return

    html_blocks: list[Tag] = []
    for element in soup.find_all(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li"]):
        if element.find_parent("table") is not None:
            continue
        if element.name == "li" and element.find("p", recursive=False) is not None:
            continue
        if element.name == "p" and element.find_parent("li") is not None:
            # Pandoc wraps multi-paragraph list items in `<p>`; style the `<p>`.
            html_blocks.append(element)
            continue
        html_blocks.append(element)

    cursor = 0
    total = len(source_paragraphs)
    for block in html_blocks:
        block_text = _normalize_match_text(block.get_text())
        if not block_text:
            continue
        matched_index: int | None = None
        limit = min(total, cursor + 15)
        for idx in range(cursor, limit):
            src_text = source_paragraphs[idx][0]
            if src_text == block_text or (
                len(block_text) >= 12 and src_text.endswith(block_text)
            ):
                matched_index = idx
                break
        if matched_index is None:
            continue

        docx_paragraph = source_paragraphs[matched_index][1]
        cursor = matched_index + 1

        alignment = _docx_paragraph_alignment(docx_paragraph, paragraph_styles)
        if alignment and alignment != "left":
            _merge_inline_style(block, "text-align", alignment)

        color = _docx_paragraph_color(docx_paragraph)
        # On unshaded body prose, Word's default black `#000000` would break
        # dark-mode readability; only carry non-black explicit text colors.
        if color and color != "#000000":
            _wrap_docx_paragraph_color(block, color)


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
        raw = column.get(f"{_W}w")
        try:
            width = int(raw or "0")
        except ValueError:
            width = 0
        widths.append(width if width > 0 else 0)
    return widths


def _docx_cell_grid_span(cell: Any) -> int:
    span = cell.find("./w:tcPr/w:gridSpan", _DOCX_NS)
    raw = span.get(f"{_W}val") if span is not None else None
    try:
        return max(1, int(raw or "1"))
    except ValueError:
        return 1


def _docx_cell_fill(cell: Any) -> str | None:
    shading = cell.find("./w:tcPr/w:shd", _DOCX_NS)
    fill = shading.get(f"{_W}fill") if shading is not None else None
    if fill and _DOCX_HEX.fullmatch(fill):
        return f"#{fill.lower()}"
    return None


def _apply_docx_cell_style(
    cell: Tag, properties: Any, *, apply_borders: bool = True
) -> None:
    shading = properties.find("./w:shd", _DOCX_NS)
    fill = shading.get(f"{_W}fill") if shading is not None else None
    if fill and _DOCX_HEX.fullmatch(fill):
        _merge_inline_style(cell, "background-color", f"#{fill.lower()}")

    vertical = properties.find("./w:vAlign", _DOCX_NS)
    vertical_value = vertical.get(f"{_W}val") if vertical is not None else None
    css_vertical = {"top": "top", "center": "middle", "bottom": "bottom"}.get(vertical_value or "")
    if css_vertical:
        _merge_inline_style(cell, "vertical-align", css_vertical)

    if apply_borders:
        parsed = _parse_border_container(properties.find("./w:tcBorders", _DOCX_NS))
        side_values = {s: parsed[s] for s in ("top", "right", "bottom", "left") if s in parsed}
        if side_values:
            if len(side_values) == 4 and len(set(side_values.values())) == 1:
                _merge_inline_style(cell, "border", side_values["top"])
            else:
                for side, val in side_values.items():
                    _merge_inline_style(cell, f"border-{side}", val)
        if parsed.get("tl2br") and parsed["tl2br"] != _NO_BORDER_CSS:
            cell["data-diagonal-down"] = parsed["tl2br"]
        if parsed.get("tr2bl") and parsed["tr2bl"] != _NO_BORDER_CSS:
            cell["data-diagonal-up"] = parsed["tr2bl"]


def _map_docx_jc(value: str | None) -> str | None:
    return {
        "start": "left",
        "left": "left",
        "center": "center",
        "end": "right",
        "right": "right",
        "both": "justify",
    }.get(value or "")


def _docx_paragraph_alignment(
    paragraph: Any,
    paragraph_styles: dict[str, dict[str, str]] | None = None,
) -> str | None:
    properties = paragraph.find("./w:pPr", _DOCX_NS)
    alignment = properties.find("./w:jc", _DOCX_NS) if properties is not None else None
    direct = _map_docx_jc(alignment.get(f"{_W}val") if alignment is not None else None)
    if direct:
        return direct
    if paragraph_styles and properties is not None:
        p_style = properties.find("./w:pStyle", _DOCX_NS)
        style_id = p_style.get(f"{_W}val") if p_style is not None else None
        if style_id and style_id in paragraph_styles:
            return paragraph_styles[style_id].get("jc")
    return None


def _docx_paragraph_color(paragraph: Any) -> str | None:
    colors = {
        color.get(f"{_W}val", "").lower()
        for color in paragraph.findall("./w:r/w:rPr/w:color", _DOCX_NS)
    }
    colors.discard("")
    colors.discard("auto")
    if len(colors) == 1 and _DOCX_HEX.fullmatch(next(iter(colors))):
        return f"#{next(iter(colors))}"
    return None


def _docx_paragraph_font_size(paragraph: Any) -> str | None:
    """Return a CSS ``px`` font size when a paragraph uses display-sized type (``>= 14pt``).

    OOXML ``w:sz`` is measured in half-points (``28`` = 14pt, ``37`` = 18.5pt).
    Normal body/table text (10-13pt) is left to WikiHub's theme typography;
    larger display sizes (cover titles, subtitles, document dates) are carried
    through so visual hierarchy survives import.
    """
    sizes: list[int] = []
    for run in paragraph.findall("./w:r", _DOCX_NS):
        if not _docx_run_text(run).strip():
            continue
        sz_el = run.find("./w:rPr/w:sz", _DOCX_NS)
        if sz_el is None:
            continue
        raw = (sz_el.get(f"{_W}val") or "").strip()
        try:
            val = int(raw)
        except ValueError:
            continue
        if val > 0:
            sizes.append(val)
    if not sizes:
        return None
    largest = max(sizes)
    if largest < 28:
        return None
    px = min(48, max(16, round(largest * 2 / 3)))
    return f"{px}px"


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
        value = fonts.get(f"{_W}{attribute}")
        if value:
            return value.strip().lower()
    return None


def _docx_run_text(run: Any) -> str:
    return "".join(node.text or "" for node in run.findall("./w:t", _DOCX_NS))


def _docx_run_color(run: Any) -> str | None:
    properties = run.find("./w:rPr", _DOCX_NS)
    color = properties.find("./w:color", _DOCX_NS) if properties is not None else None
    value = (color.get(f"{_W}val", "") if color is not None else "").lower()
    if value and value != "auto" and _DOCX_HEX.fullmatch(value):
        return f"#{value}"
    return None


def _docx_run_highlight(run: Any) -> str | None:
    properties = run.find("./w:rPr", _DOCX_NS)
    highlight = properties.find("./w:highlight", _DOCX_NS) if properties is not None else None
    value = (highlight.get(f"{_W}val", "") if highlight is not None else "").lower()
    return _OOXML_HIGHLIGHT_HEX.get(value)


def _docx_run_has_flag(run: Any, tag_name: str) -> bool:
    properties = run.find("./w:rPr", _DOCX_NS)
    if properties is None:
        return False
    el = properties.find(f"./w:{tag_name}", _DOCX_NS)
    if el is None:
        return False
    val = (el.get(f"{_W}val") or "").strip().lower()
    return val not in {"0", "false", "none"}


_COLON_DOUBLE_SPACE = re.compile(r":  (?=\S)")


def _docx_paragraph_needs_raw_rebuild(paragraph: Any) -> bool:
    """True where Pandoc's own rendering of this paragraph loses its shape.

    Pandoc treats every Word paragraph as prose: it collapses runs of spaces
    down to one, and drops direct character color entirely (as opposed to a
    named style, which it can carry over). Neither loss is visible on an
    ordinary paragraph, but a paragraph set in a monospace font, or leaning
    on two or more consecutive non-trailing spaces to line up columns, is
    typically a code sample or a box-drawn diagram. Centered or justified
    paragraphs are never column-aligned code/diagrams unless explicitly set
    in a monospace font.
    """
    runs = paragraph.findall("./w:r", _DOCX_NS)
    for run in runs:
        font = _docx_run_font(run)
        if font is not None and font in _MONOSPACE_FONTS:
            return True
    alignment = _docx_paragraph_alignment(paragraph)
    if alignment in {"center", "justify"}:
        return False
    for run in runs:
        cleaned = _COLON_DOUBLE_SPACE.sub(": ", _docx_run_text(run).rstrip(" "))
        if "  " in cleaned:
            return True
    return False


#: A generic-CSS-keyword-terminated stack, so a fixed-width font renders even
#: where none of the named ones are installed.
_PREFORMATTED_FONT_STACK = "ui-monospace, Consolas, Menlo, Monaco, monospace"


def _rebuild_paragraph_from_docx_runs(html_paragraph: Tag, docx_paragraph: Any) -> None:
    """Replace Pandoc's mangled text with a faithful copy of the source runs.

    Every space becomes non-breaking so the columns Pandoc collapsed stay
    put, every run is set in a monospace font so those columns actually line
    up once rendered, and each run's own color, highlight, and emphasis
    (bold/italic/underline/strike) ride along cleanly.
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
        highlight = _docx_run_highlight(run)
        if highlight:
            style += f"; background-color: {highlight}"
        span = factory.new_tag("span", attrs={"style": style})
        node: Any = span
        for flag, tag in (("b", "strong"), ("i", "em"), ("u", "u"), ("strike", "s")):
            if _docx_run_has_flag(run, flag):
                child = factory.new_tag(tag)
                node.append(child)
                node = child
        node.string = text
        html_paragraph.append(span)


def _wrap_docx_paragraph_inline_style(
    paragraph: Tag, *, color: str | None = None, font_size: str | None = None
) -> None:
    """Wrap a paragraph's content in a styled span that Tiptap's TextStyleMark parses."""
    if not paragraph.contents:
        return
    parts: list[str] = []
    if color:
        parts.append(f"color: {color}")
    if font_size:
        parts.append(f"font-size: {font_size}")
    if not parts:
        return
    factory = BeautifulSoup("", "html.parser")
    wrapper = factory.new_tag("span", attrs={"style": "; ".join(parts)})
    for child in list(paragraph.contents):
        child.extract()
        wrapper.append(child)
    paragraph.append(wrapper)


def _wrap_docx_paragraph_color(paragraph: Tag, color: str) -> None:
    """Wrap a paragraph's content in a colored span rather than the paragraph."""
    _wrap_docx_paragraph_inline_style(paragraph, color=color)


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
