"""API coverage for page access control, space owners, group usage and the
People directory's administrator / override listings."""

from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.user import User


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _make_space(client: AsyncClient, headers: dict[str, str]) -> str:
    key = f"ACC{uuid.uuid4().hex[:8]}".upper()
    response = await client.post(
        "/api/v1/spaces", headers=headers, json={"key": key, "name": f"Access {key}"}
    )
    assert response.status_code == 201, response.text
    return response.json()["key"]


async def test_page_access_endpoints_block_roster_mode_and_reset(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    api_member_user: User,
) -> None:
    headers = _headers(api_access_token)
    key = await _make_space(client, headers)
    group_id: str | None = None
    try:
        page = await client.post(
            f"/api/v1/spaces/{key}/pages", headers=headers, json={"title": "Guarded page"}
        )
        assert page.status_code == 201, page.text
        slug = page.json()["slug"]
        base = f"/api/v1/spaces/{key}/pages/{slug}/restrictions"

        group = await client.post(
            "/api/v1/groups",
            headers=headers,
            json={
                "name": f"Access {uuid.uuid4().hex[:8]}",
                "description": "API test",
                "owner_id": str(api_user.id),
            },
        )
        assert group.status_code == 201, group.text
        group_id = group.json()["id"]

        # Block, then un-block, a single user's Edit on the page.
        user_path = f"{base}/users/{api_member_user.id}/edit/block"
        assert (await client.put(user_path, headers=headers)).status_code == 204
        unblock_user = f"{base}/users/{api_member_user.id}/edit/block"
        assert (await client.delete(unblock_user, headers=headers)).status_code == 204

        # The same for a group.
        group_path = f"{base}/groups/{group_id}/edit/block"
        assert (await client.put(group_path, headers=headers)).status_code == 204
        unblock_group = f"{base}/groups/{group_id}/edit/block"
        assert (await client.delete(unblock_group, headers=headers)).status_code == 204

        users = await client.get(f"{base}/roster/users", headers=headers)
        assert users.status_code == 200, users.text
        assert isinstance(users.json(), list)
        groups = await client.get(f"{base}/roster/groups", headers=headers)
        assert groups.status_code == 200, groups.text
        assert isinstance(groups.json(), list)

        mode = await client.patch(f"{base}/mode", headers=headers, json={"restricted": True})
        assert mode.status_code == 204, mode.text
        reset = await client.post(f"{base}/reset", headers=headers)
        assert reset.status_code == 204, reset.text
    finally:
        if group_id is not None:
            await client.delete(f"/api/v1/groups/{group_id}", headers=headers)
        await client.delete(f"/api/v1/spaces/{key}", headers=headers)


async def test_space_owners_group_usage_and_space_listing(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    api_member_access_token: str,
) -> None:
    headers = _headers(api_access_token)
    key = await _make_space(client, headers)
    group_id: str | None = None
    try:
        owners = await client.get(f"/api/v1/spaces/{key}/owners", headers=headers)
        assert owners.status_code == 200, owners.text
        assert str(api_user.id) in {owner["user_id"] for owner in owners.json()}

        replaced = await client.put(
            f"/api/v1/spaces/{key}/owners",
            headers=headers,
            json={"owner_ids": [str(api_user.id)]},
        )
        assert replaced.status_code == 200, replaced.text
        assert [owner["username"] for owner in replaced.json()] == [api_user.username]

        # The listing carries each space's owners too.
        listing = await client.get("/api/v1/spaces", headers=headers)
        assert listing.status_code == 200, listing.text
        mine = next(item for item in listing.json() if item["key"] == key)
        assert any(owner["user_id"] == str(api_user.id) for owner in mine["owners"])

        group = await client.post(
            "/api/v1/groups",
            headers=headers,
            json={
                "name": f"Usage {uuid.uuid4().hex[:8]}",
                "description": "API test",
                "owner_id": str(api_user.id),
            },
        )
        assert group.status_code == 201, group.text
        group_id = group.json()["id"]
        usage = await client.get(f"/api/v1/groups/{group_id}/usage", headers=headers)
        assert usage.status_code == 200, usage.text
        assert usage.json()["spaces"] == []

        # An ordinary member who neither owns nor belongs to the group may not.
        denied = await client.get(
            f"/api/v1/groups/{group_id}/usage", headers=_headers(api_member_access_token)
        )
        assert denied.status_code == 403, denied.text
    finally:
        if group_id is not None:
            await client.delete(f"/api/v1/groups/{group_id}", headers=headers)
        await client.delete(f"/api/v1/spaces/{key}", headers=headers)


async def test_people_directory_administrators_overrides_and_single_read(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    api_member_user: User,
) -> None:
    headers = _headers(api_access_token)

    administrators = await client.get("/api/v1/users/administrators", headers=headers)
    assert administrators.status_code == 200, administrators.text
    assert str(api_user.id) in {account["id"] for account in administrators.json()}

    # With no override anywhere for this member, they are not listed.
    before = await client.get("/api/v1/users/permission-overrides", headers=headers)
    assert before.status_code == 200, before.text
    assert str(api_member_user.id) not in {account["id"] for account in before.json()}

    updated = await client.patch(
        f"/api/v1/users/{api_member_user.id}",
        headers=headers,
        json={"global_permission_overrides": {"create_space": True}},
    )
    assert updated.status_code == 200, updated.text
    after = await client.get("/api/v1/users/permission-overrides", headers=headers)
    assert after.status_code == 200, after.text
    assert str(api_member_user.id) in {account["id"] for account in after.json()}

    single = await client.get(f"/api/v1/users/{api_member_user.id}", headers=headers)
    assert single.status_code == 200, single.text
    assert single.json()["username"] == api_member_user.username

    missing = await client.get(f"/api/v1/users/{uuid.uuid4()}", headers=headers)
    assert missing.status_code == 404
