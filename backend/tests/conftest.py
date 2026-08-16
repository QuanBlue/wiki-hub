"""Shared pytest fixtures.

Unit tests run entirely in-process. Tests marked ``integration`` need the
compose infrastructure (PostgreSQL, Redis, MinIO) and are skipped automatically
when it is not reachable.
"""

from __future__ import annotations

import os

# Settings are read at import time, so the test environment must be set first.
os.environ["WIKIHUB_ENV"] = "test"
os.environ["WIKIHUB_SECRET_KEY"] = "test-secret-key-for-unit-tests-only-not-real"
os.environ["WIKIHUB_LOG_FORMAT"] = "console"
os.environ["WIKIHUB_LOG_LEVEL"] = "WARNING"

from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.db.session import dispose_engine


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="session")
def app():
    from app.main import create_app

    return create_app()


@pytest.fixture
async def client(app) -> AsyncIterator[AsyncClient]:
    """HTTP client bound directly to the ASGI app - no network, no server."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac


@pytest_asyncio.fixture(autouse=True)
async def cleanup_engine():
    yield
    await dispose_engine()
