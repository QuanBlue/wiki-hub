"""The "me/*" personal-data endpoints on the users router: pins, likes, page
labels, tags, private drafts and profile stats - none of it had any API-level
coverage at all (only the group-membership listing in test_users.py, and the
profile-shape checks in test_user_profile.py)."""

from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.user import User


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_space_and_page(client: AsyncClient, headers: dict[str, str]) -> tuple[str, str]:
    key = f"P{uuid.uuid4().hex[:6].upper()}"
    created_space = await client.post(
        "/api/v1/spaces", headers=headers, json={"key": key, "name": "Personal data tests"}
    )
    assert created_space.status_code == 201
    created_page = await client.post(
        f"/api/v1/spaces/{key}/pages",
        headers=headers,
        json={"title": "Runbook", "content": "<p>steps</p>"},
    )
    assert created_page.status_code == 201
    return key, created_page.json()["slug"]


async def test_public_profile_404s_for_a_nonexistent_member(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    response = await client.get(
        f"/api/v1/users/does-not-exist-{uuid.uuid4().hex[:8]}/profile",
        headers=_bearer(api_access_token),
    )
    assert response.status_code == 404


async def test_profile_stats_count_pages_created_and_updated_in_active_spaces(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    headers = _bearer(api_access_token)
    await _create_space_and_page(client, headers)

    response = await client.get(f"/api/v1/users/{api_user.username}/stats", headers=headers)

    assert response.status_code == 200
    stats = response.json()
    assert stats["pages_created"] >= 1
    assert stats["pages_updated"] >= 1
    assert stats["spaces_contributed"] >= 1


async def test_member_drafts_are_visible_to_their_owner_and_to_an_admin_but_not_to_anyone_else(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    api_member_user: User,
    api_member_access_token: str,
) -> None:
    owner_headers = _bearer(api_access_token)
    key, slug = await _create_space_and_page(client, owner_headers)
    page = (
        await client.get(f"/api/v1/spaces/{key}/pages/{slug}", headers=owner_headers)
    ).json()
    saved = await client.put(
        f"/api/v1/spaces/{key}/pages/{slug}/draft",
        headers=owner_headers,
        json={
            "content": "<p>draft body</p>",
            "content_format": "html",
            "edit_mode": "normal",
            "base_updated_at": page["updated_at"],
        },
    )
    assert saved.status_code == 200

    as_owner = await client.get(
        f"/api/v1/users/{api_user.username}/drafts", headers=owner_headers
    )
    assert as_owner.status_code == 200
    assert [d["content"] for d in as_owner.json()] == ["<p>draft body</p>"]

    # An ordinary member who is neither the owner nor an admin must not even
    # learn the drafts exist - a private draft is exactly that, private.
    as_stranger = await client.get(
        f"/api/v1/users/{api_user.username}/drafts",
        headers=_bearer(api_member_access_token),
    )
    assert as_stranger.status_code == 404

    # A superuser (api_user itself, reused here as the "admin" looking at
    # someone else - api_member_user has no drafts, so this only exercises
    # that the admin bypass does not 404 outright).
    as_admin = await client.get(
        f"/api/v1/users/{api_member_user.username}/drafts", headers=owner_headers
    )
    assert as_admin.status_code == 200
    assert as_admin.json() == []


async def test_pinning_a_nonexistent_page_404s(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    response = await client.post(
        f"/api/v1/users/me/pins/{uuid.uuid4()}", headers=_bearer(api_access_token)
    )
    assert response.status_code == 404


async def test_pin_list_and_unpin_a_page(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    headers = _bearer(api_access_token)
    key, slug = await _create_space_and_page(client, headers)
    page = (await client.get(f"/api/v1/spaces/{key}/pages/{slug}", headers=headers)).json()
    page_id = page["id"]

    pinned = await client.post(f"/api/v1/users/me/pins/{page_id}", headers=headers)
    assert pinned.status_code == 204
    # Pinning an already-pinned page is a no-op, not a conflict.
    pinned_again = await client.post(f"/api/v1/users/me/pins/{page_id}", headers=headers)
    assert pinned_again.status_code == 204

    listed = await client.get("/api/v1/users/me/pins", headers=headers)
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [page_id]

    unpinned = await client.delete(f"/api/v1/users/me/pins/{page_id}", headers=headers)
    assert unpinned.status_code == 204

    listed_after = await client.get("/api/v1/users/me/pins", headers=headers)
    assert listed_after.json() == []


async def test_like_and_list_a_page(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    headers = _bearer(api_access_token)
    key, slug = await _create_space_and_page(client, headers)

    liked = await client.put(f"/api/v1/spaces/{key}/pages/{slug}/like", headers=headers)
    assert liked.status_code == 200
    assert liked.json()["liked_by_me"] is True

    listed = await client.get("/api/v1/users/me/likes", headers=headers)
    assert listed.status_code == 200
    assert [item["slug"] for item in listed.json()] == [slug]

    unliked = await client.delete(f"/api/v1/spaces/{key}/pages/{slug}/like", headers=headers)
    assert unliked.status_code == 200
    assert unliked.json()["liked_by_me"] is False

    listed_after = await client.get("/api/v1/users/me/likes", headers=headers)
    assert listed_after.json() == []


async def test_add_list_and_remove_a_page_label(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    headers = _bearer(api_access_token)
    key, slug = await _create_space_and_page(client, headers)

    created = await client.post(
        f"/api/v1/spaces/{key}/pages/{slug}/labels", headers=headers, json={"name": "needs-review"}
    )
    assert created.status_code == 201
    label_id = created.json()["id"]

    listed = await client.get("/api/v1/users/me/page-labels", headers=headers)
    assert listed.status_code == 200
    assert [item["name"] for item in listed.json()] == ["needs-review"]

    removed = await client.delete(
        f"/api/v1/spaces/{key}/pages/{slug}/labels/{label_id}", headers=headers
    )
    assert removed.status_code == 204


async def test_lists_a_pages_own_labels_directly(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    # Distinct from GET /users/me/page-labels above - this is the page's own
    # view of its labels (the editor's label picker), not the cross-space
    # "everything I've labelled" list.
    headers = _bearer(api_access_token)
    key, slug = await _create_space_and_page(client, headers)
    await client.post(
        f"/api/v1/spaces/{key}/pages/{slug}/labels", headers=headers, json={"name": "needs-review"}
    )

    listed = await client.get(f"/api/v1/spaces/{key}/pages/{slug}/labels", headers=headers)

    assert listed.status_code == 200
    assert [item["name"] for item in listed.json()] == ["needs-review"]


async def test_adding_the_same_label_twice_is_a_conflict(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    headers = _bearer(api_access_token)
    key, slug = await _create_space_and_page(client, headers)
    first = await client.post(
        f"/api/v1/spaces/{key}/pages/{slug}/labels", headers=headers, json={"name": "needs-review"}
    )
    assert first.status_code == 201

    # Case-insensitive: the ilike() comparison treats these as the same label.
    duplicate = await client.post(
        f"/api/v1/spaces/{key}/pages/{slug}/labels",
        headers=headers,
        json={"name": "NEEDS-REVIEW"},
    )

    assert duplicate.status_code == 409

    # The rejected duplicate must not have been added alongside the original -
    # exactly one label survives, still under its original casing.
    listed_after = await client.get("/api/v1/users/me/page-labels", headers=headers)
    assert [item["name"] for item in listed_after.json()] == ["needs-review"]


async def test_create_list_and_delete_a_profile_tag(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    headers = _bearer(api_access_token)
    name = f"on-call-{uuid.uuid4().hex[:6]}"

    created = await client.post("/api/v1/users/me/tags", headers=headers, json={"name": name})
    assert created.status_code == 201
    tag_id = created.json()["id"]

    # A second tag differing only in case collides with the first - the
    # endpoint compares case-insensitively.
    duplicate = await client.post(
        "/api/v1/users/me/tags", headers=headers, json={"name": name.upper()}
    )
    assert duplicate.status_code == 409

    listed = await client.get("/api/v1/users/me/tags", headers=headers)
    assert listed.status_code == 200
    assert [item["name"] for item in listed.json()] == [name]

    deleted = await client.delete(f"/api/v1/users/me/tags/{tag_id}", headers=headers)
    assert deleted.status_code == 204

    listed_after = await client.get("/api/v1/users/me/tags", headers=headers)
    assert listed_after.json() == []
