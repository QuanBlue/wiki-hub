"""PDF document extraction entrypoint using PyMuPDF."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

import anyio.to_thread

from app.core.config import settings
from app.core.exceptions import BadRequestError
from app.modules.document_import.pdf_blocks import (
    _append_pdf_list_continuation,
    _flush_pdf_list,
    _lines_heading_level,
    _modal_font_size,
    _pdf_block_list_parts,
    _pdf_block_numbered_paragraphs,
    _pdf_font_styles,
    _pdf_image_block,
    _pdf_is_list_continuation,
    _pdf_is_page_number,
    _pdf_list_marker_level,
    _pdf_metadata_title,
    _pdf_region_for_block,
    _pdf_special_regions,
    _pdf_strip_watermark_lines,
    _pdf_text_block,
    _pdf_text_list_parts,
    _pdf_underline_rects,
    _render_pdf_region,
)
from app.modules.document_import.pdf_tables import (
    _merge_pdf_table_continuation,
    _pdf_block_outside_tables,
    _pdf_table_column_count,
    _pdf_table_header_rows_html,
    _pdf_table_shares_margins,
    _pdf_tables,
    _render_pdf_table,
)

if TYPE_CHECKING:
    from app.modules.document_import.convert import ExtractedDocument, ExtractedMedia


async def extract_pdf(source: Path) -> ExtractedDocument:
    """PyMuPDF is blocking and CPU-bound, so it runs off the event loop."""
    return await anyio.to_thread.run_sync(_extract_pdf_sync, source)


def _extract_pdf_sync(source: Path) -> ExtractedDocument:
    import pymupdf  # imported here so the module stays importable without it

    from app.modules.document_import import convert as _convert

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
            raise _convert.DocumentTooComplexError(
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

        for page in document:  # type: ignore[attr-defined]
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
                table_index = _convert._pdf_table_for_block(block, tables)
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
                        if merged_html is not None and pending_continuation is not None:
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

    return _convert.ExtractedDocument(
        html="".join(parts),
        media=media,
        metadata_title=title,
        warnings=warnings,
    )

