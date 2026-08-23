"""Export-token behaviour: a narrow, single-page capability for the headless
render, deliberately kept disjoint from real session (access) tokens."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import jwt
import pytest

from app.core.config import settings
from app.core.exceptions import AuthenticationError
from app.core.security import (
    create_access_token,
    create_export_token,
    decode_access_token,
    decode_export_token,
    decode_token_identity,
)


class TestExportTokens:
    def test_round_trip(self) -> None:
        user_id, space_id, page_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        token, expires_at = create_export_token(
            user_id=user_id, space_id=space_id, page_id=page_id, fmt="pdf", ttl_seconds=120
        )

        identity = decode_export_token(token)
        assert identity.subject == user_id
        assert identity.space_id == space_id
        assert identity.page_id == page_id
        assert identity.fmt == "pdf"
        assert expires_at > datetime.now(UTC)

    def test_expired_token_is_rejected(self) -> None:
        token, _ = create_export_token(
            user_id=uuid.uuid4(),
            space_id=uuid.uuid4(),
            page_id=uuid.uuid4(),
            fmt="html",
            ttl_seconds=-1,
        )
        with pytest.raises(AuthenticationError, match="expired"):
            decode_export_token(token)

    def test_token_signed_with_another_key_is_rejected(self) -> None:
        forged = jwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "sid": str(uuid.uuid4()),
                "pid": str(uuid.uuid4()),
                "fmt": "docx",
                "type": "export",
                "exp": int(datetime.now(UTC).timestamp()) + 600,
            },
            "a-completely-different-signing-key",
            algorithm=settings.jwt_algorithm,
        )
        with pytest.raises(AuthenticationError):
            decode_export_token(forged)

    def test_garbage_is_rejected(self) -> None:
        with pytest.raises(AuthenticationError):
            decode_export_token("not.a.jwt")

    @pytest.mark.parametrize("missing_claim", ["sid", "pid", "fmt"])
    def test_a_missing_scoping_claim_is_rejected(self, missing_claim: str) -> None:
        payload = {
            "sub": str(uuid.uuid4()),
            "sid": str(uuid.uuid4()),
            "pid": str(uuid.uuid4()),
            "fmt": "pdf",
            "jti": str(uuid.uuid4()),
            "type": "export",
            "exp": int(datetime.now(UTC).timestamp()) + 600,
        }
        del payload[missing_claim]
        token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
        with pytest.raises(AuthenticationError):
            decode_export_token(token)

    def test_a_non_uuid_scoping_claim_is_rejected(self) -> None:
        token = jwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "sid": "not-a-uuid",
                "pid": str(uuid.uuid4()),
                "fmt": "pdf",
                "jti": str(uuid.uuid4()),
                "type": "export",
                "exp": int(datetime.now(UTC).timestamp()) + 600,
            },
            settings.secret_key,
            algorithm=settings.jwt_algorithm,
        )
        with pytest.raises(AuthenticationError):
            decode_export_token(token)

    def test_an_empty_format_is_rejected(self) -> None:
        token = jwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "sid": str(uuid.uuid4()),
                "pid": str(uuid.uuid4()),
                "fmt": "",
                "jti": str(uuid.uuid4()),
                "type": "export",
                "exp": int(datetime.now(UTC).timestamp()) + 600,
            },
            settings.secret_key,
            algorithm=settings.jwt_algorithm,
        )
        with pytest.raises(AuthenticationError):
            decode_export_token(token)


class TestTokenFamiliesAreDisjoint:
    """An export token must never work as a session, and vice versa - the two
    token families are deliberately incompatible, not merely differently
    scoped, so a leaked export link can never be replayed as a login."""

    def test_an_export_token_is_rejected_as_an_access_token(self) -> None:
        token, _ = create_export_token(
            user_id=uuid.uuid4(),
            space_id=uuid.uuid4(),
            page_id=uuid.uuid4(),
            fmt="pdf",
            ttl_seconds=120,
        )
        with pytest.raises(AuthenticationError):
            decode_access_token(token)
        with pytest.raises(AuthenticationError):
            decode_token_identity(token)

    def test_an_access_token_is_rejected_as_an_export_token(self) -> None:
        token, _ = create_access_token(str(uuid.uuid4()))
        with pytest.raises(AuthenticationError):
            decode_export_token(token)

    def test_an_export_shaped_token_with_the_wrong_type_is_rejected(self) -> None:
        """Even with every export claim present, only ``type: "export"`` counts."""
        token = jwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "sid": str(uuid.uuid4()),
                "pid": str(uuid.uuid4()),
                "fmt": "pdf",
                "jti": str(uuid.uuid4()),
                "type": "access",
                "exp": int(datetime.now(UTC).timestamp()) + 600,
            },
            settings.secret_key,
            algorithm=settings.jwt_algorithm,
        )
        with pytest.raises(AuthenticationError):
            decode_export_token(token)
