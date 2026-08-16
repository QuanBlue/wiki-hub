"""High-fidelity, safe HTML-to-PDF export for WikiHub pages."""

from __future__ import annotations

from html import escape

from bs4 import BeautifulSoup
from markdown_it import MarkdownIt

from app.models.page import WikiPage

_PRINT_CSS = """
@page { size: A4; margin: 18mm 17mm; }
* { box-sizing: border-box; }
body { color: #172033; font-family: "DejaVu Sans", sans-serif; font-size: 10pt; line-height: 1.7; }
article { max-width: 100%; }
h1, h2, h3 { color: #182234; font-weight: 700; line-height: 1.25; page-break-after: avoid; }
h1 { font-size: 25pt; margin: 0 0 18pt; }
h2 { font-size: 19pt; margin: 24pt 0 10pt; }
h3 { font-size: 14pt; margin: 18pt 0 8pt; }
p { margin: 0 0 10pt; }
a { color: #216fc0; text-decoration: underline; }
ul, ol { margin: 0 0 10pt 20pt; padding: 0; }
li { margin: 4pt 0; }
code { background: #f1f3f6; border-radius: 3pt; font-family: "DejaVu Sans Mono", monospace;
  font-size: 8.5pt; padding: 1pt 3pt; }
pre { background: #f1f3f6; border: 0.5pt solid #cfd7e3; border-radius: 4pt;
  font-family: "DejaVu Sans Mono", monospace; font-size: 8.5pt; line-height: 1.45;
  margin: 12pt 0; overflow-wrap: anywhere; padding: 10pt; white-space: pre-wrap; }
pre code { background: transparent; padding: 0; }
blockquote { border-left: 3pt solid #8ba4bf; color: #4f5f74; margin: 12pt 0;
  padding: 2pt 0 2pt 12pt; }
table { border-collapse: collapse; margin: 12pt 0; max-width: 100%; width: 100%; }
th, td { border: 0.5pt solid #cfd7e3; padding: 6pt 7pt; text-align: left; vertical-align: top; }
th { background: #f1f3f6; font-weight: 700; }
img { height: auto; max-width: 100%; page-break-inside: avoid; }
figure { margin: 12pt 0; page-break-inside: avoid; }
hr { border: 0; border-top: 0.5pt solid #cfd7e3; margin: 16pt 0; }
"""


def _safe_content(page: WikiPage) -> str:
    content = (
        MarkdownIt("commonmark", {"html": True}).render(page.content)
        if page.content_format == "markdown"
        else page.content
    )
    soup = BeautifulSoup(content, "html.parser")
    for element in soup.find_all(["script", "iframe", "object", "embed", "form", "base"]):
        element.decompose()
    for element in soup.find_all(True):
        for attribute in list(element.attrs):
            value = str(element.attrs[attribute]).strip().lower()
            if attribute.lower().startswith("on") or value.startswith("javascript:"):
                del element.attrs[attribute]
    return str(soup)


def render_page_pdf(page: WikiPage) -> bytes:
    """Render the same rich HTML structure users see, as a direct download."""
    from weasyprint import CSS, HTML

    document = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{escape(page.title)}</title></head>
<body><article><h1>{escape(page.title)}</h1>{_safe_content(page)}</article></body></html>"""
    return HTML(string=document).write_pdf(stylesheets=[CSS(string=_PRINT_CSS)])
