import uuid
import pytest
from httpx import AsyncClient
from app.core.security import create_access_token


@pytest.mark.integration
@pytest.mark.asyncio
async def test_list_recent_pages_endpoint(client: AsyncClient) -> None:
    token, _ = create_access_token(str(uuid.uuid4()))
    response = await client.get("/api/v1/pages/recent", cookies={"wikihub_access": token})
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
