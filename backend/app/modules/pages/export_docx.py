"""HTML to Word conversion for page export.

pandoc does the structural conversion (headings, lists, tables, images
already inlined as ``data:`` URIs, and syntax-aware code coloring via its own
skylighting engine, themed from the probed code palette below); a small Lua
filter (``app/assets/wikihub.lua``) maps WikiHub's semantic markup (callouts,
toggle sections) onto named Word styles; this module's ``python-docx``
post-pass then paints those named styles with the page's real,
currently-rendered colors, probed moments earlier by
``export_snapshot.DOCX_CAPTURE_JS``. Nothing here is hand-picked, and nothing
can silently drift from the live theme the way a static template would. The
same post-pass also turns export_content.py's plain-text TOC marker into a
real, native Word "Table of Contents" field (see
``_insert_native_toc_fields``) - unlike PDF/HTML, Word has its own
updatable mechanism for one, so it gets that instead of a hand-rolled list
of hyperlinks.

**A real ceiling, not a shortfall of this pipeline**: OOXML has no CSS
gradient, box-shadow, border-radius, flexbox, or grid. A callout that has a
soft rounded corner and a subtle shadow on screen becomes a square shaded
paragraph with a colored left border in Word - faithful in color and
structure, not in geometry. PDF and HTML are pixel-exact; Word is the best
this file format can represent.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import io
import json
import re
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any, Final

from bs4 import BeautifulSoup, Tag
from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml.parser import OxmlElement
from docx.shared import Cm, Pt, RGBColor

from app.core.config import settings
from app.core.exceptions import ServiceUnavailableError
from app.core.logging import get_logger
from app.modules.pages.export_content import WORD_TOC_FIELD_MARKER

logger = get_logger(__name__)

_LUA_FILTER: Final = Path(__file__).resolve().parent.parent.parent / "assets" / "wikihub.lua"

_HEX_RE = re.compile(r"^#([0-9a-fA-F]{6})$")
_HEX3_RE = re.compile(r"^#([0-9a-fA-F]{3})$")
_RGB_RE = re.compile(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)")
_OKLAB_RE = re.compile(
    r"^oklab\(\s*([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)"
    r"(?:\s*/\s*([+-]?\d*\.?\d+%?))?\s*\)$"
)
_NAMED_COLORS: Final[dict[str, str]] = {
    "black": "000000",
    "white": "ffffff",
    "red": "dc2626",
    "blue": "2563eb",
    "green": "16a34a",
    "gray": "6b7280",
    "grey": "6b7280",
    "yellow": "eab308",
    "orange": "ea580c",
    "purple": "9333ea",
}
_STYLE_DECLARATION_RE = re.compile(r"([a-zA-Z-]+)\s*:\s*([^;]+)")
_PERCENT_RE = re.compile(r"^(\d+(?:\.\d+)?)\s*%$")
_PX_RE = re.compile(r"^(\d+(?:\.\d+)?)\s*px$", re.IGNORECASE)
_PAGE_WIDTH_CM: Final = 21.0
_PAGE_HEIGHT_CM: Final = 29.7
_PAGE_MARGIN_CM: Final = 2.0
_CONTENT_WIDTH_TWIPS: Final = 9638
_MAX_IMAGE_WIDTH_CM: Final = 16.5
_MAX_IMAGE_HEIGHT_CM: Final = 23.0
_WH_ALIGN_STYLE_MAP: Final[dict[str, WD_ALIGN_PARAGRAPH]] = {
    "WH Align Center": WD_ALIGN_PARAGRAPH.CENTER,
    "WH Align Right": WD_ALIGN_PARAGRAPH.RIGHT,
    "WH Align Justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
}
_CSS_TEXT_ALIGN_TO_STYLE: Final[dict[str, str]] = {
    "center": "WH Align Center",
    "right": "WH Align Right",
    "justify": "WH Align Justify",
}
_CSS_TEXT_ALIGN_TO_JC: Final[dict[str, str]] = {
    "left": "left",
    "center": "center",
    "right": "right",
    "justify": "both",
}
_CSS_VALIGN_TO_OOXML: Final[dict[str, str]] = {
    "top": "top",
    "middle": "center",
    "bottom": "bottom",
}
_HEADING_SPECS: Final[dict[str, tuple[float, float, float]]] = {
    "Heading 1": (16.0, 16.0, 6.0),
    "Heading 2": (13.5, 13.0, 5.0),
    "Heading 3": (11.5, 10.0, 4.0),
    "Heading 4": (10.5, 8.0, 3.0),
    "Heading 5": (10.0, 6.0, 3.0),
    "Heading 6": (10.0, 6.0, 3.0),
}
_BODY_SPACING_STYLES: Final = (
    "Normal",
    "Body Text",
    "First Paragraph",
    "Compact",
    "Block Text",
)
_DATA_IMAGE_SRC_RE = re.compile(
    r'(<img\b[^>]*?\bsrc=["\'])(data:image/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+))(["\'])',
    re.IGNORECASE,
)
_DATA_ANCHOR_HREF_RE = re.compile(
    r'(<a\b[^>]*?)\s+\bhref=["\']data:[^"\']*["\']',
    re.IGNORECASE,
)

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
_SERIF_FONT_PRESETS: Final = {
    "lora",
    "merriweather",
    "playfair-display",
    "source-serif-4",
    "noto-serif",
    "pt-serif",
    "crimson-pro",
}
_DOCX_BODY_FONT_SANS_SERIF: Final = "Arial"
_DOCX_BODY_FONT_SERIF: Final = "Times New Roman"
#: The one monospace font every Windows install has, matching the code
#: font this same document's syntax-highlight palette is themed for.
_DOCX_MONO_FONT: Final = "Consolas"


def _docx_body_font(font_id: str | None) -> str:
    normalized = (font_id or "").strip().lower()
    return (
        _DOCX_BODY_FONT_SERIF
        if normalized in _SERIF_FONT_PRESETS
        else _DOCX_BODY_FONT_SANS_SERIF
    )


def _oklab_to_hex(lightness: float, a_axis: float, b_axis: float, alpha: float = 1.0) -> str:
    """Convert an CSS Color 4 ``oklab(L a b / alpha)`` value to a 6-digit hex
    string, composited over a white (``#ffffff``) document surface when
    semi-transparent."""
    l_ = lightness + 0.3963377774 * a_axis + 0.2158037573 * b_axis
    m_ = lightness - 0.1055613458 * a_axis - 0.0638541728 * b_axis
    s_ = lightness - 0.0894841775 * a_axis - 1.2914855480 * b_axis

    l_cubed = l_ * l_ * l_
    m_cubed = m_ * m_ * m_
    s_cubed = s_ * s_ * s_

    r_lin = +4.0767416621 * l_cubed - 3.3077115913 * m_cubed + 0.2309699292 * s_cubed
    g_lin = -1.2684380046 * l_cubed + 2.6097574011 * m_cubed - 0.3413193965 * s_cubed
    b_lin = -0.0041960863 * l_cubed - 0.7034186147 * m_cubed + 1.7076147010 * s_cubed

    def to_srgb_byte(channel: float) -> int:
        clamped = min(max(channel, 0.0), 1.0)
        srgb = (
            12.92 * clamped
            if clamped <= 0.0031308
            else 1.055 * (clamped ** (1.0 / 2.4)) - 0.055
        )
        a_clamped = min(max(alpha, 0.0), 1.0)
        blended = srgb * a_clamped + 1.0 * (1.0 - a_clamped)
        return min(max(round(blended * 255), 0), 255)

    return f"{to_srgb_byte(r_lin):02x}{to_srgb_byte(g_lin):02x}{to_srgb_byte(b_lin):02x}"


def _parse_color(value: str | None) -> str | None:
    """Return a bare 6-digit hex string (no '#'), or ``None`` if unparseable.

    getComputedStyle hands back ``rgb(r, g, b)`` or ``oklab(...)`` for a
    resolved style property (callout backgrounds/borders) and the raw
    custom-property string - already ``#rrggbb`` in globals.css - for the fixed
    code palette. All are handled; anything else is left to the reference
    style's own default rather than guessed at.
    """
    if not value:
        return None
    stripped = value.strip()
    hex_match = _HEX_RE.match(stripped)
    if hex_match:
        return hex_match.group(1)
    hex3_match = _HEX3_RE.match(stripped)
    if hex3_match:
        short = hex3_match.group(1)
        return f"{short[0] * 2}{short[1] * 2}{short[2] * 2}"
    named = _NAMED_COLORS.get(stripped.lower())
    if named:
        return named
    rgb_match = _RGB_RE.match(stripped)
    if rgb_match:
        r, g, b = (int(x) for x in rgb_match.groups())
        return f"{r:02x}{g:02x}{b:02x}"
    oklab_match = _OKLAB_RE.match(stripped)
    if oklab_match:
        l_val, a_val, b_val, alpha_raw = oklab_match.groups()
        alpha = 1.0
        if alpha_raw:
            alpha = (
                float(alpha_raw[:-1]) / 100.0
                if alpha_raw.endswith("%")
                else float(alpha_raw)
            )
        return _oklab_to_hex(float(l_val), float(a_val), float(b_val), alpha)
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
        element.set(qn("w:sz"), "6")
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


def _set_tc_shading(tc: Any, hex_color: str) -> None:
    """Write ``w:shd`` on ``w:tcPr``, replacing any existing shading."""
    tc_pr = tc.get_or_add_tcPr()
    existing = tc_pr.find(qn("w:shd"))
    if existing is not None:
        tc_pr.remove(existing)
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tc_pr.append(shd)


def _set_cell_shading(cell: Any, hex_color: str) -> None:
    """python-docx has no high-level API for cell shading either; ``w:shd``
    on ``w:tcPr`` is the raw OOXML element Word itself uses for it (the same
    element ``_set_paragraph_shading`` above writes onto ``w:pPr`` instead,
    for a callout)."""
    _set_tc_shading(cell._tc, hex_color)


def _is_header_row(row: Any) -> bool:
    """Pandoc marks a header row it produced from ``<th>``/``<thead>`` with
    ``w:tblHeader`` on ``w:trPr`` (so Word can repeat it on every printed
    page) - the one place that survives the HTML-to-docx conversion telling
    a header row apart from an ordinary one."""
    tr_pr = row._tr.trPr
    return tr_pr is not None and tr_pr.find(qn("w:tblHeader")) is not None


def _apply_table_header_formatting(document: Any, theme: dict[str, str]) -> None:
    """Bold and shade a table's header row to match how a reader already
    sees it on screen (``readerClassName``'s
    ``[&_th]:bg-surface-sunken [&_th]:font-semibold`` in
    rich-text-editor.tsx). Pandoc's own default "Table" style paints a
    header row exactly like every other row - the row is marked
    (see ``_is_header_row``), just never painted. Preserves any explicit
    cell shading already applied from HTML inline styles.
    """
    header_bg = _parse_color(theme.get("table_header_bg")) or "f0f0f0"
    for table in _iter_tables(document):
        for row in table.rows:
            if not _is_header_row(row):
                continue
            for cell in row.cells:
                tc_pr = cell._tc.tcPr
                shd = tc_pr.find(qn("w:shd")) if tc_pr is not None else None
                if shd is None:
                    _set_cell_shading(cell, header_bg)
                elif shd.get(qn("w:fill")) == "ffffff":
                    continue
                for paragraph in cell.paragraphs:
                    for run in paragraph.runs:
                        run.font.bold = True


def _set_run_fonts(rpr: Any, font_name: str) -> None:
    """``font.name`` on python-docx's high-level API only ever writes
    ``w:rFonts/@w:ascii`` - Word resolves the actual glyph for anything
    outside Basic Latin (Vietnamese included) from ``@w:eastAsia``/``@w:cs``
    instead, and pandoc's reference heading styles carry ``w:*Theme``
    attributes that win over explicit font names until removed."""
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    for theme_attr in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
        if rfonts.get(qn(theme_attr)) is not None:
            del rfonts.attrib[qn(theme_attr)]
    for attribute in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        rfonts.set(qn(attribute), font_name)


_DOCX_PROSE_STYLES: Final = (
    "Normal",
    "Title",
    "Subtitle",
    "Heading 1",
    "Heading 2",
    "Heading 3",
    "Heading 4",
    "Heading 5",
    "Heading 6",
    "Body Text",
    "First Paragraph",
    "Compact",
    "Block Text",
)


def _set_document_font(document: Any, *, body_font: str, mono_font: str) -> None:
    """Word-safe fonts for body, headings, and code text (see the preset map above).

    "Normal" covers ordinary paragraphs and inherited styles; pandoc's
    heading/title styles carry explicit theme-font overrides of their own so
    they are updated alongside "Normal". "Verbatim Char" is the one character
    style Pandoc's docx writer uses for *all* code text, inline and block
    alike, so setting it here covers both at once.
    """
    for style_name in _DOCX_PROSE_STYLES:
        try:
            style = document.styles[style_name]
        except KeyError:
            continue
        style.font.name = body_font
        _set_run_fonts(style.element.get_or_add_rPr(), body_font)

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
    _apply_table_header_formatting(document, theme)


def _field_char(kind: str, *, dirty: bool = False) -> Any:
    element = OxmlElement("w:fldChar")
    element.set(qn("w:fldCharType"), kind)
    if dirty:
        # Tells Word the cached result below is not to be trusted - matches
        # what Word itself marks a field the moment it is inserted, before
        # its first recalculation.
        element.set(qn("w:dirty"), "true")
    return element


def _append_field(paragraph: Any, instruction: str) -> None:
    """Insert a live Word field (``{ PAGE }``, ``{ NUMPAGES }``) as three
    runs - python-docx has no high-level API for fields, so this is the raw
    OOXML sequence Word itself writes: a field-char run to open it, an
    instruction-text run naming it, and a field-char run to close it. Word
    computes the actual number itself whenever the document is opened,
    paginated, or printed - nothing here is a fixed value that could drift.
    """
    begin = paragraph.add_run()
    begin._r.append(_field_char("begin"))

    instr_run = paragraph.add_run()
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = f" {instruction} "
    instr_run._r.append(instr)

    end = paragraph.add_run()
    end._r.append(_field_char("end"))


def _clear_paragraph(paragraph: Any) -> None:
    for run in list(paragraph.runs):
        run._r.getparent().remove(run._r)


def _insert_toc_field(paragraph: Any) -> None:
    """Turn this (otherwise-empty) paragraph into a real Word "Table of
    Contents" field - the same complex field Word itself inserts via
    References > Table of Contents, not a hand-rolled list of hyperlinks: an
    actual field a reader can right-click and "Update Field" on, that shows
    up in Word's own navigation pane, and that is built from the heading
    paragraph styles (Heading 1, Heading 2, ...) Pandoc already assigned
    rather than anything this export invents. ``\\o "1-4"`` matches the
    frontend's own heading levels (``StarterKit.configure({ heading: {
    levels: [1, 2, 3, 4] } })`` in rich-text-editor.tsx); ``\\h`` makes every
    entry a real jump-to link, ``\\z`` hides the tab leader in web layout,
    ``\\u`` falls back to a paragraph's outline level if it has no heading
    style at all.
    """
    _clear_paragraph(paragraph)
    begin = paragraph.add_run()
    begin._r.append(_field_char("begin", dirty=True))

    instr_run = paragraph.add_run()
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = ' TOC \\o "1-4" \\h \\z \\u '
    instr_run._r.append(instr)

    separate = paragraph.add_run()
    separate._r.append(_field_char("separate"))

    # Word replaces this with the real outline the first time the field is
    # updated - shown only until then, or if a reader opens the file
    # somewhere fields never auto-update.
    placeholder = paragraph.add_run(
        'Right-click here and choose "Update Field" to build the table of'
        " contents."
    )
    placeholder.italic = True

    end = paragraph.add_run()
    end._r.append(_field_char("end"))


def _insert_native_toc_fields(document: Any) -> bool:
    """Replace every paragraph carrying export_content.py's
    ``WORD_TOC_FIELD_MARKER`` with a real TOC field - see
    ``_mark_table_of_contents_for_word`` for why Word gets the native
    mechanism instead of the custom-rendered outline PDF/HTML use.
    Returns whether any TOC field was inserted.
    """
    inserted = False
    for paragraph in document.paragraphs:
        if paragraph.text == WORD_TOC_FIELD_MARKER:
            _insert_toc_field(paragraph)
            inserted = True
    return inserted


def _auto_update_fields_on_open(document: Any) -> None:
    """Word does not recompute a field's cached result just because the
    document was opened - without this, the TOC field above (and the
    page-number footer below) would show only their placeholder/stale text
    until a reader manually right-clicks "Update Field". Ticking this is
    exactly what happens when a person inserts a TOC through Word's own UI.

    Only set when a TOC field exists: the flag makes Word ask "This document
    contains fields that may refer to other files. Do you want to update the
    fields?" on every open, which reads as an error. The footer's PAGE /
    NUMPAGES fields need no help - Word recomputes those on every layout.
    """
    settings_element = document.settings.element
    if settings_element.find(qn("w:updateFields")) is not None:
        return
    update_fields = OxmlElement("w:updateFields")
    update_fields.set(qn("w:val"), "true")
    settings_element.append(update_fields)


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


def _materialize_data_uris_for_pandoc(html: str, tmp_path: Path) -> str:
    """Write inline ``data:image/...;base64,...`` payloads to temporary files
    in ``tmp_path`` and strip ``data:`` hyperlinks before handing HTML to
    Pandoc.

    Pandoc's HTML attribute parser takes 45+ seconds on multi-megabyte
    ``data:`` URI strings in ``<img src="...">``, timing out Word export on
    image-heavy pages. Pointing ``src`` at a temporary file on disk lets
    Pandoc embed the same binary image in ~1s. Inlined ``<a href="data:...">``
    attachment downloads are only meaningful in a browser (HTML export) - Word
    cannot follow a ``data:`` hyperlink and bloats ``document.xml.rels`` if
    given one.
    """
    counter = 0

    def replace_img(match: re.Match[str]) -> str:
        nonlocal counter
        prefix, _full_uri, subtype_raw, b64_data, suffix = match.groups()
        try:
            raw_bytes = base64.b64decode(b64_data)
        except (binascii.Error, ValueError):
            return match.group(0)
        counter += 1
        subtype = subtype_raw.lower().split("+")[0]
        ext = "jpg" if subtype == "jpeg" else re.sub(r"[^a-z0-9]", "", subtype) or "bin"
        asset_path = tmp_path / f"inline_asset_{counter}.{ext}"
        asset_path.write_bytes(raw_bytes)
        return f"{prefix}{asset_path}{suffix}"

    materialized = _DATA_IMAGE_SRC_RE.sub(replace_img, html)
    return _DATA_ANCHOR_HREF_RE.sub(r"\1", materialized)


def _parse_inline_style(style_attr: str | None) -> dict[str, str]:
    if not style_attr:
        return {}
    return {
        prop.strip().lower(): val.strip()
        for prop, val in _STYLE_DECLARATION_RE.findall(style_attr)
    }


def _configure_page_setup(document: Any) -> None:
    """Set A4 page dimensions with balanced 2.0 cm margins (17.0 cm usable width)."""
    for section in document.sections:
        section.page_width = Cm(_PAGE_WIDTH_CM)
        section.page_height = Cm(_PAGE_HEIGHT_CM)
        section.top_margin = Cm(_PAGE_MARGIN_CM)
        section.bottom_margin = Cm(_PAGE_MARGIN_CM)
        section.left_margin = Cm(_PAGE_MARGIN_CM)
        section.right_margin = Cm(_PAGE_MARGIN_CM)


def _style_prose_hierarchy(document: Any, theme: dict[str, str]) -> None:
    """Replace Pandoc's default non-bold teal headings and wide body gaps with
    crisp, publication-ready typography matching WikiHub's reader scale."""
    fg = _parse_color(theme.get("foreground")) or "1f2937"
    border = _parse_color(theme.get("border")) or "d5dce6"
    fg_rgb = RGBColor.from_string(fg)

    for style_name in _BODY_SPACING_STYLES:
        try:
            style = document.styles[style_name]
        except KeyError:
            continue
        if style_name == "Normal":
            style.font.size = Pt(10.5)
            style.font.color.rgb = fg_rgb
        style.paragraph_format.space_before = Pt(0)
        style.paragraph_format.space_after = Pt(4)
        style.paragraph_format.line_spacing = 1.15

    if "Title" in document.styles:
        title_style = document.styles["Title"]
        title_style.font.size = Pt(22)
        title_style.font.bold = True
        title_style.font.color.rgb = fg_rgb
        title_style.paragraph_format.space_before = Pt(0)
        title_style.paragraph_format.space_after = Pt(12)
        title_style.paragraph_format.keep_with_next = True
        ppr = title_style.element.get_or_add_pPr()
        existing_pbdr = ppr.find(qn("w:pBdr"))
        if existing_pbdr is not None:
            ppr.remove(existing_pbdr)
        pbdr = OxmlElement("w:pBdr")
        bottom = OxmlElement("w:bottom")
        bottom.set(qn("w:val"), "single")
        bottom.set(qn("w:sz"), "6")
        bottom.set(qn("w:space"), "6")
        bottom.set(qn("w:color"), border)
        pbdr.append(bottom)
        ppr.append(pbdr)

    for heading_name, (size_pt, before_pt, after_pt) in _HEADING_SPECS.items():
        try:
            h_style = document.styles[heading_name]
        except KeyError:
            continue
        h_style.font.size = Pt(size_pt)
        h_style.font.bold = True
        h_style.font.italic = False
        h_style.font.color.rgb = fg_rgb
        h_style.paragraph_format.space_before = Pt(before_pt)
        h_style.paragraph_format.space_after = Pt(after_pt)
        h_style.paragraph_format.keep_with_next = True


