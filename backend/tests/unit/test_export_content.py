"""Export content preparation: the inherited sanitizer, forcing toggles open,
and inlining attachments as data: URIs for the session-less headless render."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.config import settings
from app.modules.pages import export_content


def page(**overrides: object) -> SimpleNamespace:
    defaults = {
        "id": uuid.uuid4(),
        "content": "",
        "content_format": "html",
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def attachment(**overrides: object) -> SimpleNamespace:
    defaults = {
        "page_id": uuid.uuid4(),
        "object_key": "attachments/x/y.png",
        "content_type": "image/png",
        "size_bytes": 4,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def storage(data: bytes = b"data") -> AsyncMock:
    fake = AsyncMock()
    fake.get.return_value = data
    return fake


def session_returning(attachment_by_id: dict[uuid.UUID, object]) -> AsyncMock:
    fake = AsyncMock()

    async def _get(_model: object, attachment_id: uuid.UUID) -> object:
        return attachment_by_id.get(attachment_id)

    fake.get = AsyncMock(side_effect=_get)
    return fake


@pytest.mark.asyncio
async def test_markdown_content_is_rendered_before_sanitizing() -> None:
    p = page(content_format="markdown", content="# Heading\n\nSome *text*.")
    html = await export_content.prepare_export_html(
        p, storage=storage(), session=session_returning({})
    )
    assert "<h1>Heading</h1>" in html
    assert "<em>text</em>" in html


@pytest.mark.asyncio
async def test_html_content_is_used_as_is() -> None:
    p = page(content_format="html", content="<p>Already HTML</p>")
    html = await export_content.prepare_export_html(
        p, storage=storage(), session=session_returning({})
    )
    assert "<p>Already HTML</p>" in html


@pytest.mark.asyncio
async def test_sanitizer_strips_dangerous_tags_and_attributes() -> None:
    p = page(
        content_format="markdown",
        content=(
            "# Heading\n\n"
            '<script>alert(1)</script><iframe src="//evil"></iframe>'
            '<a href="javascript:bad()" onclick="bad()">link</a>'
        ),
    )
    html = await export_content.prepare_export_html(
        p, storage=storage(), session=session_returning({})
    )
    assert "<script" not in html
    assert "<iframe" not in html
    assert "javascript:" not in html
    assert "onclick" not in html


@pytest.mark.asyncio
async def test_toggles_are_forced_open() -> None:
    p = page(
        content_format="html",
        content='<div data-type="toggle" data-open="false"><div data-type="toggle-summary">S</div></div>',
    )
    html = await export_content.prepare_export_html(
        p, storage=storage(), session=session_returning({})
    )
    assert 'data-open="true"' in html
    assert 'data-open="false"' not in html


@pytest.mark.asyncio
async def test_an_already_open_toggle_stays_open() -> None:
    p = page(content_format="html", content='<div data-type="toggle" data-open="true">x</div>')
    html = await export_content.prepare_export_html(
        p, storage=storage(), session=session_returning({})
    )
    assert 'data-open="true"' in html


class TestAttachmentInlining:
    @pytest.mark.asyncio
    async def test_a_matching_image_is_inlined_as_a_data_uri(self) -> None:
        attachment_id = uuid.uuid4()
        p = page(content_format="html", content=f'<img src="/api/v1/attachments/{attachment_id}/content">')
        att = attachment(page_id=p.id, content_type="image/png")
        html = await export_content.prepare_export_html(
            p, storage=storage(b"\x89PNG"), session=session_returning({attachment_id: att})
        )
        assert "data:image/png;base64," in html
        assert "/api/v1/attachments/" not in html

    @pytest.mark.asyncio
    async def test_a_matching_attachment_link_is_inlined_and_downloadable(self) -> None:
        attachment_id = uuid.uuid4()
        p = page(
            content_format="html",
            content=(
                f'<a href="/api/v1/attachments/{attachment_id}/content" '
                f'data-attachment="report.pdf">Download</a>'
            ),
        )
        att = attachment(page_id=p.id, content_type="application/pdf")
        html = await export_content.prepare_export_html(
            p, storage=storage(b"%PDF-1.4"), session=session_returning({attachment_id: att})
        )
        assert "data:application/pdf;base64," in html
        assert 'download="report.pdf"' in html

    @pytest.mark.asyncio
    async def test_a_non_attachment_url_is_left_untouched(self) -> None:
        p = page(content_format="html", content='<img src="https://example.com/pic.png">')
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert html == '<img src="https://example.com/pic.png"/>'

    @pytest.mark.asyncio
    async def test_a_non_attachment_link_is_left_untouched(self) -> None:
        p = page(content_format="html", content='<a href="https://example.com">link</a>')
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert html == '<a href="https://example.com">link</a>'

    @pytest.mark.asyncio
    async def test_an_unresolvable_attachment_link_is_left_untouched(self) -> None:
        attachment_id = uuid.uuid4()
        p = page(
            content_format="html",
            content=f'<a href="/api/v1/attachments/{attachment_id}/content">Download</a>',
        )
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert f"/api/v1/attachments/{attachment_id}/content" in html
        assert "download=" not in html

    @pytest.mark.asyncio
    async def test_an_unknown_attachment_id_is_left_as_a_plain_link(self) -> None:
        attachment_id = uuid.uuid4()
        p = page(content_format="html", content=f'<img src="/api/v1/attachments/{attachment_id}/content">')
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({})
        )
        assert f"/api/v1/attachments/{attachment_id}/content" in html
        assert "data:" not in html

    @pytest.mark.asyncio
    async def test_an_attachment_belonging_to_another_page_is_not_dereferenced(self) -> None:
        attachment_id = uuid.uuid4()
        p = page(content_format="html", content=f'<img src="/api/v1/attachments/{attachment_id}/content">')
        att = attachment(page_id=uuid.uuid4())  # a different page
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({attachment_id: att})
        )
        assert "data:" not in html

    @pytest.mark.asyncio
    async def test_an_attachment_over_the_per_asset_cap_is_skipped(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "export_max_inline_asset_bytes", 10)
        attachment_id = uuid.uuid4()
        p = page(content_format="html", content=f'<img src="/api/v1/attachments/{attachment_id}/content">')
        att = attachment(page_id=p.id, size_bytes=11)
        html = await export_content.prepare_export_html(
            p, storage=storage(), session=session_returning({attachment_id: att})
        )
        assert "data:" not in html

    @pytest.mark.asyncio
    async def test_an_attachment_over_the_total_document_cap_is_skipped(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "export_max_inline_total_bytes", 10)
        first_id, second_id = uuid.uuid4(), uuid.uuid4()
        p = page(
            content_format="html",
            content=(
                f'<img src="/api/v1/attachments/{first_id}/content">'
                f'<img src="/api/v1/attachments/{second_id}/content">'
            ),
        )
        session = session_returning(
            {
                first_id: attachment(page_id=p.id, size_bytes=8),
                second_id: attachment(page_id=p.id, size_bytes=8),
            }
        )
        html = await export_content.prepare_export_html(
            p, storage=storage(b"12345678"), session=session
        )
        # The first fits under the 10-byte cap; the second would push the
        # running total over it and is left un-inlined instead.
        assert html.count("data:") == 1

    @pytest.mark.asyncio
    async def test_the_same_attachment_referenced_twice_is_fetched_once(self) -> None:
        attachment_id = uuid.uuid4()
        p = page(
            content_format="html",
            content=(
                f'<img src="/api/v1/attachments/{attachment_id}/content">'
                f'<img src="/api/v1/attachments/{attachment_id}/content">'
            ),
        )
        att = attachment(page_id=p.id)
        fake_storage = storage()
        await export_content.prepare_export_html(
            p, storage=fake_storage, session=session_returning({attachment_id: att})
        )
        fake_storage.get.assert_awaited_once()
