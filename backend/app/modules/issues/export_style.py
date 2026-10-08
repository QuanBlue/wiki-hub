"""Word styling for the issue report, in WikiHub's own Wiki Workspace palette.

pandoc lays the report out from ``export.py``'s HTML, tagging each piece with
a ``custom-style`` (``WH ...``); this python-docx pass then paints those
styles. Every colour is a light-mode token from ``frontend/app/globals.css``
(named next to each constant below) so the document reads as part of the app
- the same blue, greys, status tints and label colours as the issue screens -
rather than pandoc's stock look. OOXML has no rounded corners, so pills and
cards are shaded runs and bordered paragraphs: faithful in colour, not in
geometry (see ``pages/export_docx.py``).
"""

from __future__ import annotations

from typing import Any, Final

from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml.parser import OxmlElement
from docx.shared import Cm, Pt, RGBColor

from app.modules.pages.export_docx import _append_field, _set_cell_shading, _set_run_fonts

FONT: Final = "Arial"

FOREGROUND: Final = "161B24"  # --wh-neutral-900 (--foreground)
SECONDARY: Final = "4D5566"  # --wh-neutral-600 - secondary text that must still read on paper
MUTED: Final = "6B7484"  # --wh-neutral-500 (--muted-foreground)
BORDER: Final = "CBD1DA"  # --wh-neutral-300 (--border-strong) - --border washes out in print
SUNKEN: Final = "F7F8FA"  # --wh-neutral-50 (--surface-sunken)
PRIMARY: Final = "216FC0"  # --wh-brand-600 (--primary)
PRIMARY_STRONG: Final = "1D487E"  # --wh-brand-800
PRIMARY_SUBTLE: Final = "EDF6FF"  # --wh-brand-50 (--primary-subtle)
PRIMARY_TINT: Final = "D8ECFF"  # --wh-brand-100

#: (text, tint) per status - the same tones as `IssueStatusBadge`. In
#: progress takes brand-100 rather than --primary-subtle so the pill still
#: shows on the issue header's own brand-50 band.
STATUS_COLORS: Final[dict[str, tuple[str, str]]] = {
    "open": ("9A6100", "FDF3E0"),  # --wh-warning / --wh-warning-bg
    "in_progress": (PRIMARY, PRIMARY_TINT),
    "done": ("1F7A4D", "E6F5ED"),  # --wh-success / --wh-success-bg
}

#: Mirrors frontend/lib/issue-labels.ts - only the slugs are stored, the
#: colours live in the frontend.
LABEL_COLORS: Final[dict[str, str]] = {
    "bug": "D73A4A",
    "documentation": "0075CA",
    "enhancement": "2FB5B8",
    "good-first-issue": "7057FF",
    "help-wanted": "008672",
    "question": "D876E3",
}

#: Report-wide document theme for `html_to_docx` - table grid, header row and
#: code palette, the same keys the page export probes. Code sits on the
#: sunken surface with the status/brand tones rather than the app's dark
#: code block: a report is printed and read on paper, where light reads.
DOCX_THEME: Final[dict[str, str]] = {
    "foreground": f"#{FOREGROUND}",
    "border": f"#{BORDER}",
    "table_header_bg": f"#{SUNKEN}",
    "code_bg": f"#{SUNKEN}",
    "code_fg": "#232936",  # --wh-neutral-800
    "code_comment": f"#{MUTED}",
    "code_keyword": "#b3261e",  # --wh-danger
    "code_string": "#1f7a4d",  # --wh-success
    "code_number": "#7057ff",
    "code_function": f"#{PRIMARY}",
    "code_type": "#b3261e",
    "code_variable": "#232936",
    "code_meta": "#9a6100",  # --wh-warning
}

#: Summary table column widths (cm): #, title, status, assignee, reported.
_SUMMARY_WIDTHS: Final = (1.0, 6.4, 2.8, 3.6, 2.8)


def status_style(status: str) -> str:
    return f"WH Status {status}"


def label_style(slug: str) -> str:
    return f"WH Label {slug}"