def _annotate_inline_styles_for_pandoc(html: str) -> str:
    """Tag aligned paragraphs and colored/highlighted spans with Pandoc
    ``custom-style`` attributes so Pandoc preserves them as named Word styles
    that ``_apply_inline_custom_styles`` paints in the post-pass."""
    soup = BeautifulSoup(html, "html.parser")

    for p_tag in soup.find_all("p"):
        if p_tag.find_parent(["td", "th"]) is not None:
            continue
        styles = _parse_inline_style(str(p_tag.get("style") or ""))
        align_style = _CSS_TEXT_ALIGN_TO_STYLE.get(styles.get("text-align", "").lower())
        if align_style:
            wrapper = soup.new_tag("div")
            wrapper["custom-style"] = align_style
            p_tag.wrap(wrapper)

    for tag in soup.find_all(["span", "mark"]):
        styles = _parse_inline_style(str(tag.get("style") or ""))
        fg_hex = _parse_color(styles.get("color"))
        bg_hex = _parse_color(styles.get("background-color"))
        font_size_px_match = _PX_RE.match(styles.get("font-size", ""))
        if tag.name == "mark" and not bg_hex:
            bg_hex = "fef08a"
        parts: list[str] = []
        if fg_hex:
            parts.append(f"c={fg_hex.lower()}")
        if bg_hex:
            parts.append(f"b={bg_hex.lower()}")
        if font_size_px_match:
            px_val = float(font_size_px_match.group(1))
            pt_tenths = max(70, min(720, round(px_val * 7.5)))
            parts.append(f"s={pt_tenths}")
        if parts:
            tag.name = "span"
            tag["custom-style"] = "WH Inline " + " ".join(parts)

    return str(soup)


