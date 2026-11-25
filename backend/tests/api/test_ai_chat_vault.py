"""``GET /api/v1/ai/chat/key``: only the person themselves may open their saved chats."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core.security import create_access_token, decode_token_identity
from app.db.session import get_session_factory
from app.models.user import User
from app.modules.auth.sessions import SessionService
from app.services.audit import ClientInfo

URL = "/api/v1/ai/chat/key"


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.integration
@pytest.mark.asyncio
async def test_it_needs_a_signed_in_user(client: AsyncClient) -> None:
    assert (await client.get(URL)).status_code == 401


@pytest.mark.integration
@pytest.mark.asyncio
async def test_each_person_gets_their_own_key_and_it_is_not_cached(
    client: AsyncClient, api_access_token: str, api_member_access_token: str
) -> None:
    mine = await client.get(URL, headers=bearer(api_member_access_token))
    again = await client.get(URL, headers=bearer(api_member_access_token))
    other = await client.get(URL, headers=bearer(api_access_token))

    assert mine.status_code == 200
    assert mine.headers["Cache-Control"] == "no-store"
    assert set(mine.json()) == {"key", "key_id"}
    assert again.json() == mine.json()
    assert other.json()["key"] != mine.json()["key"]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_an_administrator_viewing_as_someone_does_not_get_their_key(
    client: AsyncClient, api_user: User, api_member_user: User
) -> None:
    token, expires_at = create_access_token(str(api_member_user.id), impersonator=str(api_user.id))
    async with get_session_factory()() as session:
        await SessionService(session).create(
            user_id=api_member_user.id,
            token_jti=decode_token_identity(token).jti,
            expires_at=expires_at,
            client=ClientInfo(ip="127.0.0.1", user_agent="pytest"),
        )
        await session.commit()

    response = await client.get(URL, headers=bearer(token))

    assert response.status_code == 403
    assert "key" not in response.json()
