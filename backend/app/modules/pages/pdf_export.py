"""Safe, Unicode-capable PDF export that keeps a page's document structure."""

from __future__ import annotations

from html import escape
from io import BytesIO

from bs4 import BeautifulSoup, NavigableString, Tag
from markdown_it import MarkdownIt
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import ListFlowable, ListItem, Paragraph, Preformatted, SimpleDocTemplate, Spacer, Table, TableStyle

from app.models.page import WikiPage

_SANS_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
_SANS_BOLD_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
_MONO_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
_FONTS_REGISTERED = False


def _register_fonts() -> None:
    global _FONTS_REGISTERED
    if _FONTS_REGISTERED:
        return
    pdfmetrics.registerFont(TTFont("WikiHubSans", _SANS_FONT))
    pdfmetrics.registerFont(TTFont("WikiHubSansBold", _SANS_BOLD_FONT))
    # Debian's compact DejaVu package omits Sans Oblique; regular remains a
    # readable Unicode fallback while ReportLab's <i> preserves emphasis.
    pdfmetrics.registerFont(TTFont("WikiHubSansItalic", _SANS_FONT))
    pdfmetrics.registerFont(TTFont("WikiHubMono", _MONO_FONT))
    _FONTS_REGISTERED = True


def _inline_html(node: Tag | NavigableString) -> str:
    """Translate safe inline page markup to ReportLab's paragraph markup."""
    if isinstance(node, NavigableString):
        return escape(str(node))
    contents = "".join(_inline_html(child) for child in node.children)
    name = node.name.lower()
    if name in {"strong", "b"}:
        return f'<font name="WikiHubSansBold">{contents}</font>'
    if name in {"em", "i"}:
        return f"<i>{contents}</i>"
    if name in {"code", "kbd"}:
        return f'<font name="WikiHubMono" size="8.5">{contents}</font>'
    if name == "br":
        return "<br/>"
    if name == "a":
        href = node.get("href", "")
        if isinstance(href, str) and href.startswith(("https://", "http://", "mailto:")):
            return f'<link href="{escape(href, quote=True)}" color="#216fc0">{contents}</link>'
    return contents


def _paragraph(element: Tag, style: ParagraphStyle) -> Paragraph | None:
    markup = "".join(_inline_html(child) for child in element.children).strip()
    return Paragraph(markup, style) if markup else None


def render_page_pdf(page: WikiPage) -> bytes:
    """Create a direct-download PDF without executing imported page markup."""
    _register_fonts()
    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer, pagesize=A4, leftMargin=1.8 * cm, rightMargin=1.8 * cm,
        topMargin=1.8 * cm, bottomMargin=1.8 * cm, title=page.title,
    )
    base = getSampleStyleSheet()
    body = ParagraphStyle("WikiHubBody", parent=base["BodyText"], fontName="WikiHubSans", fontSize=10, leading=15, spaceAfter=8)
    title = ParagraphStyle("WikiHubTitle", parent=base["Title"], fontName="WikiHubSansBold", fontSize=22, leading=27, spaceAfter=16)
    heading_styles = {
        level: ParagraphStyle(f"WikiHubH{level}", parent=base[f"Heading{level}"], fontName="WikiHubSansBold", spaceBefore=14, spaceAfter=8)
        for level in range(1, 4)
    }
    quote = ParagraphStyle("WikiHubQuote", parent=body, leftIndent=14, borderPadding=8, borderColor=colors.HexColor("#b7c4d4"), borderWidth=1, borderLeft=True)
    code = ParagraphStyle("WikiHubCode", parent=body, fontName="WikiHubMono", fontSize=8.5, leading=12, leftIndent=8, rightIndent=8, borderPadding=8, borderColor=colors.HexColor("#c8d1dc"), borderWidth=0.5)
    html = MarkdownIt("commonmark", {"html": True}).render(page.content) if page.content_format == "markdown" else page.content
    soup = BeautifulSoup(html, "html.parser")
    story = [Paragraph(escape(page.title), title)]

    for element in soup.contents:
        if not isinstance(element, Tag) or element.name.lower() in {"script", "style", "iframe", "object", "embed", "form"}:
            continue
        name = element.name.lower()
        if name in {"h1", "h2", "h3"}:
            paragraph = _paragraph(element, heading_styles[int(name[1])])
            if paragraph:
                story.append(paragraph)
        elif name in {"p", "div", "figure"}:
            paragraph = _paragraph(element, body)
            if paragraph:
                story.append(paragraph)
        elif name == "blockquote":
            paragraph = _paragraph(element, quote)
            if paragraph:
                story.append(paragraph)
        elif name == "pre":
            story.extend([Preformatted(element.get_text(), code, maxLineLength=100), Spacer(1, 4)])
        elif name in {"ul", "ol"}:
            items = []
            for item in element.find_all("li", recursive=False):
                paragraph = _paragraph(item, body)
                if paragraph:
                    items.append(ListItem(paragraph))
            if items:
                story.extend([ListFlowable(items, bulletType="1" if name == "ol" else "bullet", leftIndent=18), Spacer(1, 6)])
        elif name == "table":
            rows = []
            for row in element.find_all("tr"):
                cells = []
                for cell in row.find_all(["th", "td"], recursive=False):
                    paragraph = _paragraph(cell, body)
                    if paragraph:
                        cells.append(paragraph)
                if cells:
                    rows.append(cells)
            if rows:
                table = Table(rows, repeatRows=1 if element.find("th") else 0, hAlign="LEFT")
                table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#b7c4d4")), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
                story.extend([table, Spacer(1, 8)])

    document.build(story)
    return buffer.getvalue()