def _apply_inline_custom_styles(document: Any) -> None:
    """Paint the paragraph alignment and inline span color/highlight/size styles
    created by Pandoc from ``_annotate_inline_styles_for_pandoc``."""
    for style in document.styles:
        align = _WH_ALIGN_STYLE_MAP.get(style.name)
        if align is not None:
            style.paragraph_format.alignment = align
            style.paragraph_format.space_before = Pt(0)
            style.paragraph_format.space_after = Pt(4)
            continue
        if not style.name.startswith("WH Inline "):
            continue
        for token in style.name[len("WH Inline ") :].split():
            if token.startswith("c=") and len(token) == 8:
                style.font.color.rgb = RGBColor.from_string(token[2:])
            elif token.startswith("b=") and len(token) == 8:
                rpr = style.element.get_or_add_rPr()
                shd = OxmlElement("w:shd")
                shd.set(qn("w:val"), "clear")
                shd.set(qn("w:color"), "auto")
                shd.set(qn("w:fill"), token[2:])
                rpr.append(shd)
            elif token.startswith("s=") and token[2:].isdigit():
                style.font.size = Pt(int(token[2:]) / 10.0)


def _set_table_width(table: Any, width: int, width_type: str) -> None:
    tbl_pr = table._tbl.tblPr
    existing = tbl_pr.find(qn("w:tblW"))
    if existing is not None:
        tbl_pr.remove(existing)
    tbl_w = OxmlElement("w:tblW")
    tbl_w.set(qn("w:w"), str(width))
    tbl_w.set(qn("w:type"), width_type)
    tbl_pr.insert_element_before(
        tbl_w,
        "w:jc",
        "w:tblCellSpacing",
        "w:tblInd",
        "w:tblBorders",
        "w:shd",
        "w:tblLayout",
        "w:tblCellMar",
        "w:tblLook",
    )


