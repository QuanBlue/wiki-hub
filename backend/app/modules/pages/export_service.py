"""Page export (PDF/HTML/Word), rendered by the real page in a headless
browser rather than a second, hand-maintained stylesheet.

Replaces the old WeasyPrint-based ``pdf_export.py``: that module rendered raw
page HTML through a fixed, hand-written print stylesheet with no knowledge of
the live theme, per-space fonts, syntax-highlight colors, callouts, toggles,
task lists, or attachment cards - and three such stylesheets (live view, HTML
export, PDF export) had already drifted from each other before this existed.
This module instead visits the app's own chrome-less ``/print`` route in a
real Chromium and captures the result, so fidelity is exact by construction
and self-heals as new page features are added.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING, Final
from urllib.parse import quote

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ServiceUnavailableError
from app.core.logging import get_logger
from app.core.security import create_export_token
from app.models.page import WikiPage
from app.models.space import Space
from app.models.user import User
from app.modules.pages.export_content import prepare_export_html
from app.modules.pages.export_docx import html_to_docx
from app.modules.pages.export_snapshot import SNAPSHOT_JS, THEME_PROBE_JS
from app.services.browser import render_page
from app.services.site_settings import SiteSettingsService
from app.services.storage import get_storage

if TYPE_CHECKING:
    from playwright.async_api import Page

logger = get_logger(__name__)


class ExportFormat(StrEnum):
    pdf = "pdf"
    html = "html"
    docx = "docx"


MEDIA_TYPES: Final[dict[ExportFormat, str]] = {
    ExportFormat.pdf: "application/pdf",
    ExportFormat.html: "text/html; charset=utf-8",
    ExportFormat.docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

#: Waits on either outcome from the /print route: ExportShell sets
#: data-export-ready once content has settled, or data-export-error if the
#: bundle fetch failed or nothing became ready within its own watchdog.
_READY_OR_ERROR_SELECTOR = 'body[data-export-ready="true"], body[data-export-error]'

_SLUG_CHARS: Final = re.compile(r"[^a-z0-9]+")
#: Unicode gives no canonical decomposition for stroke-through letters like
#: "đ"/"Đ" - NFD leaves them untouched, so they need an explicit substitution
#: before the generic diacritic strip below runs.
_STROKE_LETTERS: Final = str.maketrans({"đ": "d", "Đ": "D"})


def _export_filename_stem(title: str, *, fallback: str = "page") -> str:
    """Turn a page title into a readable, download-safe filename stem.

    Unlike the page's own URL slug (``pages/service.py``'s ``unique_slug``,
    which lowercases and discards anything outside ``[a-z0-9]`` with no
    transliteration first), this transliterates accented Latin letters -
    Vietnamese tone marks included - down to their plain ASCII base letter,
    so "Giám sát ứng dụng Java SpringBoot" becomes
    "giam-sat-ung-dung-java-springboot" instead of "gi-m-s-t-ng-d-ng...".
    """
    normalized = unicodedata.normalize("NFD", title.translate(_STROKE_LETTERS))
    ascii_title = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    stem = _SLUG_CHARS.sub("-", ascii_title.strip().lower()).strip("-")
    return stem[:200] or fallback


@dataclass(frozen=True)
class ExportResult:
    content: bytes
    media_type: str
    filename: str


class ExportService:
    def __init__(
        self,
        *,
        page_renderer: Callable[[], AbstractAsyncContextManager[Page]] = render_page,
    ) -> None:
        # Injectable so tests substitute a fake async-context-manager Page
        # without a real browser - the same seam ObjectStorage's set_storage()
        # gives S3.
        self._page_renderer = page_renderer

    async def export(
        self,
        *,
        page: WikiPage,
        space: Space,
        user: User,
        fmt: ExportFormat,
        session: AsyncSession,
    ) -> ExportResult:
        token, _ = create_export_token(
            user_id=user.id,
            space_id=space.id,
            page_id=page.id,
            fmt=fmt.value,
            ttl_seconds=settings.export_token_ttl_seconds,
        )
        url = f"{settings.frontend_internal_url}/print?token={quote(token)}"
        timeout_ms = settings.export_render_timeout_seconds * 1000

        from playwright.async_api import Error as PlaywrightError

        content: bytes = b""
        docx_theme: dict[str, str] | None = None

        try:
            async with self._page_renderer() as browser_page:
                await browser_page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
                await browser_page.wait_for_selector(_READY_OR_ERROR_SELECTOR, timeout=timeout_ms)

                error_reason = await browser_page.get_attribute("body", "data-export-error")
                if error_reason:
                    logger.error(
                        "export_render_failed", page_id=str(page.id), reason=error_reason
                    )
                    raise ServiceUnavailableError(
                        "The page could not be prepared for export. Please try again."
                    )

                await browser_page.emulate_media(media="print")
                if fmt is ExportFormat.docx:
                    # Only the color/font *palette* comes from the live
                    # render here - the HTML structure comes from the same
                    # semantic markup PDF/HTML already use (see below),
                    # because several node types (callout, toggle, code
                    # block) render on screen through a custom React node
                    # view whose visual DOM does not carry the same
                    # data-type attributes that markup does.
                    docx_theme = await browser_page.evaluate(THEME_PROBE_JS)
                else:
                    content = await self._capture(browser_page, fmt)
        except PlaywrightError as exc:
            logger.error("export_render_error", page_id=str(page.id), fmt=fmt.value, error=str(exc))
            raise ServiceUnavailableError(
                "Rendering the page for export failed. Please try again."
            ) from exc

        if docx_theme is not None:
            html = await prepare_export_html(page, storage=get_storage(), session=session)
            # Same precedence the live page itself renders with (see
            # export-shell.tsx's spaceFontStyle): the space's own font
            # first, falling back to the site's default whenever the space
            # has none of its own set.
            font_id = space.font_family
            if not font_id or font_id in ("inherit", "default"):
                site_settings = await SiteSettingsService(session).get_effective()
                font_id = site_settings.default_font
            content = await html_to_docx(html, docx_theme, title=page.title, font_id=font_id)

        logger.info("export_rendered", page_id=str(page.id), fmt=fmt.value, bytes=len(content))
        return ExportResult(
            content=content,
            media_type=MEDIA_TYPES[fmt],
            filename=f"{_export_filename_stem(page.title)}.{fmt.value}",
        )

    @staticmethod
    async def _capture(browser_page: Page, fmt: ExportFormat) -> bytes:
        if fmt is ExportFormat.pdf:
            return await browser_page.pdf(
                format="A4",
                print_background=True,
                prefer_css_page_size=True,
                margin={"top": "14mm", "right": "12mm", "bottom": "16mm", "left": "12mm"},
                display_header_footer=True,
                header_template="<div></div>",
                footer_template=(
                    '<div style="font-size:8px; width:100%; text-align:center; color:#888;">'
                    '<span class="pageNumber"></span> / <span class="totalPages"></span></div>'
                ),
            )
        html = await browser_page.evaluate(SNAPSHOT_JS)
        return html.encode("utf-8")
