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
