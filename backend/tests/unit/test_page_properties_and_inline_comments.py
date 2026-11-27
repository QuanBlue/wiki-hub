"""Unit tests for page properties, inline mentions, sanitizer allowlist, and export blocks."""

from __future__ import annotations

import uuid

from bs4 import BeautifulSoup

from app.modules.document_import.sanitize import sanitize_imported_html
from app.modules.pages.export_content import _render_custom_inline_and_blocks_for_export
from app.modules.pages.service import PageService
from app.schemas.page import PageCustomProperty, PageProperties


def test_page_properties_dump_and_parse_roundtrip() -> None:
    owner_id = uuid.uuid4()
    props = PageProperties(
        status="verified",
        owner_id=owner_id,
        custom=[PageCustomProperty(key=" Module ", value=" Auth ")],
    )
    dumped = PageService._dump_properties(props)
    assert dumped == {
        "status": "verified",
        "owner_id": str(owner_id),
        "custom": [{"key": "Module", "value": "Auth"}],
    }
    parsed = PageService._parse_properties(dumped)
    assert parsed.status == "verified"
    assert parsed.owner_id == owner_id
    assert len(parsed.custom) == 1
    assert parsed.custom[0].key == "Module"
    assert parsed.custom[0].value == "Auth"


def test_page_properties_empty_dumps_to_empty_dict() -> None:
    assert PageService._dump_properties(PageProperties()) == {}
    assert PageService._dump_properties(None) == {}


def test_extract_page_mentions() -> None:
    html = (
        '<p>Hi <span data-type="userMention" data-username="Alice">@Alice</span> '
        'and <span data-type="userMention" data-username="bob">@Bob</span>!</p>'
    )
    assert PageService._extract_page_mentions(html, "html") == {"alice", "bob"}
    assert PageService._extract_page_mentions(html, "markdown") == set()


def test_sanitizer_preserves_new_editor_nodes_and_strips_scripts() -> None:
    raw = (
        '<p>Hello <span data-type="userMention" data-username="alice" data-label="Alice">@Alice</span> '
        '<time data-type="dateChip" datetime="2026-11-27">2026-11-27</time> '
        '<span data-type="statusBadge" data-label="DONE" data-color="green">DONE</span> '
        '<span data-type="inlineMath" data-latex="E=mc^2">E=mc^2</span></p>'
        '<div data-type="blockMath" data-latex="\\sum_{i=1}^n i">\\sum_{i=1}^n i</div>'
        '<div data-type="childPages" data-view-mode="table" data-depth="all" data-filter-status="verified"></div>'
        '<div data-type="whiteboard" data-scene="{}" data-caption="Arch"></div>'
        "<script>alert(1)</script>"
    )
    cleaned = sanitize_imported_html(raw)
    assert "<script>" not in cleaned
    assert 'data-type="userMention"' in cleaned
    assert 'data-username="alice"' in cleaned
    assert 'data-type="dateChip"' in cleaned
    assert 'datetime="2026-11-27"' in cleaned
    assert 'data-type="statusBadge"' in cleaned
    assert 'data-color="green"' in cleaned
    assert 'data-type="inlineMath"' in cleaned
    assert 'data-type="blockMath"' in cleaned
    assert 'data-type="childPages"' in cleaned
    assert 'data-view-mode="table"' in cleaned
    assert 'data-type="whiteboard"' in cleaned


def test_export_custom_inline_and_blocks() -> None:
    html = (
        '<p><span data-type="statusBadge" data-label="DONE" data-color="green">DONE</span> '
        '<span data-type="inlineMath" data-latex="a^2+b^2=c^2">a^2+b^2=c^2</span></p>'
        '<div data-type="blockMath" data-latex="x=1">x=1</div>'
        '<div data-type="whiteboard" data-svg="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" data-caption="Flow"></div>'
    )
    soup = BeautifulSoup(html, "html.parser")
    _render_custom_inline_and_blocks_for_export(soup)
    rendered = str(soup)
    assert "[DONE]" in rendered
    assert "<code>a^2+b^2=c^2</code>" in rendered
    assert "<pre><code>x=1</code></pre>" in rendered
    assert 'src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="' in rendered
