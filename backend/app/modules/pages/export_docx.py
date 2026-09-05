"""HTML to Word conversion for page export.

pandoc does the structural conversion (headings, lists, tables, images
already inlined as ``data:`` URIs, and syntax-aware code coloring via its own
skylighting engine, themed from the probed code palette below); a small Lua
filter (``app/assets/wikihub.lua``) maps WikiHub's semantic markup (callouts,
toggle sections) onto named Word styles; this module's ``python-docx``
post-pass then paints those named styles with the page's real,
currently-rendered colors, probed moments earlier by
``export_snapshot.DOCX_CAPTURE_JS``. Nothing here is hand-picked, and nothing
can silently drift from the live theme the way a static template would.

**A real ceiling, not a shortfall of this pipeline**: OOXML has no CSS
gradient, box-shadow, border-radius, flexbox, or grid. A callout that has a
soft rounded corner and a subtle shadow on screen becomes a square shaded
paragraph with a colored left border in Word - faithful in color and
structure, not in geometry. PDF and HTML are pixel-exact; Word is the best
this file format can represent.
"""

from __future__ import annotations

import asyncio
import io
import json
import re
import tempfile
from pathlib import Path
from typing import Any, Final

from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml.parser import OxmlElement
from docx.shared import Pt, RGBColor

from app.core.config import settings
from app.core.exceptions import ServiceUnavailableError
from app.core.logging import get_logger

logger = get_logger(__name__)

_LUA_FILTER: Final = Path(__file__).resolve().parent.parent.parent / "assets" / "wikihub.lua"

_HEX_RE = re.compile(r"^#([0-9a-fA-F]{6})$")
_RGB_RE = re.compile(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)")

#: skylighting/KDE-syntax-highlighting token categories, mapped onto the
#: app's own reduced code-token palette (see globals.css's ".wikihub-code"
#: rules) - one CSS var often covers several of pandoc's finer categories.
_HIGHLIGHT_TOKEN_MAP: Final[dict[str, str]] = {
    "Keyword": "code_keyword",
    "ControlFlow": "code_keyword",
    "Operator": "code_keyword",
    "String": "code_string",
    "VerbatimString": "code_string",
    "SpecialString": "code_string",
    "Char": "code_string",
    "Comment": "code_comment",
    "Documentation": "code_comment",
    "CommentVar": "code_comment",
    "DecVal": "code_number",
    "BaseN": "code_number",
    "Float": "code_number",
    "Constant": "code_number",
    "Function": "code_function",
    "BuiltIn": "code_function",
    "DataType": "code_type",
    "Extension": "code_type",
    "Variable": "code_variable",
    "Attribute": "code_variable",
    "Preprocessor": "code_meta",
    "Import": "code_meta",
    "Annotation": "code_meta",
    "RegionMarker": "code_meta",
    "Information": "code_meta",
    "Warning": "code_meta",
    "Alert": "code_meta",
    "Error": "code_meta",
    "SpecialChar": "code_meta",
    "Others": "code_fg",
}
_ITALIC_TOKENS: Final = {"Comment", "Documentation", "CommentVar"}

#: WikiHub's own font presets (see frontend/lib/font-presets.ts) are all
#: Google web fonts, bundled at build time for the browser - none of them
#: ship with Word. Writing the same name into the document would just have
#: Word silently substitute its own default the moment anyone without that
#: exact font installed opens the file, which in practice is almost every
#: reader. Map each preset to the one font in its category that is actually
#: bundled with every Windows install instead - a sans-serif preset becomes
#: Arial, a serif preset becomes Times New Roman - so the document looks
#: intentional rather than however Word happened to fall back.
_SERIF_FONT_PRESETS: Final = {"lora", "merriweather", "playfair-display"}
_DOCX_BODY_FONT_SANS_SERIF: Final = "Arial"
_DOCX_BODY_FONT_SERIF: Final = "Times New Roman"
#: The one monospace font every Windows install has, matching the code
#: font this same document's syntax-highlight palette is themed for.
_DOCX_MONO_FONT: Final = "Consolas"


