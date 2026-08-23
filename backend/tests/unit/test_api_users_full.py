import uuid
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.api.v1.users import get_storage, upload_own_avatar, read_avatar
from app.core.exceptions import BadRequestError
from app.models.user import User

def test_get_storage():
    s = get_storage()
    assert s is not None

@pytest.mark.asyncio
async def test_upload_own_avatar_empty():
    user = Mock()
    user.id = uuid.uuid4()
    session = AsyncMock()
    storage = AsyncMock()
    request = Mock()
    
    file = AsyncMock()
    file.content_type = "image/png"
    file.read.return_value = b""
    with pytest.raises(BadRequestError, match="The profile picture is empty"):
        await upload_own_avatar(request, file, user, session, storage)

@pytest.mark.asyncio
async def test_read_avatar_not_found():
    user_id = uuid.uuid4()
    session = AsyncMock()
    storage = AsyncMock()
    
    # 1. user not found
    session.get.return_value = None
    res = await read_avatar(user_id, Mock(), session, storage)
    assert res.status_code == 404
    
    # 2. user has no avatar
    user = Mock()
    user.avatar_object_key = None
    session.get.return_value = user
    res2 = await read_avatar(user_id, Mock(), session, storage)
    assert res2.status_code == 404
