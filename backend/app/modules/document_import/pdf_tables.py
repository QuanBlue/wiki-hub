"""PDF table detection, HTML rendering, and cross-page continuation merging."""

from __future__ import annotations

from collections import Counter
from typing import Any

from bs4 import BeautifulSoup, Tag

from app.modules.document_import.html_formatting import _table_cell_span
from app.modules.document_import.pdf_blocks import (
    _pdf_line_is_horizontal,
    _pdf_line_text,
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
    xs0, ys0, xs1, ys1 = zip(
        *(line.get("bbox") or (0.0, 0.0, 0.0, 0.0) for line in kept), strict=False
    )
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
    if not isinstance(table, Tag):
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
    first_row = table.find("tr") if isinstance(table, Tag) else None
    if not isinstance(first_row, Tag):
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
    if not isinstance(table, Tag):
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
    a_cells = [
        c.get_text(" ", strip=True).casefold() for c in a.find_all(["th", "td"], recursive=False)
    ]
    b_cells = [
        c.get_text(" ", strip=True).casefold() for c in b.find_all(["th", "td"], recursive=False)
    ]
    if not a_cells or len(a_cells) != len(b_cells):
        return False
    return all(
        x == y or (x and y and (x in y or y in x)) for x, y in zip(a_cells, b_cells, strict=False)
    )


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
        if drop < len(new_header_rows) and _pdf_header_row_matches(
            header_row, new_header_rows[drop]
        ):
            drop += 1
        else:
            break
    if drop == 0 and not (strict_margins and pending_header_rows):
        return None
    pending_soup = BeautifulSoup(pending_html, "html.parser")
    pending_table = pending_soup.find("table")
    new_soup = BeautifulSoup(new_html, "html.parser")
    new_table = new_soup.find("table")
    if not isinstance(pending_table, Tag) or not isinstance(new_table, Tag):
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

