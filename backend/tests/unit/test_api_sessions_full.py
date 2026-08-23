import uuid
from unittest.mock import AsyncMock, Mock

import pytest
from app.modules.auth.sessions import SessionService
from app.core.exceptions import AuthenticationError

@pytest.mark.asyncio
async def test_require_active():
    session = AsyncMock()
    service = SessionService(session)
    user_id = uuid.uuid4()
    
    session.scalar.return_value = None
    with pytest.raises(AuthenticationError, match="signed out"):
        await service.require_active(user_id=user_id, token_jti="jti")
        
    m = Mock()
    session.scalar.return_value = m
    await service.require_active(user_id=user_id, token_jti="jti")
    assert m.last_seen_at is not None

@pytest.mark.asyncio
async def test_list_for_user():
    session = AsyncMock()
    service = SessionService(session)
    user_id = uuid.uuid4()
    
    m_res = Mock()
    m_res.scalars.return_value = ["s1", "s2"]
    session.execute.return_value = m_res
    
    res = await service.list_for_user(user_id, "jti")
    assert res == ["s1", "s2"]

@pytest.mark.asyncio
async def test_revoke_others():
    session = AsyncMock()
    service = SessionService(session)
    user_id = uuid.uuid4()
    
    m_res = Mock()
    m_res.rowcount = 5
    session.execute.return_value = m_res
    
    res = await service.revoke_others(user_id=user_id, current_jti="jti")
    assert res == 5
    session.flush.assert_called_once()
