"""User administration API coverage for group membership presentation."""

from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.core.security import create_access_token
from app.models.user import User


async def test_user_listing_includes_active_group_names(
    client: AsyncClient, api_user: User
) -> None:
    token, _ = create_access_token(str(api_user.id))
    headers = {"Authorization": f"Bearer {token}"}
    group_name = f"Users API {uuid.uuid4().hex[:8]}"

    created = await client.post(
        "/api/v1/groups",
        headers=headers,
        json={"name": group_name, "description": "API test", "owner_id": str(api_user.id)},
    )
    assert created.status_code == 201
    group_id = created.json()["id"]

    try:
        response = await client.get(
            "/api/v1/users", headers=headers, params={"q": api_user.username}
        )
        assert response.status_code == 200
        matching = [item for item in response.json()["items"] if item["id"] == str(api_user.id)]
        assert len(matching) == 1
        assert group_name in matching[0]["groups"]
    finally:
        deleted = await client.delete(f"/api/v1/groups/{group_id}", headers=headers)
        assert deleted.status_code == 204
