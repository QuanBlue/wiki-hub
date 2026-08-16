import sys
from types import SimpleNamespace

from app.modules.pages import pdf_export


def test_pdf_export_sanitizes_html_and_renders(monkeypatch):
    page = SimpleNamespace(
        title="<Title>",
        content_format="markdown",
        content='# Heading\n\n<script>alert(1)</script><a href="javascript:bad()" onclick="bad()">link</a>',
    )
    safe = pdf_export._safe_content(page)
    assert "script" not in safe and "javascript:" not in safe and "onclick" not in safe

    class CSS:
        def __init__(self, string):
            self.string = string

    class HTML:
        def __init__(self, string):
            self.string = string

        def write_pdf(self, stylesheets):
            assert stylesheets and self.string.startswith("<!doctype html>")
            return b"pdf"

    monkeypatch.setitem(sys.modules, "weasyprint", SimpleNamespace(CSS=CSS, HTML=HTML))
    assert pdf_export.render_page_pdf(page) == b"pdf"