def _set_table_cell_margins(table: Any, *, compact: bool = False) -> None:
    """Add comfortable padding inside every table cell (tighter for dense
    7+ column tables so narrow columns stay legible)."""
    tbl_pr = table._tbl.tblPr
    existing = tbl_pr.find(qn("w:tblCellMar"))
    if existing is not None:
        tbl_pr.remove(existing)
    cell_mar = OxmlElement("w:tblCellMar")
    v_pad, h_pad = ("60", "70") if compact else ("80", "110")
    for side, value in (("top", v_pad), ("bottom", v_pad), ("left", h_pad), ("right", h_pad)):
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:w"), value)
        el.set(qn("w:type"), "dxa")
        cell_mar.append(el)
    tbl_pr.insert_element_before(cell_mar, "w:tblLook")


_CSS_BORDER_STYLE_TO_OOXML: Final[dict[str, str]] = {
    "solid": "single",
    "dotted": "dotted",
    "dashed": "dashed",
    "double": "double",
    "groove": "threeDEngrave",
    "ridge": "threeDEmboss",
    "inset": "inset",
    "outset": "outset",
    "none": "nil",
}

_BORDER_TOKEN_FALLBACK_HEX: Final[dict[str, str]] = {
    "--border": "cfd7e3",
    "--border-strong": "94a3b8",
    "--muted-foreground": "64748b",
    "--foreground": "1e293b",
    "--primary": "216fc0",
    "--primary-subtle": "e8f2fc",
    "--wh-info": "2563eb",
    "--wh-success": "16a34a",
    "--wh-warning": "d97706",
    "--danger": "dc2626",
}

