"""The shared headless-browser singleton: lazy launch, idempotent close, and
the test-override seam used by export-service tests."""

from __future__ import annotations

from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.services import browser as browser_module
from app.services.browser import close_browser, get_browser, render_page, set_browser


@pytest.fixture(autouse=True)
def _reset_singleton():
    """Every test starts and ends with a clean slate, regardless of outcome."""
    set_browser(None)
    browser_module._playwright = None
    yield
    set_browser(None)
    browser_module._playwright = None


@pytest.mark.asyncio
async def test_get_browser_launches_once_and_memoises() -> None:
    fake_browser = Mock()
    fake_playwright = Mock()
    fake_playwright.chromium.launch = AsyncMock(return_value=fake_browser)
    fake_playwright_cm = Mock()
    fake_playwright_cm.start = AsyncMock(return_value=fake_playwright)

    with patch("playwright.async_api.async_playwright", return_value=fake_playwright_cm) as start:
        first = await get_browser()
        second = await get_browser()

    assert first is fake_browser
    assert second is fake_browser
    start.assert_called_once()
    fake_playwright.chromium.launch.assert_awaited_once()


@pytest.mark.asyncio
async def test_concurrent_launches_race_safely_to_a_single_browser() -> None:
    """Two callers arriving before the browser exists must not launch twice -
    the second one blocks on the lock and then finds the first's result."""
    import asyncio

    fake_browser = Mock()
    launch_started = asyncio.Event()
    release_launch = asyncio.Event()

    async def slow_launch(*_args, **_kwargs):
        launch_started.set()
        await release_launch.wait()
        return fake_browser

    fake_playwright = Mock()
    fake_playwright.chromium.launch = slow_launch
    fake_playwright_cm = Mock()
    fake_playwright_cm.start = AsyncMock(return_value=fake_playwright)

    with patch("playwright.async_api.async_playwright", return_value=fake_playwright_cm):
        first_task = asyncio.create_task(get_browser())
        await launch_started.wait()  # first caller now holds the lock, mid-launch

        second_task = asyncio.create_task(get_browser())
        await asyncio.sleep(0.01)  # let the second caller queue on the lock

        release_launch.set()
        first, second = await asyncio.gather(first_task, second_task)

    assert first is fake_browser
    assert second is fake_browser


@pytest.mark.asyncio
async def test_set_browser_overrides_the_singleton() -> None:
    fake = Mock()
    set_browser(fake)
    assert await get_browser() is fake


@pytest.mark.asyncio
async def test_close_browser_resets_and_stops_everything() -> None:
    fake_browser = Mock()
    fake_browser.close = AsyncMock()
    fake_playwright = Mock()
    fake_playwright.stop = AsyncMock()
    set_browser(fake_browser)
    browser_module._playwright = fake_playwright

    await close_browser()

    fake_browser.close.assert_awaited_once()
    fake_playwright.stop.assert_awaited_once()
    assert browser_module._browser is None
    assert browser_module._playwright is None


@pytest.mark.asyncio
async def test_close_browser_is_idempotent_when_never_launched() -> None:
    await close_browser()  # must not raise
    assert browser_module._browser is None


@pytest.mark.asyncio
async def test_render_page_yields_an_isolated_page_and_always_tears_down() -> None:
    fake_page = Mock()
    fake_page.close = AsyncMock()
    fake_context = Mock()
    fake_context.new_page = AsyncMock(return_value=fake_page)
    fake_context.close = AsyncMock()
    fake_browser = Mock()
    fake_browser.new_context = AsyncMock(return_value=fake_context)
    set_browser(fake_browser)

    async with render_page() as page:
        assert page is fake_page

    fake_browser.new_context.assert_awaited_once()
    fake_context.new_page.assert_awaited_once()
    fake_page.close.assert_awaited_once()
    fake_context.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_render_page_tears_down_even_when_the_body_raises() -> None:
    fake_page = Mock()
    fake_page.close = AsyncMock()
    fake_context = Mock()
    fake_context.new_page = AsyncMock(return_value=fake_page)
    fake_context.close = AsyncMock()
    fake_browser = Mock()
    fake_browser.new_context = AsyncMock(return_value=fake_context)
    set_browser(fake_browser)

    with pytest.raises(ValueError, match="boom"):
        async with render_page():
            raise ValueError("boom")

    fake_page.close.assert_awaited_once()
    fake_context.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_render_page_bounds_concurrency_with_a_semaphore() -> None:
    """Two renders in flight is fine; a third must wait for a slot to free up."""
    fake_browser = Mock()

    def _new_context(**_kwargs):
        context = Mock()
        page = Mock()
        page.close = AsyncMock()
        context.new_page = AsyncMock(return_value=page)
        context.close = AsyncMock()
        return context

    fake_browser.new_context = AsyncMock(side_effect=_new_context)
    set_browser(fake_browser)

    import asyncio

    original_slots = browser_module._render_slots
    browser_module._render_slots = asyncio.Semaphore(1)
    try:
        entered_second = False

        async def hold_first():
            async with render_page():
                await asyncio.sleep(0.05)

        async def try_second():
            nonlocal entered_second
            async with render_page():
                entered_second = True

        first_task = asyncio.create_task(hold_first())
        await asyncio.sleep(0.01)  # let the first task acquire the slot
        assert not entered_second
        await asyncio.gather(first_task, try_second())
        assert entered_second
    finally:
        browser_module._render_slots = original_slots
