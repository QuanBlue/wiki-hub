"""Database-backed fixtures for API integration tests."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import pytest_asyncio

from app.db.session import get_session_factory
from app.models.user import User
from app.modules.auth.service import AuthService
from app.schemas.user import UserCreate


@pytest_asyncio.fixture
async def api_user() -> AsyncIterator[User]:
    """Create an authenticated user in the same database as the API client."""
    factory = get_session_factory()
    username = f"api_{uuid.uuid4().hex[:12]}"
    async with factory() as session:
        user = await AuthService(session).create_user(
            UserCreate(
                username=username,
                email=f"{username}@example.com",
                full_name="API integration user",
                password="password-1234",
                is_superuser=True,
            )
        )
        await session.commit()
        yield user
        await session.delete(user)
        await session.commit()
