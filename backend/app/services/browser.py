"""Shared headless-Chromium browser for rendering pages server-side.

Used by page export (PDF/HTML/Word): rather than reimplementing the app's
styling in a second stylesheet, the backend opens the real page in a real
browser and captures the result. See app/modules/pages/export_service.py.

The browser process is expensive to start (~1s+) so it is launched once,
lazily, and kept warm for the life of the process - the same lazy
launch/close/test-override shape as app/core/redis.py and
app/services/storage.py.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Final

from app.core.config import settings
from app.core.logging import get_logger

if TYPE_CHECKING:
    from playwright.async_api import Browser, Page, Playwright

logger = get_logger(__name__)

#: --no-sandbox: the runtime container has no CAP_SYS_ADMIN and only ever
#: loads first-party content (the internal /print route), so Chromium's
#: process sandbox buys nothing here and would otherwise refuse to start.
#: --disable-dev-shm-usage: Docker's default /dev/shm is 64MB, too small for
#: Chromium's shared memory use; the compose service also raises shm_size as
#: belt-and-braces.
#: --font-render-hinting=none / --force-color-profile=srgb: deterministic
#: glyph metrics and color output across hosts, so a PDF renders the same in
#: CI as in production.
LAUNCH_ARGS: Final[list[str]] = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--font-render-hinting=none",
    "--force-color-profile=srgb",
]

_playwright: Playwright | None = None
_browser: Browser | None = None
_lock = asyncio.Lock()
_render_slots = asyncio.Semaphore(settings.export_max_concurrent_renders)


async def get_browser() -> Browser:
    """Return the process-wide headless Chromium instance, launching it on
    first use."""
    global _playwright, _browser
    if _browser is not None:
        return _browser

    async with _lock:
        if _browser is not None:
            return _browser

        from playwright.async_api import async_playwright

        _playwright = await async_playwright().start()
        _browser = await _playwright.chromium.launch(headless=True, args=LAUNCH_ARGS)
        logger.info("browser_launched")

    return _browser


async def close_browser() -> None:
    """Stop the shared browser, if one was ever launched. Idempotent."""
    global _playwright, _browser
    if _browser is not None:
        await _browser.close()
    if _playwright is not None:
        await _playwright.stop()
    _browser = None
    _playwright = None


def set_browser(browser: Browser | None) -> None:
    """Test seam: inject a fake browser instead of launching a real one."""
    global _browser
    _browser = browser


@asynccontextmanager
async def render_page() -> AsyncIterator[Page]:
    """Yield a fresh, isolated ``Page`` for exactly one export.

    Bounded by a semaphore so a burst of exports cannot pile up unbounded
    Chromium contexts, and guaranteed to tear down its context (and the page
    within it) on every path, success or failure.
    """
    async with _render_slots:
        browser = await get_browser()
        context = await browser.new_context(
            viewport={"width": 1280, "height": 1600},
            device_scale_factor=2,
            color_scheme="light",
        )
        try:
            page = await context.new_page()
            try:
                yield page
            finally:
                await page.close()
        finally:
            await context.close()