def _docx_body_font(font_id: str | None) -> str:
    normalized = (font_id or "").strip().lower()
    return _DOCX_BODY_FONT_SERIF if normalized in _SERIF_FONT_PRESETS else _DOCX_BODY_FONT_SANS_SERIF


def _parse_color(value: str | None) -> str | None:
    """Return a bare 6-digit hex string (no '#'), or ``None`` if unparseable.

    getComputedStyle hands back ``rgb(r, g, b)`` for a resolved style
    property (callout backgrounds/borders) and the raw custom-property string
    - already ``#rrggbb`` in globals.css - for the fixed code palette. Both
    are handled; anything else is left to the reference style's own default
    rather than guessed at.
    """
    if not value:
        return None
    hex_match = _HEX_RE.match(value.strip())
    if hex_match:
        return hex_match.group(1)
    rgb_match = _RGB_RE.match(value.strip())
    if rgb_match:
        r, g, b = (int(x) for x in rgb_match.groups())
        return f"{r:02x}{g:02x}{b:02x}"
    return None


def _build_highlight_theme(theme: dict[str, str]) -> dict[str, Any]:
    """A skylighting theme JSON pandoc's ``--highlight-style`` accepts,
    generated from the probed code palette rather than a static file."""

    def style(key: str, *, italic: bool = False) -> dict[str, Any]:
        color = _parse_color(theme.get(key))
        return {"text-color": f"#{color}" if color else None, "italic": italic}

    text_styles = {
        token: style(css_key, italic=token in _ITALIC_TOKENS)
        for token, css_key in _HIGHLIGHT_TOKEN_MAP.items()
    }
    fg = _parse_color(theme.get("code_fg"))
    bg = _parse_color(theme.get("code_bg"))
    return {
        "text-color": f"#{fg}" if fg else "#eaf2f1",
        "background-color": f"#{bg}" if bg else "#282a3a",
        "line-number-color": f"#{fg}" if fg else "#eaf2f1",
        "line-number-background-color": f"#{bg}" if bg else "#282a3a",
        "text-styles": text_styles,
    }


def _set_paragraph_shading(paragraph: Any, hex_color: str) -> None:
    """python-docx has no high-level API for paragraph shading; ``w:shd`` on
    ``w:pPr`` is the raw OOXML element Word itself uses for it."""
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    paragraph._p.get_or_add_pPr().append(shd)


def _set_paragraph_left_border(paragraph: Any, hex_color: str) -> None:
    borders = OxmlElement("w:pBdr")
    left = OxmlElement("w:left")
    left.set(qn("w:val"), "single")
    left.set(qn("w:sz"), "24")
    left.set(qn("w:space"), "8")
    left.set(qn("w:color"), hex_color)
    borders.append(left)
    paragraph._p.get_or_add_pPr().append(borders)


def _iter_tables(container: Any) -> Any:
    """Every table in ``container.tables``, and every table nested inside
    one of their cells - a table (or a document) exposes the same ``.tables``
    shape in python-docx, so this recurses through it either way."""
    for table in container.tables:
        yield table
        for row in table.rows:
            for cell in row.cells:
                yield from _iter_tables(cell)


def _set_table_borders(table: Any, hex_color: str) -> None:
    """Give a table a plain visible grid, matching what a reader already
    sees on screen.

    Pandoc's own default "Table" style has no border at all - python-docx
    has no high-level API for this either; a raw ``w:tblBorders`` on
    ``w:tblPr`` is the OOXML Word itself writes. "Table Grid" (the built-in
    Word style a person would normally reach for) is not a shortcut here:
    Pandoc's own reference document never defines it, even as a latent
    style, so assigning it by name raises rather than adding a border.
    """
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        element = OxmlElement(f"w:{edge}")
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), "4")
        element.set(qn("w:space"), "0")
        element.set(qn("w:color"), hex_color)
        borders.append(element)
    table_properties = table._tbl.tblPr
    # `tblBorders` has a fixed position in the schema, after `tblW`/`tblInd`
    # and before `shd`/`tblLayout`/`tblCellMar`/`tblLook` - insert before
    # whichever of those already exists, or at the end if none do.
    table_properties.insert_element_before(
        borders, "w:shd", "w:tblLayout", "w:tblCellMar", "w:tblLook"
    )