def _tint(hex_color: str, amount: float) -> str:
    """``hex_color`` mixed into white - the `color-mix(... 14%, transparent)`
    tint `LabelChip` draws on a white surface."""
    r, g, b = (int(hex_color[i : i + 2], 16) for i in (0, 2, 4))
    mix = [round(255 - (255 - c) * amount) for c in (r, g, b)]
    return "".join(f"{c:02X}" for c in mix)


def _style(document: Any, name: str, kind: WD_STYLE_TYPE = WD_STYLE_TYPE.PARAGRAPH) -> Any:
    try:
        return document.styles[name]
    except KeyError:
        return document.styles.add_style(name, kind)


def _clear_theme_fonts(rpr: Any) -> None:
    """pandoc's reference headings name *theme* fonts (``w:asciiTheme``),
    which win over any explicit font - drop them so Arial applies."""
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        return
    for attribute in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
        if rfonts.get(qn(attribute)) is not None:
            del rfonts.attrib[qn(attribute)]


def _font(
    style: Any,
    *,
    size: float,
    color: str = FOREGROUND,
    bold: bool | None = None,
    italic: bool | None = None,
) -> None:
    style.font.name = FONT
    rpr = style.element.get_or_add_rPr()
    _clear_theme_fonts(rpr)
    _set_run_fonts(rpr, FONT)
    style.font.size = Pt(size)
    style.font.color.rgb = RGBColor.from_string(color)
    if bold is not None:
        style.font.bold = bold
    if italic is not None:
        style.font.italic = italic


def _spacing(style: Any, *, before: float = 0, after: float = 0, line: float | None = None) -> None:
    fmt = style.paragraph_format
    fmt.space_before = Pt(before)
    fmt.space_after = Pt(after)
    if line is not None:
        fmt.line_spacing = line


def _run_shading(style: Any, fill: str) -> None:
    rpr = style.element.get_or_add_rPr()
    for old in rpr.findall(qn("w:shd")):
        rpr.remove(old)
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    rpr.append(shd)


def _paragraph_props(style: Any) -> Any:
    return style.element.get_or_add_pPr()


def _border(style: Any, edges: dict[str, tuple[str, int, int]]) -> None:
    """``edges`` maps ``top``/``left``/``bottom``/``right`` to
    ``(colour, size in eighths of a point, space in points)``."""
    ppr = _paragraph_props(style)
    for old in ppr.findall(qn("w:pBdr")):
        ppr.remove(old)
    borders = OxmlElement("w:pBdr")
    for edge in ("top", "left", "bottom", "right"):
        if edge not in edges:
            continue
        color, size, space = edges[edge]
        element = OxmlElement(f"w:{edge}")
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), str(size))
        element.set(qn("w:space"), str(space))
        element.set(qn("w:color"), color)
        borders.append(element)
    ppr.append(borders)


def _paragraph_shading(style: Any, fill: str) -> None:
    ppr = _paragraph_props(style)
    for old in ppr.findall(qn("w:shd")):
        ppr.remove(old)
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    ppr.append(shd)


def _keep_with_next(style: Any) -> None:
    style.paragraph_format.keep_with_next = True