_OOXML_TC_BORDER_ORDER: Final = (
    "top",
    "left",
    "bottom",
    "right",
    "insideH",
    "insideV",
    "tl2br",
    "tr2bl",
)


def _resolve_border_color(token: str, theme: dict[str, str] | None = None) -> str | None:
    stripped = token.strip()
    if stripped.lower() == "transparent":
        return None
    if stripped.startswith("var(") and stripped.endswith(")"):
        var_name = stripped[4:-1].split(",", 1)[0].strip()
        if theme:
            theme_key = {
                "--border": "border",
                "--border-strong": "border",
                "--foreground": "foreground",
                "--primary": "primary",
            }.get(var_name)
            if theme_key and theme.get(theme_key):
                resolved = _parse_color(theme[theme_key])
                if resolved:
                    return resolved
        return _BORDER_TOKEN_FALLBACK_HEX.get(var_name)
    return _parse_color(stripped)


def _extract_border_color(
    border_css: str | None, theme: dict[str, str] | None = None
) -> str | None:
    if not border_css:
        return None
    for token in border_css.split():
        parsed = _resolve_border_color(token, theme)
        if parsed:
            return parsed
    return None


def _parse_css_border_spec(
    border_css: str | None,
    theme: dict[str, str] | None = None,
) -> tuple[str, str, str] | None:
    """Parse a CSS border declaration into OOXML ``(w:val, w:sz, w:color)``.

    Returns ``("nil", "0", "auto")`` when the declaration hides the border
    (``none`` / ``0px`` / ``transparent``), or ``None`` when no valid border
    declaration is present.
    """
    if not border_css:
        return None
    cleaned = border_css.strip()
    if not cleaned:
        return None
    lower = cleaned.lower()
    if (
        lower == "none"
        or lower == "0"
        or lower.startswith("0px")
        or " none" in lower
        or "transparent" in lower
    ):
        return ("nil", "0", "auto")

    ooxml_val = "single"
    sz = "6"
    color_hex: str | None = None

    # Split preserving `rgb(...)` / `var(...)` tokens.
    tokens = re.findall(r"[a-zA-Z-]+\([^)]*\)|\S+", cleaned)
    for token in tokens:
        tok_lower = token.lower()
        if tok_lower in _CSS_BORDER_STYLE_TO_OOXML:
            ooxml_val = _CSS_BORDER_STYLE_TO_OOXML[tok_lower]
            continue
        px_match = _PX_RE.match(token)
        if px_match:
            px_val = float(px_match.group(1))
            if px_val <= 0:
                return ("nil", "0", "auto")
            sz = str(max(4, min(96, round(px_val * 6))))
            continue
        if color_hex is None:
            color_hex = _resolve_border_color(token, theme)

    if ooxml_val == "nil":
        return ("nil", "0", "auto")
    if not color_hex:
        return None
    if ooxml_val == "double":
        # OOXML `double` draws two strokes plus an equal-width gap (3x total
        # thickness), so scale down from CSS px to keep double frames crisp.
        sz_int = int(sz)
        sz = "12" if sz_int >= 24 else ("6" if sz_int >= 12 else "4")
    return (ooxml_val, sz, color_hex)


def _set_tc_border_specs(
    tc: Any,
    edge_specs: dict[str, tuple[str, str, str]],
) -> None:
    """Write ``w:tcBorders`` on ``w:tcPr`` with per-edge OOXML border specs."""
    if not edge_specs:
        return
    tc_pr = tc.get_or_add_tcPr()
    existing = tc_pr.find(qn("w:tcBorders"))
    if existing is not None:
        tc_pr.remove(existing)
    borders = OxmlElement("w:tcBorders")
    for edge in _OOXML_TC_BORDER_ORDER:
        spec = edge_specs.get(edge)
        if spec is None:
            continue
        val, sz, color_hex = spec
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), val)
        if val != "nil":
            el.set(qn("w:sz"), sz)
            el.set(qn("w:space"), "0")
            el.set(qn("w:color"), color_hex)
        borders.append(el)
    if len(borders) > 0:
        tc_pr.insert_element_before(borders, "w:shd", "w:vAlign")


