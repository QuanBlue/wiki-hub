import uuid
from unittest.mock import AsyncMock, Mock

import pytest
from sqlalchemy.orm.session import Session

from app.api.v1.groups import _is_uuid, _safe_refresh

@pytest.mark.asyncio
async def test_safe_refresh():
    # 1. return an awaitable
    session = Mock()
    async def mock_refresh(instance):
        pass
    session.refresh = mock_refresh
    await _safe_refresh(session, Mock())

    # 2. raise an exception
    session2 = Mock()
    session2.refresh = Mock(side_effect=Exception("error"))
    await _safe_refresh(session2, Mock())

def test_is_uuid():
    u = uuid.uuid4()
    assert _is_uuid(u) is True
    assert _is_uuid(str(u)) is True
    assert _is_uuid("not-uuid") is False
    assert _is_uuid(123) is False
