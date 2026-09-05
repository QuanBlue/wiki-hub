"""ExportService: mints a page-scoped token, drives a (faked) headless-browser
page through the /print protocol, and captures the requested format."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from app.core.config import settings
from app.core.exceptions import ServiceUnavailableError
from app.core.security import decode_export_token
from app.modules.pages.export_service import ExportFormat, ExportResult, ExportService


class FakePage:
    def __init__(self) -> None:
        self.goto = AsyncMock()
        self.wait_for_selector = AsyncMock()
        self.get_attribute = AsyncMock(return_value=None)
        self.emulate_media = AsyncMock()
        self.pdf = AsyncMock(return_value=b"%PDF-1.4")
        self.evaluate = AsyncMock(return_value="<html><body>ok</body></html>")


class FakeRenderer:
    """A fake async-context-manager page_renderer, standing in for
    ``app.services.browser.render_page`` - the injectable seam."""

    def __init__(self, page: FakePage) -> None:
        self.page = page
        self.entered = False
        self.exited = False

    def __call__(self) -> FakeRenderer:
        return self

    async def __aenter__(self) -> FakePage:
        self.entered = True
        return self.page

    async def __aexit__(self, *exc: object) -> bool:
        self.exited = True
        return False


def actors(*, space_font: str | None = None):
    user = SimpleNamespace(id=uuid.uuid4())
    space = SimpleNamespace(id=uuid.uuid4(), key="ENG", font_family=space_font)
    page = SimpleNamespace(id=uuid.uuid4(), slug="runbook", title="Runbook")
    session = Mock()
    return user, space, page, session


@pytest.mark.asyncio
async def test_pdf_export_mints_a_scoped_token_and_captures_a_pdf() -> None:
    fake_page = FakePage()
    renderer = FakeRenderer(fake_page)
    service = ExportService(page_renderer=renderer)
    user, space, page, session = actors()

    result = await service.export(
        page=page, space=space, user=user, fmt=ExportFormat.pdf, session=session
    )

    assert renderer.entered and renderer.exited
    goto_url = fake_page.goto.call_args.args[0]
    assert goto_url.startswith(f"{settings.frontend_internal_url}/print?token=")
    token = goto_url.split("token=", 1)[1]
    identity = decode_export_token(token)
    assert identity.subject == user.id
    assert identity.space_id == space.id
    assert identity.page_id == page.id
    assert identity.fmt == "pdf"

    fake_page.wait_for_selector.assert_awaited_once()
    selector = fake_page.wait_for_selector.call_args.args[0]
    assert 'data-export-ready="true"' in selector
    assert "data-export-error" in selector

    fake_page.emulate_media.assert_awaited_once_with(media="print")
    fake_page.pdf.assert_awaited_once()
    pdf_kwargs = fake_page.pdf.call_args.kwargs
    assert pdf_kwargs["print_background"] is True
    assert pdf_kwargs["prefer_css_page_size"] is True

    assert result == ExportResult(
        content=b"%PDF-1.4", media_type="application/pdf", filename="runbook.pdf"
    )


@pytest.mark.asyncio
async def test_html_export_captures_the_snapshot_js_result() -> None:
    fake_page = FakePage()
    service = ExportService(page_renderer=FakeRenderer(fake_page))
    user, space, page, session = actors()

    result = await service.export(
        page=page, space=space, user=user, fmt=ExportFormat.html, session=session
    )

    fake_page.evaluate.assert_awaited_once()
    fake_page.pdf.assert_not_called()
    assert result.content == b"<html><body>ok</body></html>"
    assert result.media_type == "text/html; charset=utf-8"
    assert result.filename == "runbook.html"


async def _run_docx_export(*, space_font: str | None):
    """Shared plumbing for the docx tests below: fakes the browser theme
    probe and the conversion call, returning what `html_to_docx` was
    actually called with so each test only has to assert on `font_id`
    (the site default is stubbed to "lora" throughout)."""
    fake_page = FakePage()
    fake_page.evaluate = AsyncMock(return_value={"code_fg": "#fff"})
    renderer = FakeRenderer(fake_page)
    service = ExportService(page_renderer=renderer)
    user, space, page, session = actors(space_font=space_font)

    prepared = AsyncMock(return_value="<p>real semantic html</p>")
    converted = AsyncMock(return_value=b"PK\x03\x04docxbytes")
    fake_storage = Mock()
    effective_settings = SimpleNamespace(default_font="lora")
    site_settings_service = Mock(get_effective=AsyncMock(return_value=effective_settings))
    with (
        patch("app.modules.pages.export_service.prepare_export_html", prepared),
        patch("app.modules.pages.export_service.html_to_docx", converted),
        patch("app.modules.pages.export_service.get_storage", return_value=fake_storage),
        patch(
            "app.modules.pages.export_service.SiteSettingsService",
            return_value=site_settings_service,
        ),
    ):
        result = await service.export(
            page=page, space=space, user=user, fmt=ExportFormat.docx, session=session
        )
    return converted, prepared, fake_storage, session, result, page


@pytest.mark.asyncio
async def test_docx_export_probes_the_theme_and_converts_the_semantic_html() -> None:
    """Word's HTML *structure* comes straight from prepare_export_html (the
    same semantic markup PDF/HTML use), not from the live rendered DOM -
    several node types render on screen through a React node view whose
    visual markup does not carry the same semantic data-type attributes."""
    converted, prepared, fake_storage, session, result, page = await _run_docx_export(
        space_font="roboto"
    )

    prepared.assert_awaited_once_with(page, storage=fake_storage, session=session)
    converted.assert_awaited_once_with(
        "<p>real semantic html</p>", {"code_fg": "#fff"}, title=page.title, font_id="roboto"
    )
    assert result == ExportResult(
        content=b"PK\x03\x04docxbytes",
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename="runbook.docx",
    )


@pytest.mark.asyncio
async def test_docx_export_uses_the_spaces_own_font_over_the_site_default() -> None:
    converted, *_ = await _run_docx_export(space_font="merriweather")

    assert converted.call_args.kwargs["font_id"] == "merriweather"


@pytest.mark.asyncio
@pytest.mark.parametrize("sentinel", [None, "inherit", "default"])
async def test_docx_export_falls_back_to_the_site_default_font(sentinel) -> None:
    converted, *_ = await _run_docx_export(space_font=sentinel)

    # The site default stubbed in `_run_docx_export` ("lora"), not whatever
    # sentinel the space itself carries.
    assert converted.call_args.kwargs["font_id"] == "lora"


@pytest.mark.asyncio
async def test_a_reported_export_error_becomes_service_unavailable() -> None:
    fake_page = FakePage()
    fake_page.get_attribute = AsyncMock(return_value="fetch-failed")
    service = ExportService(page_renderer=FakeRenderer(fake_page))
    user, space, page, session = actors()

    with pytest.raises(ServiceUnavailableError):
        await service.export(
            page=page, space=space, user=user, fmt=ExportFormat.pdf, session=session
        )

    fake_page.pdf.assert_not_called()


@pytest.mark.asyncio
async def test_a_playwright_error_becomes_service_unavailable() -> None:
    fake_page = FakePage()
    fake_page.goto = AsyncMock(side_effect=PlaywrightError("navigation failed"))
    renderer = FakeRenderer(fake_page)
    service = ExportService(page_renderer=renderer)
    user, space, page, session = actors()

    with pytest.raises(ServiceUnavailableError):
        await service.export(
            page=page, space=space, user=user, fmt=ExportFormat.pdf, session=session
        )

    # The renderer's context manager still tears down its page/context even
    # though the render itself failed.
    assert renderer.entered and renderer.exited


@pytest.mark.asyncio
async def test_a_render_timeout_becomes_service_unavailable() -> None:
    fake_page = FakePage()
    fake_page.wait_for_selector = AsyncMock(
        side_effect=PlaywrightTimeoutError("Timeout waiting for selector")
    )
    service = ExportService(page_renderer=FakeRenderer(fake_page))
    user, space, page, session = actors()

    with pytest.raises(ServiceUnavailableError):
        await service.export(
            page=page, space=space, user=user, fmt=ExportFormat.html, session=session
        )
