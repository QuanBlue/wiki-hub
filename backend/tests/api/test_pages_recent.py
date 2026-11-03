import uuid

import pytest
from httpx import AsyncClient

from app.models.user import User


@pytest.mark.integration
@pytest.mark.asyncio
async def test_list_recent_pages_endpoint(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    response = await client.get("/api/v1/pages/recent")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_recent_pages_say_how_many_versions_each_page_has(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    """One version means the latest change created the page: the home page offers no change
    to view for it, even when (like an imported page) it carries an older creation date."""
    client.cookies.set("wikihub_access", api_access_token)
    key = f"RC{uuid.uuid4().hex[:6].upper()}"
    created = await client.post("/api/v1/spaces", json={"key": key, "name": "Revision counts"})
    assert created.status_code in (200, 201), created.text
    try:
        fresh = await client.post(
            f"/api/v1/spaces/{key}/pages", json={"title": "Fresh", "content": "<p>a</p>"}
        )
        edited = await client.post(
            f"/api/v1/spaces/{key}/pages", json={"title": "Edited", "content": "<p>a</p>"}
        )
        assert fresh.status_code in (200, 201) and edited.status_code in (200, 201)
        update = await client.patch(
            f"/api/v1/spaces/{key}/pages/{edited.json()['slug']}", json={"content": "<p>b</p>"}
        )
        assert update.status_code == 200, update.text

        items = (await client.get("/api/v1/pages/recent")).json()
        counts = {
            item["title"]: item["revision_count"]
            for item in items
            if item["space_key"] == key and item["title"] in ("Fresh", "Edited")
        }
        assert counts == {"Fresh": 1, "Edited": 2}
    finally:
        await client.delete(f"/api/v1/spaces/{key}")