def _set_tc_borders(tc: Any, hex_color: str) -> None:
    spec = ("single", "6", hex_color)
    _set_tc_border_specs(
        tc,
        {"top": spec, "left": spec, "bottom": spec, "right": spec},
    )


def _set_tc_valign(tc: Any, ooxml_valign: str) -> None:
    tc_pr = tc.get_or_add_tcPr()
    existing = tc_pr.find(qn("w:vAlign"))
    if existing is not None:
        tc_pr.remove(existing)
    valign = OxmlElement("w:vAlign")
    valign.set(qn("w:val"), ooxml_valign)
    tc_pr.append(valign)


def _set_tc_width(tc: Any, twips: int) -> None:
    tc_pr = tc.get_or_add_tcPr()
    existing = tc_pr.find(qn("w:tcW"))
    if existing is not None:
        tc_pr.remove(existing)
    tc_w = OxmlElement("w:tcW")
    tc_w.set(qn("w:w"), str(twips))
    tc_w.set(qn("w:type"), "dxa")
    tc_pr.insert_element_before(tc_w, "w:gridSpan", "w:vMerge", "w:tcBorders", "w:shd", "w:vAlign")


def _extract_html_col_widths(
    html_table: Tag, num_cols: int, *, total_twips: int = _CONTENT_WIDTH_TWIPS
) -> list[int] | None:
    """Extract proportional column widths (in twips summing to
    ``total_twips``) from HTML ``style="width: X%"``,
    ``style="width: Npx"``, or TipTap ``colwidth`` attributes, respecting
    ``colspan`` and ``rowspan``."""
    if num_cols <= 0:
        return None
    pct_widths: list[float | None] = [None] * num_cols
    px_widths: list[float | None] = [None] * num_cols
    active_rowspans: dict[int, int] = {}

    for tr in html_table.find_all("tr"):
        if tr.find_parent("table") is not html_table:
            continue
        col_idx = 0
        for cell in tr.find_all(["th", "td"], recursive=False):
            while active_rowspans.get(col_idx, 0) > 0:
                col_idx += 1
            colspan = max(1, int(str(cell.get("colspan") or "1")))
            rowspan = max(1, int(str(cell.get("rowspan") or "1")))
            if col_idx >= num_cols:
                break
            if colspan == 1:
                styles = _parse_inline_style(str(cell.get("style") or ""))
                width_css = styles.get("width", "")
                pct_match = _PERCENT_RE.match(width_css)
                px_match = _PX_RE.match(width_css)
                if pct_match and pct_widths[col_idx] is None:
                    pct_widths[col_idx] = float(pct_match.group(1))
                elif px_match and px_widths[col_idx] is None:
                    px_widths[col_idx] = float(px_match.group(1))
                elif cell.get("colwidth") and px_widths[col_idx] is None:
                    raw_cw = str(cell.get("colwidth")).split(",")[0].strip()
                    if raw_cw.replace(".", "", 1).isdigit():
                        px_widths[col_idx] = float(raw_cw)
            if rowspan > 1:
                for span_col in range(col_idx, min(num_cols, col_idx + colspan)):
                    active_rowspans[span_col] = rowspan
            col_idx += colspan
        for k in list(active_rowspans):
            active_rowspans[k] -= 1
            if active_rowspans[k] <= 0:
                del active_rowspans[k]

    def normalize(values: list[float | None]) -> list[int] | None:
        known = [v for v in values if v is not None and v > 0]
        if not known:
            return None
        avg = sum(known) / len(known)
        filled = [v if (v is not None and v > 0) else avg for v in values]
        total = sum(filled)
        scaled = [max(580, round(total_twips * v / total)) for v in filled]
        diff = total_twips - sum(scaled)
        scaled[-1] = max(580, scaled[-1] + diff)
        return scaled

    return normalize(pct_widths) or normalize(px_widths)


def _apply_col_widths(doc_table: Any, col_widths: list[int]) -> None:
    tbl_grid = doc_table._tbl.tblGrid
    if tbl_grid is not None:
        for grid_col in list(tbl_grid.findall(qn("w:gridCol"))):
            tbl_grid.remove(grid_col)
        for width in col_widths:
            gc = OxmlElement("w:gridCol")
            gc.set(qn("w:w"), str(width))
            tbl_grid.append(gc)

    tbl_pr = doc_table._tbl.tblPr
    existing_layout = tbl_pr.find(qn("w:tblLayout"))
    if existing_layout is not None:
        tbl_pr.remove(existing_layout)
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    tbl_pr.insert_element_before(layout, "w:tblCellMar", "w:tblLook")
    _set_table_width(doc_table, sum(col_widths), "dxa")

    for row in doc_table.rows:
        col_idx = 0
        for tc in row._tr.tc_lst:
            tc_pr = tc.tcPr
            grid_span_el = tc_pr.find(qn("w:gridSpan")) if tc_pr is not None else None
            span = int(grid_span_el.get(qn("w:val"))) if grid_span_el is not None else 1
            span_width = sum(col_widths[col_idx : col_idx + span])
            if span_width > 0:
                _set_tc_width(tc, span_width)
            col_idx += span


def _is_vmerge_continuation(tc: Any) -> bool:
    tc_pr = tc.tcPr
    if tc_pr is None:
        return False
    vmerge = tc_pr.find(qn("w:vMerge"))
    return vmerge is not None and vmerge.get(qn("w:val")) != "restart"