def _set_run_fonts(rpr: Any, font_name: str) -> None:
    """``font.name`` on python-docx's high-level API only ever writes
    ``w:rFonts/@w:ascii`` - Word resolves the actual glyph for anything
    outside Basic Latin (Vietnamese included) from ``@w:eastAsia``/``@w:cs``
    instead, which is what silently keeps rendering in a leftover fallback
    font without this."""
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    for attribute in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        rfonts.set(qn(attribute), font_name)


def _set_document_font(document: Any, *, body_font: str, mono_font: str) -> None:
    """Word-safe fonts for body and code text (see the preset map above).

    "Normal" covers ordinary paragraphs; "Verbatim Char" is the one
    character style Pandoc's docx writer uses for *all* code text, inline
    and block alike, so setting it here covers both at once.
    """
    normal = document.styles["Normal"]
    normal.font.name = body_font
    _set_run_fonts(normal.element.get_or_add_rPr(), body_font)

    verbatim = _get_or_add_style(document, "Verbatim Char")
    verbatim.font.name = mono_font
    _set_run_fonts(verbatim.element.get_or_add_rPr(), mono_font)


def _get_or_add_style(document: Any, name: str) -> Any:
    """pandoc's docx writer auto-creates any ``custom-style`` it sees that
    isn't already in the document, so the style this function's caller wants
    to paint may already exist by the time python-docx opens the file - reuse
    it rather than raise trying to add a duplicate."""
    try:
        return document.styles[name]
    except KeyError:
        return document.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)


def _apply_named_styles(document: Any, theme: dict[str, str]) -> None:
    callouts = {
        "WikiHub Callout Info": ("callout_info_bg", "callout_info_border"),
        "WikiHub Callout Warning": ("callout_warning_bg", "callout_warning_border"),
        "WikiHub Callout Note": ("callout_note_bg", "callout_note_border"),
        "WikiHub Callout Panel": ("callout_panel_bg", "callout_panel_border"),
    }
    fg = _parse_color(theme.get("foreground"))
    for name in callouts:
        style = _get_or_add_style(document, name)
        style.paragraph_format.space_before = Pt(6)
        style.paragraph_format.space_after = Pt(6)
        style.paragraph_format.left_indent = Pt(8)
        if fg:
            style.font.color.rgb = RGBColor.from_string(fg)
        # Word has no "default paragraph shading/border" on a *style* via the
        # high-level API either; both live on every paragraph using the
        # style instead, applied below.

    toggle_summary = _get_or_add_style(document, "WikiHub Toggle Summary")
    toggle_summary.font.bold = True

    toggle_body = _get_or_add_style(document, "WikiHub Toggle Body")
    toggle_body.paragraph_format.left_indent = Pt(18)

    # pandoc's own docx writer shades "Source Code" from the skylighting
    # theme's background-color (see _build_highlight_theme), but it leaves
    # the style's spacing untouched - text sits flush against the shaded
    # box's edges on every side. Give it the same breathing room the
    # callouts above already get.
    code_style = _get_or_add_style(document, "Source Code")
    code_style.paragraph_format.space_before = Pt(8)
    code_style.paragraph_format.space_after = Pt(8)
    code_style.paragraph_format.left_indent = Pt(10)
    code_style.paragraph_format.right_indent = Pt(10)

    for paragraph in document.paragraphs:
        if paragraph.style.name in callouts:
            bg_key, border_key = callouts[paragraph.style.name]
            bg = _parse_color(theme.get(bg_key))
            border = _parse_color(theme.get(border_key)) or _parse_color(theme.get("border"))
            if bg:
                _set_paragraph_shading(paragraph, bg)
            if border:
                _set_paragraph_left_border(paragraph, border)

    # Pandoc's own default "Table" style paints no border at all - every
    # table a reader sees on screen has one, so leaving Pandoc's default in
    # place is the one place this export reads as unfinished rather than as
    # a faithful copy of the live page.
    table_border = _parse_color(theme.get("border")) or "999999"
    for table in _iter_tables(document):
        _set_table_borders(table, table_border)


