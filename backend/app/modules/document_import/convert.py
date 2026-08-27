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
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

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

        body_size = _modal_font_size(document)
        parts: list[str] = []
        media: list[ExtractedMedia] = []
        seen_images: set[str] = set()
        total_bytes = 0
        text_blocks = 0

        for page in document:
            # `sort=True` gives blocks in reading order, and image blocks arrive
            # interleaved with text - which is what places a figure where it
            # actually belongs instead of dumping every image at the end.
            for block in page.get_text("dict", sort=True).get("blocks", []):
                if block.get("type") == 1:
                    rendered, total_bytes = _pdf_image_block(
                        block, media, seen_images, total_bytes
                    )
                    if rendered:
                        parts.append(rendered)
                    continue
                rendered_text = _pdf_text_block(block, body_size)
                if rendered_text:
                    text_blocks += 1
                    parts.append(rendered_text)

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


def _pdf_image_block(
    block: dict[str, Any],
    media: list[ExtractedMedia],
    seen: set[str],
    total_bytes: int,
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


def _pdf_text_block(block: dict[str, Any], body_size: float) -> str | None:
    text, size, bold = _join_block_lines(block)
    if not text:
        return None
    escaped = html_module.escape(text)
    level = _heading_level(size, bold, body_size)
    if level is None:
        return f"<p>{escaped}</p>"
    return f"<h{level}>{escaped}</h{level}>"


def _join_block_lines(block: dict[str, Any]) -> tuple[str, float, bool]:
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
            if int(span.get("flags", 0)) & _PDF_BOLD_FLAG:
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


def _modal_font_size(document: Any) -> float:
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
                for span in line.get("spans", []):
                    text = str(span.get("text", "")).strip()
                    if text:
                        counter[round(float(span.get("size", 0.0)), 1)] += len(text)
    if not counter:
        return 0.0
    return counter.most_common(1)[0][0]


def _pdf_metadata_title(document: Any) -> str | None:
    metadata = getattr(document, "metadata", None) or {}
    title = str(metadata.get("title") or "").strip()
    return title or None