def _set_compact_cell_paragraph(p_el: Any, jc_val: str | None) -> None:
    ppr = p_el.get_or_add_pPr()
    existing_spacing = ppr.find(qn("w:spacing"))
    if existing_spacing is not None:
        ppr.remove(existing_spacing)
    spacing = OxmlElement("w:spacing")
    spacing.set(qn("w:before"), "0")
    spacing.set(qn("w:after"), "0")
    spacing.set(qn("w:line"), "260")
    spacing.set(qn("w:lineRule"), "auto")
    ppr.append(spacing)

    if jc_val:
        for existing_jc in list(ppr.findall(qn("w:jc"))):
            ppr.remove(existing_jc)
        jc = OxmlElement("w:jc")
        jc.set(qn("w:val"), jc_val)
        ppr.append(jc)


def _clean_pandoc_table_style(document: Any) -> None:
    """Strip Pandoc's ``firstRow`` conditional formatting from its built-in
    ``Table`` style.

    Pandoc's reference ``Table`` style attaches a ``<w:tblStylePr
    w:type="firstRow">`` block with ``<w:tcBorders><w:bottom
    w:val="single"/></w:tcBorders>`` (no color/size) and ``<w:vAlign
    w:val="bottom"/>``. On shaded header rows that renders as an unwanted
    contrasting horizontal stripe across the header and pins unaligned header
    labels to the bottom edge.
    """
    try:
        table_style = document.styles["Table"]
    except KeyError:
        return
    for tbl_style_pr in list(table_style.element.findall(qn("w:tblStylePr"))):
        if tbl_style_pr.get(qn("w:type")) == "firstRow":
            table_style.element.remove(tbl_style_pr)


def _html_starts_with_cover_frame(html: str) -> bool:
    """True when the page begins with a framed cover-page table containing a nested layout table."""
    return bool(re.match(r"^\s*<table\b[\s\S]*?<table\b", html or "", re.IGNORECASE))


def _set_tr_height(tr_pr: Any, height_px: float) -> None:
    twips = max(240, min(14400, round(height_px * 15)))
    existing = tr_pr.find(qn("w:trHeight"))
    if existing is not None:
        tr_pr.remove(existing)
    tr_height = OxmlElement("w:trHeight")
    tr_height.set(qn("w:val"), str(twips))
    tr_height.set(qn("w:hRule"), "atLeast")
    tr_pr.append(tr_height)


def _set_tc_margins(tc: Any, *, top: int, bottom: int, left: int, right: int) -> None:
    tc_pr = tc.get_or_add_tcPr()
    existing = tc_pr.find(qn("w:tcMar"))
    if existing is not None:
        tc_pr.remove(existing)
    tc_mar = OxmlElement("w:tcMar")
    for side, val in (("top", top), ("left", left), ("bottom", bottom), ("right", right)):
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:w"), str(val))
        el.set(qn("w:type"), "dxa")
        tc_mar.append(el)
    tc_pr.append(tc_mar)


def _insert_page_break_after_table(doc_table: Any) -> None:
    p = OxmlElement("w:p")
    r = OxmlElement("w:r")
    br = OxmlElement("w:br")
    br.set(qn("w:type"), "page")
    r.append(br)
    p.append(r)
    doc_table._tbl.addnext(p)


def _style_one_table(
    doc_table: Any,
    html_table: Tag,
    theme: dict[str, str],
    header_bg: str,
    *,
    available_twips: int = _CONTENT_WIDTH_TWIPS,
) -> None:
    from docx.table import Table

    num_cols = len(doc_table.columns)
    is_wide_table = num_cols >= 7
    col_widths = _extract_html_col_widths(html_table, num_cols, total_twips=available_twips)
    if col_widths:
        _apply_col_widths(doc_table, col_widths)

    html_rows = [
        tr for tr in html_table.find_all("tr") if tr.find_parent("table") is html_table
    ]
    table_has_custom_bg = any(
        _parse_color(_parse_inline_style(str(c.get("style") or "")).get("background-color"))
        for tr in html_rows
        for c in tr.find_all(["th", "td"], recursive=False)
    )

    for doc_row, html_row in zip(doc_table.rows, html_rows, strict=False):
        tr_pr = doc_row._tr.get_or_add_trPr()
        if tr_pr.find(qn("w:cantSplit")) is None:
            tr_pr.append(OxmlElement("w:cantSplit"))
        row_styles = _parse_inline_style(str(html_row.get("style") or ""))
        row_height_match = _PX_RE.match(row_styles.get("height", ""))
        if row_height_match:
            _set_tr_height(tr_pr, float(row_height_match.group(1)))

        tcs = [tc for tc in doc_row._tr.tc_lst if not _is_vmerge_continuation(tc)]
        html_cells = html_row.find_all(["th", "td"], recursive=False)
        for tc, html_cell in zip(tcs, html_cells, strict=False):
            styles = _parse_inline_style(str(html_cell.get("style") or ""))
            bg_hex = _parse_color(styles.get("background-color"))
            fg_hex = _parse_color(styles.get("color"))
            edge_specs: dict[str, tuple[str, str, str]] = {}
            uniform_spec = _parse_css_border_spec(styles.get("border"), theme)
            if uniform_spec:
                for edge in ("top", "left", "bottom", "right"):
                    edge_specs[edge] = uniform_spec
            for edge in ("top", "right", "bottom", "left"):
                side_spec = _parse_css_border_spec(styles.get(f"border-{edge}"), theme)
                if side_spec:
                    edge_specs[edge] = side_spec
            diag_down = _parse_css_border_spec(
                str(html_cell.get("data-diagonal-down") or ""), theme
            )
            if diag_down and diag_down[0] != "nil":
                edge_specs["tl2br"] = diag_down
            diag_up = _parse_css_border_spec(
                str(html_cell.get("data-diagonal-up") or ""), theme
            )
            if diag_up and diag_up[0] != "nil":
                edge_specs["tr2bl"] = diag_up
            jc_val = _CSS_TEXT_ALIGN_TO_JC.get(styles.get("text-align", "").lower())
            valign_val = _CSS_VALIGN_TO_OOXML.get(styles.get("vertical-align", "").lower())
            colspan = max(1, int(str(html_cell.get("colspan") or "1")))
            is_cover_banner = (
                html_cell.name == "th"
                and not bg_hex
                and colspan >= num_cols
                and table_has_custom_bg
            )

            if bg_hex:
                _set_tc_shading(tc, bg_hex)
            elif is_cover_banner:
                _set_tc_shading(tc, "ffffff")
            elif html_cell.name == "th":
                tc_pr = tc.tcPr
                if tc_pr is None or tc_pr.find(qn("w:shd")) is None:
                    _set_tc_shading(tc, header_bg)

            if edge_specs:
                _set_tc_border_specs(tc, edge_specs)
            if valign_val:
                _set_tc_valign(tc, valign_val)
            elif html_cell.name == "th" and not is_cover_banner:
                _set_tc_valign(tc, "center")

            direct_html_ps = html_cell.find_all("p", recursive=False)
            direct_doc_ps = tc.findall(qn("w:p"))
            for p_idx, p_el in enumerate(direct_doc_ps):
                p_jc = jc_val
                if p_idx < len(direct_html_ps):
                    p_styles = _parse_inline_style(str(direct_html_ps[p_idx].get("style") or ""))
                    explicit_p_jc = _CSS_TEXT_ALIGN_TO_JC.get(
                        p_styles.get("text-align", "").lower()
                    )
                    if explicit_p_jc:
                        p_jc = explicit_p_jc
                _set_compact_cell_paragraph(p_el, p_jc)
                for r_el in p_el.findall(qn("w:r")):
                    rpr = r_el.get_or_add_rPr()
                    if (
                        html_cell.name == "th"
                        and not is_cover_banner
                        and rpr.find(qn("w:b")) is None
                    ):
                        rpr.append(OxmlElement("w:b"))
                    if fg_hex and rpr.find(qn("w:color")) is None:
                        color_el = OxmlElement("w:color")
                        color_el.set(qn("w:val"), fg_hex)
                        rpr.append(color_el)
                    if is_wide_table and rpr.find(qn("w:sz")) is None:
                        for sz_tag in ("w:sz", "w:szCs"):
                            sz_el = OxmlElement(sz_tag)
                            sz_el.set(qn("w:val"), "18")
                            rpr.append(sz_el)

            # Recursively style nested tables inside this cell (e.g. cover-page
            # header/title layout grids) without shifting top-level table pairing.
            nested_doc_tbls = tc.findall(qn("w:tbl"))
            nested_html_tbls = [
                t for t in html_cell.find_all("table") if t.find_parent("table") is html_table
            ]
            if nested_doc_tbls and nested_html_tbls:
                _set_tc_margins(tc, top=220, bottom=220, left=260, right=260)
                inner_twips = max(2000, available_twips - 520)
                for nested_tbl_el, nested_html_tbl in zip(
                    nested_doc_tbls, nested_html_tbls, strict=False
                ):
                    _style_one_table(
                        Table(nested_tbl_el, doc_table._parent),
                        nested_html_tbl,
                        theme,
                        header_bg,
                        available_twips=inner_twips,
                    )