def _append_field(paragraph: Any, instruction: str) -> None:
    """Insert a live Word field (``{ PAGE }``, ``{ NUMPAGES }``) as three
    runs - python-docx has no high-level API for fields, so this is the raw
    OOXML sequence Word itself writes: a field-char run to open it, an
    instruction-text run naming it, and a field-char run to close it. Word
    computes the actual number itself whenever the document is opened,
    paginated, or printed - nothing here is a fixed value that could drift.
    """
    begin = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    begin._r.append(fld_begin)

    instr_run = paragraph.add_run()
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = f" {instruction} "
    instr_run._r.append(instr)

    end = paragraph.add_run()
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    end._r.append(fld_end)


def _add_page_number_footer(document: Any) -> None:
    """Center a "<page> / <total>" footer, matching the PDF export's own
    page-number footer."""
    section = document.sections[0]
    section.footer.is_linked_to_previous = False
    paragraph = (
        section.footer.paragraphs[0]
        if section.footer.paragraphs
        else section.footer.add_paragraph()
    )
    paragraph.text = ""
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _append_field(paragraph, "PAGE")
    paragraph.add_run(" / ")
    _append_field(paragraph, "NUMPAGES")
    for run in paragraph.runs:
        run.font.size = Pt(8)


async def html_to_docx(
    html: str, theme: dict[str, str], *, title: str, font_id: str | None = None
) -> bytes:
    """Convert a simplified, semantically-marked-up HTML fragment to a
    ``.docx``, themed from ``theme`` (see ``DOCX_CAPTURE_JS``).

    ``font_id`` is the space's (or, failing that, the site's) font preset id
    - a name from frontend/lib/font-presets.ts, the same knob the live page
    reads. It is resolved to a Word-safe font by name rather than by reusing
    ``theme``'s browser-probed ``font_page``: that value is a full CSS
    fallback stack (``"Inter, -apple-system, ..."``), not a single font name
    ``w:rFonts`` could use, and its first entry is a web font Word does not
    have anyway. See ``_docx_body_font``.
    """
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        highlight_theme_path = tmp_path / "highlight.theme"
        output_path = tmp_path / "output.docx"

        highlight_theme_path.write_text(
            json.dumps(_build_highlight_theme(theme)), encoding="utf-8"
        )

        args = [
            settings.pandoc_binary,
            "--from=html+native_divs+native_spans",
            "--to=docx",
            f"--lua-filter={_LUA_FILTER}",
            f"--highlight-style={highlight_theme_path}",
            "--metadata",
            f"title={title}",
            "--standalone",
            "-o",
            str(output_path),
        ]
        try:
            process = await asyncio.create_subprocess_exec(
                *args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _stdout, stderr = await asyncio.wait_for(
                process.communicate(html.encode("utf-8")),
                timeout=settings.export_render_timeout_seconds,
            )
        except TimeoutError as exc:
            raise ServiceUnavailableError(
                "Converting the page to Word timed out. Please try again."
            ) from exc
        except OSError as exc:
            raise ServiceUnavailableError(
                "Word export is not available on this server."
            ) from exc

        if process.returncode != 0 or not output_path.exists():
            logger.error(
                "docx_conversion_failed",
                returncode=process.returncode,
                stderr=stderr.decode("utf-8", errors="replace")[:2000],
            )
            raise ServiceUnavailableError(
                "Converting the page to Word failed. Please try again."
            )

        document = Document(str(output_path))
        _apply_named_styles(document, theme)
        _set_document_font(document, body_font=_docx_body_font(font_id), mono_font=_DOCX_MONO_FONT)
        _add_page_number_footer(document)

        result_stream = io.BytesIO()
        document.save(result_stream)
        return result_stream.getvalue()
