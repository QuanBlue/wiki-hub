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
import mimetypes
import re
import urllib.parse
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import anyio.to_thread
from bs4 import BeautifulSoup, Tag

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
    # Spreadsheets are read by `spreadsheet.py`, not pandoc. `.xlsm` is left
    # out for the same reason as `.docm`.
    "xlsx": "xlsx",
    "csv": "csv",
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
    #: ``(title, html)`` for a document that is several pages rather than one -
    #: a workbook with several sheets. When set, the file's own page holds an
    #: index of them and each becomes a child page of it; see ``jobs.py``.
    sections: list[tuple[str, str]] = field(default_factory=list)


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
    if doc_format in {"xlsx", "csv"}:
        # Imported here: `spreadsheet.py` builds on this module's types.
        from app.modules.document_import.spreadsheet import extract_spreadsheet

        return await anyio.to_thread.run_sync(
            lambda: extract_spreadsheet(source, doc_format=doc_format)
        )
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
    # An HTML upload gets a cleaned-up copy fed to Pandoc instead of the
    # original - see `_prepare_html_source_for_pandoc` for why this has to
    # happen *before* conversion rather than after.
    pandoc_source = (
        _prepare_html_source_for_pandoc(source, workdir) if doc_format == "html" else source
    )
    args = build_pandoc_args(pandoc_source, doc_format=doc_format, workdir=workdir)

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
        # The cleaned copy, not the original: `_preserve_html_table_formatting`
        # matches its own source parse against Pandoc's output element for
        # element, in order, and Pandoc converted the cleaned copy - a list
        # Word wrote as ten flat paragraphs is one `<ul>` with ten `<li>` in
        # both by now, but only because both sides agree on which document
        # they are describing.
        html = _preserve_html_table_formatting(pandoc_source, html)
    return _collect_pandoc_media(html, workdir=workdir, doc_format=doc_format)



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
# Re-exported sibling helpers (preserved for callers and unit tests)
# --------------------------------------------------------------------------

from app.modules.document_import.docx_formatting import (  # noqa: E402, F401
    _DOCX_HEX,
    _DOCX_NS,
    _MONOSPACE_FONTS,
    _PREFORMATTED_FONT_STACK,
    _apply_docx_cell_style,
    _direct_html_table_rows,
    _docx_cell_grid_span,
    _docx_paragraph_alignment,
    _docx_paragraph_color,
    _docx_paragraph_needs_raw_rebuild,
    _docx_run_color,
    _docx_run_font,
    _docx_run_text,
    _docx_table_column_widths,
    _enrich_docx_table_formatting,
    _merge_inline_style,
    _rebuild_paragraph_from_docx_runs,
    _wrap_docx_paragraph_color,
)
from app.modules.document_import.html_formatting import (  # noqa: E402, F401
    _FORMATTED_BLOCK_TAGS,
    _HTML_FORMATTING_PROPERTIES,
    _INLINE_STYLE_PROPERTIES,
    _LIST_INHERITED_STYLE_PROPERTIES,
    _META_CHARSET_RE,
    _MSO_LIST_IGNORE,
    _MSO_LIST_LEVEL,
    _ORDERED_LIST_MARKER,
    MAX_HTML_STYLE_ENRICHMENT_BYTES,
    _apply_html_text_marks,
    _apply_safe_html_styles,
    _block_style,
    _blocks_outside_tables,
    _copy_safe_style,
    _copy_style_declarations,
    _css_specificity,
    _defoster_stray_table_children,
    _extract_mso_list_marker,
    _mso_list_level,
    _prepare_html_source_for_pandoc,
    _preserve_html_block_formatting,
    _preserve_html_table_formatting,
    _read_html_source,
    _reconstruct_mso_lists,
    _repair_html_table_grid,
    _replace_with_nested_list,
    _safe_css_declarations,
    _table_cell_span,
    _wrap_inline_text_style,
)
from app.modules.document_import.pdf_blocks import (  # noqa: E402, F401
    _H1_RATIO,
    _H2_RATIO,
    _H3_RATIO,
    _MIN_PDF_IMAGE_BYTES,
    _MIN_PDF_IMAGE_EDGE,
    _PDF_BOLD_FLAG,
    _PDF_CALLOUT_FILL,
    _PDF_CODE_MAX_CHANNEL,
    _PDF_FONT_SAMPLE_PAGES,
    _PDF_LIST_LINE,
    _PDF_NUMBERED_PARAGRAPH_LINE,
    _append_pdf_list_continuation,
    _apply_pdf_soft_mask,
    _flush_pdf_list,
    _heading_level,
    _is_close_rgb,
    _join_block_lines,
    _lines_heading_level,
    _merge_pdf_fill_runs,
    _modal_font_size,
    _normalise_pdf_language,
    _pdf_block_list_parts,
    _pdf_block_numbered_paragraphs,
    _pdf_block_plain_text,
    _pdf_font_styles,
    _pdf_image_block,
    _pdf_inline_html,
    _pdf_is_decorative_card,
    _pdf_is_list_continuation,
    _pdf_is_page_number,
    _pdf_line_is_horizontal,
    _pdf_line_text,
    _pdf_list_marker_level,
    _pdf_metadata_title,
    _pdf_region_for_block,
    _pdf_span_is_underlined,
    _pdf_span_style,
    _pdf_special_regions,
    _pdf_strip_line_prefix,
    _pdf_strip_watermark_lines,
    _pdf_text_block,
    _pdf_text_list_parts,
    _pdf_underline_rects,
    _pdf_visual_lines,
    _register_pdf_indent,
    _render_pdf_list,
    _render_pdf_region,
    _wrap_pdf_marks,
)
from app.modules.document_import.pdf_extract import (  # noqa: E402, F401
    _extract_pdf_sync,
    extract_pdf,
)
from app.modules.document_import.pdf_tables import (  # noqa: E402, F401
    _merge_pdf_table_continuation,
    _pdf_band_text_color,
    _pdf_block_outside_tables,
    _pdf_clean_table_cell_text,
    _pdf_header_row_matches,
    _pdf_line_in_tables,
    _pdf_rect_in_regions,
    _pdf_table_carry_rowspans,
    _pdf_table_column_count,
    _pdf_table_extend_open_rowspans,
    _pdf_table_for_block,
    _pdf_table_header_paint,
    _pdf_table_header_rows_html,
    _pdf_table_html,
    _pdf_table_shares_margins,
    _pdf_tables,
    _render_pdf_table,
)
