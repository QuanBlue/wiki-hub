import pytest
from httpx import AsyncClient

from app.core.security import create_access_token
from app.models.user import User


@pytest.mark.integration
@pytest.mark.asyncio
async def test_page_revisions_workflow(client: AsyncClient, api_user: User) -> None:
    token, _ = create_access_token(str(api_user.id))
    cookies = {"wikihub_access": token}
    space_key = f"REV{api_user.id.hex[:8].upper()}"

    # 1. Create a space
    space_resp = await client.post(
        "/api/v1/spaces",
        json={"name": "Revision Space", "key": space_key, "description": "Testing revisions"},
        cookies=cookies,
    )
    assert space_resp.status_code == 201

    # 2. Create a page (should create revision v1)
    page_resp = await client.post(
        f"/api/v1/spaces/{space_key}/pages",
        json={"title": "Page Version One", "content": "<p>Initial content</p>", "content_format": "html"},
        cookies=cookies,
    )
    assert page_resp.status_code == 201
    page_data = page_resp.json()
    slug = page_data["slug"]

    # 3. List revisions (should have 1 item)
    rev_list_resp = await client.get(f"/api/v1/spaces/{space_key}/pages/{slug}/revisions", cookies=cookies)
    assert rev_list_resp.status_code == 200
    revs = rev_list_resp.json()
    assert len(revs) == 1
    assert revs[0]["version"] == 1
    assert revs[0]["title"] == "Page Version One"

    # 4. Update page (should create revision v2)
    update_resp = await client.patch(
        f"/api/v1/spaces/{space_key}/pages/{slug}",
        json={"title": "Page Version Two", "content": "<p>Updated content line 1</p>\n<p>Updated content line 2</p>"},
        cookies=cookies,
    )
    assert update_resp.status_code == 200

    # 5. List revisions again (should have 2 items: v2 and v1)
    rev_list_resp2 = await client.get(f"/api/v1/spaces/{space_key}/pages/{slug}/revisions", cookies=cookies)
    assert rev_list_resp2.status_code == 200
    revs2 = rev_list_resp2.json()
    assert len(revs2) == 2
    assert revs2[0]["version"] == 2
    assert revs2[1]["version"] == 1

    # 6. Calculate diff between v1 and v2
    diff_resp = await client.get(
        f"/api/v1/spaces/{space_key}/pages/{slug}/revisions/diff?from_version=1&to_version=2",
        cookies=cookies,
    )
    assert diff_resp.status_code == 200
    diff_data = diff_resp.json()
    assert diff_data["from_version"] == 1
    assert diff_data["to_version"] == 2
    assert diff_data["title_changed"] is True
    assert len(diff_data["chunks"]) > 0

    # 7. Restore version 1
    restore_resp = await client.post(
        f"/api/v1/spaces/{space_key}/pages/{slug}/revisions/1/restore",
        cookies=cookies,
    )
    assert restore_resp.status_code == 200
    restored_page = restore_resp.json()
    assert restored_page["title"] == "Page Version One"
    assert restored_page["content"] == "<p>Initial content</p>"

    # 8. List revisions after restore (should have 3 items: v3, v2, v1)
    rev_list_resp3 = await client.get(
        f"/api/v1/spaces/{space_key}/pages/{slug}/revisions", cookies=cookies
    )
    assert rev_list_resp3.status_code == 200
    revs3 = rev_list_resp3.json()
    assert len(revs3) == 3
    assert revs3[0]["version"] == 3
    assert "Restored version 1" in (revs3[0]["change_summary"] or "")
