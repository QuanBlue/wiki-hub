import pytest
from httpx import AsyncClient

from app.models.user import User


@pytest.mark.integration
@pytest.mark.asyncio
async def test_member_profile_includes_contact_and_activity_fields(
    client: AsyncClient, api_member_user: User, api_member_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_member_access_token)

    response = await client.get(f"/api/v1/users/{api_member_user.username}/profile")

    assert response.status_code == 200
    profile = response.json()
    assert profile["username"] == api_member_user.username
    assert profile["full_name"] == api_member_user.full_name
    assert profile["email"] == api_member_user.email
    assert "last_active_at" in profile
    assert profile["is_workspace_admin"] is False
    assert "global_permissions" not in profile
    assert "groups" not in profile


@pytest.mark.integration
@pytest.mark.asyncio
async def test_member_activity_uses_cursor_response_shape(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)

    response = await client.get(f"/api/v1/users/{api_user.username}/activity")

    assert response.status_code == 200
    assert response.json() == {"items": [], "next_cursor": None}