def _paint_styles(document: Any, *, multi: bool) -> None:
    normal = document.styles["Normal"]
    _font(normal, size=10)
    for name in ("Body Text", "First Paragraph", "Compact", "Block Text"):
        style = _style(document, name)
        _font(style, size=10)
        _spacing(style, before=0, after=6, line=1.25)

    # Cover of a multi-issue report.
    eyebrow = _style(document, "WH Eyebrow")
    _font(eyebrow, size=8.5, color=PRIMARY, bold=True)
    eyebrow.font.all_caps = True
    _spacing(eyebrow, after=4)
    _keep_with_next(eyebrow)

    report_title = _style(document, "WH Report Title")
    _font(report_title, size=26, color=FOREGROUND, bold=True)
    _spacing(report_title, after=6)
    _keep_with_next(report_title)

    cover_byline = _style(document, "WH Cover Byline")
    _font(cover_byline, size=9.5, color=SECONDARY)
    _spacing(cover_byline, after=16)
    _border(cover_byline, {"bottom": (PRIMARY, 12, 8)})

    # An issue's header - its number, title, pills and byline - is one
    # brand-50 band with a heavy brand bar down the left: consecutive
    # paragraphs with identical borders and shading merge into one box in
    # Word, so these four styles must share them exactly.
    header_styles = (
        ("WH Issue Eyebrow", 8.5, PRIMARY, True),
        ("Heading 1", 18 if multi else 20, PRIMARY_STRONG, True),
        ("WH Badges", 9, FOREGROUND, None),
        ("WH Byline", 9, SECONDARY, None),
    )
    for index, (name, size, color, bold) in enumerate(header_styles):
        style = _style(document, name)
        _font(style, size=size, color=color, bold=bold)
        _spacing(
            style,
            before=0,
            after=14 if name == "WH Byline" else 0,
            line=1.3 if name == "WH Badges" else None,
        )
        _paragraph_shading(style, PRIMARY_SUBTLE)
        # The same border set on all four (top/bottom in the band's own
        # colour, so invisible): Word draws a group's top and bottom only on
        # its first and last paragraph, as padding, and keeps the left bar
        # unbroken - a different set per paragraph splits the band.
        _border(
            style,
            {
                "left": (PRIMARY, 36, 10),
                "top": (PRIMARY_SUBTLE, 4, 8),
                "bottom": (PRIMARY_SUBTLE, 4, 8),
            },
        )
        style.paragraph_format.left_indent = Pt(10)
        style.paragraph_format.right_indent = Pt(4)
        if name != "WH Byline":
            _keep_with_next(style)
    document.styles["WH Issue Eyebrow"].font.all_caps = True
    if multi:
        # Each issue gets its own page, so one report never runs into the next.
        document.styles["WH Issue Eyebrow"].paragraph_format.page_break_before = True

    # Sections (Details, Description...): plain bold headings - no band, no bar.
    heading2 = _style(document, "Heading 2")
    _font(heading2, size=11.5, color=FOREGROUND, bold=True)
    _spacing(heading2, before=16, after=8)
    _keep_with_next(heading2)

    meta_label = _style(document, "WH Meta Label")
    _font(meta_label, size=9, color=SECONDARY, bold=True)
    _spacing(meta_label, before=3, after=3)

    meta_value = _style(document, "WH Meta Value")
    _font(meta_value, size=10, color=FOREGROUND)
    _spacing(meta_value, before=3, after=3)

    summary_head = _style(document, "WH Table Head")
    _font(summary_head, size=8.5, color="FFFFFF", bold=True)
    summary_head.font.all_caps = True
    _spacing(summary_head, before=4, after=4)

    summary_cell = _style(document, "WH Table Cell")
    _font(summary_cell, size=9.5, color=FOREGROUND)
    _spacing(summary_cell, before=3, after=3)

    figure = _style(document, "WH Figure")
    _spacing(figure, before=6, after=2)
    figure.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _border(
        figure,
        {edge: (BORDER, 6, 4) for edge in ("top", "left", "bottom", "right")},
    )
    _keep_with_next(figure)

    caption = _style(document, "WH Caption")
    _font(caption, size=8.5, color=SECONDARY, italic=True)
    _spacing(caption, after=10)
    caption.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER

    empty = _style(document, "WH Empty")
    _font(empty, size=10, color=MUTED, italic=True)
    _spacing(empty, after=6)

    # A shared note: the left-bar, tinted card the reporter sees on "My
    # issues" (`border-primary bg-primary-subtle border-l-2`).
    for name, size, bold, color, before, after in (
        ("WH Note Meta", 8.5, True, PRIMARY_STRONG, 6, 0),
        ("WH Note", 10, False, FOREGROUND, 0, 0),
    ):
        style = _style(document, name)
        _font(style, size=size, color=color, bold=bold)
        _spacing(style, before=before, after=after, line=1.25)
        _paragraph_shading(style, PRIMARY_SUBTLE)
        _border(style, {"left": (PRIMARY, 18, 8)})
        style.paragraph_format.left_indent = Pt(8)
        style.paragraph_format.right_indent = Pt(4)
    _keep_with_next(document.styles["WH Note Meta"])

    gap = _style(document, "WH Gap")
    _font(gap, size=4)
    _spacing(gap)

    # Pills: a shaded run with a little padding of non-breaking spaces.
    for status, (text, tint) in STATUS_COLORS.items():
        style = _style(document, status_style(status), WD_STYLE_TYPE.CHARACTER)
        style.font.bold = True
        style.font.size = Pt(9)
        style.font.color.rgb = RGBColor.from_string(text)
        _run_shading(style, tint)
    for slug, color in LABEL_COLORS.items():
        style = _style(document, label_style(slug), WD_STYLE_TYPE.CHARACTER)
        style.font.bold = True
        style.font.size = Pt(9)
        style.font.color.rgb = RGBColor.from_string(color)
        _run_shading(style, _tint(color, 0.18))