def _apply_html_table_styles(document: Any, html: str, theme: dict[str, str]) -> None:
    """Restore table widths, cell padding, proportional column widths, cell
    borders, row heights, nested tables, and per-cell shading/text-color/alignment
    that Pandoc drops from HTML tables."""
    _clean_pandoc_table_style(document)
    doc_tables = list(document.tables)
    if not doc_tables:
        return

    for doc_table in _iter_tables(document):
        _set_table_width(doc_table, 5000, "pct")
        _set_table_cell_margins(doc_table, compact=len(doc_table.columns) >= 7)

    soup = BeautifulSoup(html, "html.parser")
    html_tables = [t for t in soup.find_all("table") if t.find_parent("table") is None]
    header_bg = _parse_color(theme.get("table_header_bg")) or "f0f0f0"

    for idx, (doc_table, html_table) in enumerate(zip(doc_tables, html_tables, strict=False)):
        _style_one_table(doc_table, html_table, theme, header_bg)
        if (
            idx == 0
            and len(doc_table.columns) == 1
            and html_table.find("table") is not None
            and len(doc_tables) > 1
        ):
            _insert_page_break_after_table(doc_table)


def _constrain_image_widths(document: Any) -> None:
    """Keep embedded images within the A4 printable area while preserving
    their aspect ratio."""
    max_w = int(Cm(_MAX_IMAGE_WIDTH_CM))
    max_h = int(Cm(_MAX_IMAGE_HEIGHT_CM))
    for shape in document.inline_shapes:
        width = shape.width
        height = shape.height
        if width > max_w:
            scale = max_w / width
            width = max_w
            height = round(height * scale)
        if height > max_h:
            scale = max_h / height
            height = max_h
            width = round(width * scale)
        shape.width = width
        shape.height = height


async def html_to_docx(
    html: str,
    theme: dict[str, str],
    *,
    title: str,
    font_id: str | None = None,
    post_process: Callable[[Any], None] | None = None,
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

    ``post_process`` runs last, on the python-docx ``Document``, for a caller
    that lays out its own kind of document (the issue report) on top of
    this pipeline's defaults.
    """
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        highlight_theme_path = tmp_path / "highlight.theme"
        output_path = tmp_path / "output.docx"

        highlight_theme_path.write_text(
            json.dumps(_build_highlight_theme(theme)), encoding="utf-8"
        )
        pandoc_html = _materialize_data_uris_for_pandoc(html, tmp_path)
        pandoc_html = _annotate_inline_styles_for_pandoc(pandoc_html)

        args = [
            settings.pandoc_binary,
            "--from=html+native_divs+native_spans",
            "--to=docx",
            f"--lua-filter={_LUA_FILTER}",
            f"--highlight-style={highlight_theme_path}",
            *([] if _html_starts_with_cover_frame(html) else ["--metadata", f"title={title}"]),
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
                process.communicate(pandoc_html.encode("utf-8")),
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
        _configure_page_setup(document)
        _style_prose_hierarchy(document, theme)
        _apply_html_table_styles(document, html, theme)
        _apply_named_styles(document, theme)
        _apply_inline_custom_styles(document)
        _set_document_font(document, body_font=_docx_body_font(font_id), mono_font=_DOCX_MONO_FONT)
        _constrain_image_widths(document)
        has_toc = _insert_native_toc_fields(document)
        _add_page_number_footer(document)
        if has_toc:
            _auto_update_fields_on_open(document)
        if post_process is not None:
            post_process(document)

        result_stream = io.BytesIO()
        document.save(result_stream)
        return result_stream.getvalue()
