"""Database-backed fixtures for API integration tests."""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio

from app.core.security import create_access_token, decode_token_identity
from app.db.session import get_session_factory
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.auth.sessions import SessionService
from app.schemas.user import UserCreate
from app.services.audit import ClientInfo


async def _create_api_user(*, is_superuser: bool) -> AsyncIterator[User]:
    """Shared body for `api_user`/`api_member_user`: create an authenticated
    user in the same database as the API client, then delete it afterwards."""
    # API tests mutate data, so they must use the explicitly provisioned test
    # database just like tests/integration. Avoid attempting to resolve the
    # compose-only `postgres` hostname when the integration stack is absent.
    if not os.environ.get("WIKIHUB_TEST_DATABASE_URL"):
        pytest.skip("WIKIHUB_TEST_DATABASE_URL is not set")

    factory = get_session_factory()
    username = f"api_{uuid.uuid4().hex[:12]}"
    async with factory() as session:
        user = await AuthService(session).create_user(
            UserCreate(
                username=username,
                email=f"{username}@example.com",
                full_name="API integration user",
                password="password-1234",
                is_superuser=is_superuser,
            )
        )
        await session.commit()
        yield user
        await session.delete(user)
        await session.commit()


@pytest_asyncio.fixture
async def api_user() -> AsyncIterator[User]:
    """A superuser - most API tests need to create spaces/groups outright,
    which an ordinary member cannot. See `api_member_user` for a fixture that
    deliberately is not one."""
    async for user in _create_api_user(is_superuser=True):
        yield user


@pytest_asyncio.fixture
async def api_member_user() -> AsyncIterator[User]:
    """An ordinary, non-admin user - for the handful of tests (a member's own
    profile, say) whose whole point is what an *unprivileged* account sees."""
    async for user in _create_api_user(is_superuser=False):
        yield user


async def _issue_access_token(user: User) -> str:
    """Shared body for `api_access_token`/`api_member_access_token`: issue a
    browser token with its required server-side session record."""
    token, expires_at = create_access_token(str(user.id))
    identity = decode_token_identity(token)
    async with get_session_factory()() as session:
        await SessionService(session).create(
            user_id=user.id,
            token_jti=identity.jti,
            expires_at=expires_at,
            client=ClientInfo(ip="127.0.0.1", user_agent="pytest"),
        )
        await session.commit()
    return token


@pytest_asyncio.fixture
async def api_access_token(api_user: User) -> str:
    return await _issue_access_token(api_user)


@pytest_asyncio.fixture
async def api_member_access_token(api_member_user: User) -> str:
    return await _issue_access_token(api_member_user)