def _shade_cell(cell: Any, fill: str) -> None:
    """Replace any shading already on the cell (the shared pipeline paints
    every header row) rather than stacking a second ``w:shd``."""
    tc_pr = cell._tc.get_or_add_tcPr()
    for old in tc_pr.findall(qn("w:shd")):
        tc_pr.remove(old)
    _set_cell_shading(cell, fill)


def _paint_tables(document: Any) -> None:
    """Shade the label column of a details table and the header row of a
    summary table - found through the custom styles their cells carry, so a
    table typed into a description keeps the plain grid."""
    for table in document.tables:
        is_summary = False
        for row in table.rows:
            for cell in row.cells:
                styles = {p.style.name for p in cell.paragraphs if p.style is not None}
                if "WH Meta Label" in styles:
                    _shade_cell(cell, SUNKEN)
                    cell.width = Cm(4.2)
                if "WH Table Head" in styles:
                    _shade_cell(cell, PRIMARY)
                    is_summary = True
        if is_summary:
            table.autofit = False
            for row in table.rows:
                for cell, width in zip(row.cells, _SUMMARY_WIDTHS, strict=False):
                    cell.width = Cm(width)
        tbl_pr = table._tbl.tblPr
        margins = OxmlElement("w:tblCellMar")
        for edge, value in (("left", 120), ("right", 120)):
            element = OxmlElement(f"w:{edge}")
            element.set(qn("w:w"), str(value))
            element.set(qn("w:type"), "dxa")
            margins.append(element)
        for old in tbl_pr.findall(qn("w:tblCellMar")):
            tbl_pr.remove(old)
        tbl_pr.insert_element_before(margins, "w:tblLook")


def _drop_pandoc_title(document: Any) -> None:
    """pandoc turns the ``title`` metadata (kept for the file's properties)
    into a stock "Title" paragraph; the report draws its own header."""
    for paragraph in list(document.paragraphs):
        if paragraph.style is not None and paragraph.style.name in ("Title", "Subtitle", "Date"):
            paragraph._p.getparent().remove(paragraph._p)


def _page_setup(document: Any, footer_text: str) -> None:
    for section in document.sections:
        section.top_margin = Cm(2)
        section.bottom_margin = Cm(2)
        section.left_margin = Cm(2.2)
        section.right_margin = Cm(2.2)
        footer = section.footer
        paragraph = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
        for run in list(paragraph.runs):
            run._r.getparent().remove(run._r)
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.add_run(f"{footer_text}  ·  ")
        _append_field(paragraph, "PAGE")
        paragraph.add_run(" / ")
        _append_field(paragraph, "NUMPAGES")
        for run in paragraph.runs:
            run.font.size = Pt(8)
            run.font.color.rgb = RGBColor.from_string(MUTED)


def style_issue_report(document: Any, *, multi: bool, footer_text: str) -> None:
    """The python-docx pass for an issue report; see the module docstring."""
    _drop_pandoc_title(document)
    _paint_styles(document, multi=multi)
    _paint_tables(document)
    _page_setup(document, footer_text)
