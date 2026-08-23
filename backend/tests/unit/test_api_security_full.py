import uuid
import pytest
from app.core.security import decode_token_identity
from app.core.exceptions import AuthenticationError

def test_verify_token_act():
    import jwt
    from app.core.config import settings

    # 1. act is not dict
    payload = {
        "sub": str(uuid.uuid4()),
        "jti": str(uuid.uuid4()),
        "type": "access",
        "act": "not-dict"
    }
    token = jwt.encode(payload, settings.secret_key, algorithm="HS256")
    with pytest.raises(AuthenticationError, match="Invalid authentication token"):
        decode_token_identity(token)

    # 2. act["sub"] missing
    payload = {
        "sub": str(uuid.uuid4()),
        "jti": str(uuid.uuid4()),
        "type": "access",
        "act": {}
    }
    token = jwt.encode(payload, settings.secret_key, algorithm="HS256")
    with pytest.raises(AuthenticationError, match="Invalid authentication token"):
        decode_token_identity(token)
