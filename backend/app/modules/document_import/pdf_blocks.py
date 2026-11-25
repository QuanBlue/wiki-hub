"""PDF font/style inference, special regions, list/line assembly, and media blocks."""

from __future__ import annotations

import hashlib
import html as html_module
import re
from collections import Counter
from typing import TYPE_CHECKING, Any

from app.core.config import settings

if TYPE_CHECKING:
    from app.modules.document_import.convert import ExtractedMedia


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
        fills.append((rect, (float(fill[0]), float(fill[1]), float(fill[2]))))

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
        key = (
            round(float(rect[0]), 1),
            round(float(rect[1]), 1),
            round(float(rect[2]), 1),
            round(float(rect[3]), 1),
            kind,
        )
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
    r"^\s*(?:[\u2022\u25aa\u25ab\u25e6\uf02b\uf0b7]|o|[-\u2013])\s+(?P<body>.+)$"
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
            *(line.get("bbox") or (0.0, 0.0, 0.0, 0.0) for line in kept),
            strict=False,
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
) -> tuple[
    str | None, list[dict[str, Any]], list[tuple[int, str]], str | None, list[dict[str, Any]]
]:
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
        line_html = _pdf_inline_html(
            {"lines": [line]}, body_size, font_styles, underline_rects
        ).strip()
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
            # `text_blocks` only holds blocks with a bbox (see
            # `_pdf_region_for_block`), so this fallback always resolves.
            line_bbox = line.get("bbox") or block["bbox"]
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
    # Only `code` regions reach here: `callout` returned above, and
    # `_pdf_special_regions` emits no other kind.
    #
    # A PDF has no literal indentation characters - a nested line is simply
    # text placed further right, in units of a monospace character's width.
    # Reconstruct that as real leading spaces, measured from this block's own
    # least-indented line (its column zero) - otherwise every line comes out
    # flush-left the moment it is no longer sitting inside its own bordered,
    # backgrounded region.
    left_edge = min(x for _y, items in ordered_lines for x, _text in items)
    char_width = (sum(sizes) / len(sizes) if sizes else 9.0) * 0.6
    code_lines = [
        " " * max(0, round((min(x for x, _t in items) - left_edge) / char_width))
        + "".join(text for _x, text in sorted(items))
        for _y, items in ordered_lines
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
    from app.modules.document_import import convert as _convert

    data = block.get("image")
    if not data:
        return None, total_bytes

    bbox = block.get("bbox") or (0, 0, 0, 0)
    width, height = bbox[2] - bbox[0], bbox[3] - bbox[1]
    if width < _MIN_PDF_IMAGE_EDGE or height < _MIN_PDF_IMAGE_EDGE:
        return None, total_bytes
    if len(data) < _MIN_PDF_IMAGE_BYTES:
        return None, total_bytes

    extension = str(block.get("ext") or "png").lower()
    mask = block.get("mask")
    if mask:
        # PyMuPDF reports a soft-masked image's transparency separately from
        # its color data and never combines the two - a fully transparent
        # pixel keeps whatever color happened to be stored underneath it,
        # which is opaque and, in practice, usually black. Left alone, that
        # is a solid black fill exactly where the source image had nothing.
        combined = _apply_pdf_soft_mask(data, mask, image_decoder=image_decoder)
        if combined is not None:
            data, extension = combined, "png"

    if width <= 120 and height <= 100 and _convert._pdf_is_decorative_card(data, image_decoder):
        return None, total_bytes

    # A logo in the header of every page is one image, not forty.
    digest = hashlib.sha256(data).hexdigest()
    if digest in seen:
        return None, total_bytes
    seen.add(digest)

    if len(media) >= settings.document_import_max_media_count:
        raise _convert.DocumentTooComplexError(
            f"This PDF contains more than {settings.document_import_max_media_count} images."
        )
    total_bytes += len(data)
    if total_bytes > settings.document_import_max_media_bytes:
        raise _convert.DocumentTooComplexError(
            "The images in this PDF exceed what WikiHub will unpack."
        )

    token = _convert.new_media_token()
    media.append(
        _convert.ExtractedMedia(
            token=token,
            filename=f"image-{len(media) + 1}.{extension}",
            data=bytes(data),
            content_type=_convert._guess_image_type(f"x.{extension}"),
        )
    )
    return f'<p><img src="{token}" alt=""/></p>', total_bytes


def _apply_pdf_soft_mask(data: bytes, mask: bytes, *, image_decoder: Any) -> bytes | None:
    """Recombine a PDF image with the transparency PyMuPDF reports separately.

    `page.get_text("dict")` hands back a soft-masked image's color data and
    its mask as two same-size images and never composites them - this is
    PyMuPDF's own documented way to do that itself: build a Pixmap from
    each, then build a third Pixmap from the color one with the mask one as
    its alpha channel. Returns None (falling back to the plain, opaque
    image) if the two turn out not to actually match up - different sizes
    or colorspaces than PyMuPDF's own soft-mask contract promises, which
    would otherwise raise past the caller into a failed import over a
    fidelity enhancement that was never guaranteed to apply. Caught broadly,
    on purpose: PyMuPDF surfaces a malformed image through its own MuPDF
    binding's exception types, not Python's built-in ones.
    """
    try:
        color = image_decoder.Pixmap(data)
        alpha = image_decoder.Pixmap(mask)
        return image_decoder.Pixmap(color, alpha).tobytes("png")
    except Exception:  # noqa: BLE001 - a fidelity enhancement, never fatal
        return None


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
            for (value, font, size, _color, _bbox), style in zip(
                raw_spans, span_styles, strict=False
            )
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
            non_body_size = (
                not style.get("bold")
                and body_size > 0
                and abs(size - body_size) / body_size > 0.08
            )
            if color or non_body_size:
                red, green, blue = (color >> 16 & 255, color >> 8 & 255, color & 255)
                declarations = []
                if color:
                    declarations.append(f"color:#{red:02x}{green:02x}{blue:02x}")
                if non_body_size:
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
    from app.modules.document_import import convert as _convert

    for index, page in enumerate(document):
        if index >= _convert._PDF_FONT_SAMPLE_PAGES:
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
