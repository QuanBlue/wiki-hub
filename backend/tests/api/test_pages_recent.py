import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_recent_pages_endpoint(client: AsyncClient, auth_headers: dict[str, str]) -> None:
    response = await client.get("/api/v1/pages/recent", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
