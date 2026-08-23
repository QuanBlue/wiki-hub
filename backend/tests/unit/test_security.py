"""Password hashing and access-token behaviour."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import jwt
import pytest

from app.core.config import settings
from app.core.exceptions import AuthenticationError
from app.core.security import (
    create_access_token,
    decode_access_token,
    decode_token_identity,
    hash_password,
    needs_rehash,
    verify_password,
)


class TestPasswordHashing:
    def test_hash_is_not_the_plaintext(self) -> None:
        hashed = hash_password("correct horse battery staple")
        assert hashed != "correct horse battery staple"
        assert hashed.startswith("$argon2")

    def test_hash_is_salted(self) -> None:
        # Identical passwords must never produce identical hashes, otherwise the
        # table leaks which accounts share a password.
        assert hash_password("same-password") != hash_password("same-password")

    def test_verify_accepts_the_right_password(self) -> None:
        assert verify_password("s3cret-password", hash_password("s3cret-password"))

    def test_verify_rejects_the_wrong_password(self) -> None:
        assert not verify_password("wrong-password", hash_password("s3cret-password"))

    def test_verify_rejects_a_missing_hash(self) -> None:
        # An OIDC-only account has no local credential and must never authenticate.
        assert not verify_password("anything", None)

    def test_needs_rehash_is_false_for_a_freshly_produced_hash(self) -> None:
        assert needs_rehash(hash_password("s3cret-password")) is False

    def test_verify_rejects_a_corrupt_hash(self) -> None:
        assert not verify_password("anything", "not-a-valid-argon2-hash")


class TestAccessTokens:
    def test_round_trip(self) -> None:
        user_id = uuid.uuid4()
        token, expires_at = create_access_token(str(user_id))
        assert decode_access_token(token) == user_id
        assert expires_at > datetime.now(UTC)

    def test_expired_token_is_rejected(self) -> None:
        token, _ = create_access_token(str(uuid.uuid4()), expires_in=-1)
        with pytest.raises(AuthenticationError):
            decode_access_token(token)

    def test_token_signed_with_another_key_is_rejected(self) -> None:
        forged = jwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "type": "access",
                "exp": int(datetime.now(UTC).timestamp()) + 600,
            },
            "a-completely-different-signing-key",
            algorithm=settings.jwt_algorithm,
        )
        with pytest.raises(AuthenticationError):
            decode_access_token(forged)

    def test_wrong_token_type_is_rejected(self) -> None:
        # A refresh token must not be usable as an access token.
        token = jwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "type": "refresh",
                "exp": int(datetime.now(UTC).timestamp()) + 600,
            },
            settings.secret_key,
            algorithm=settings.jwt_algorithm,
        )
        with pytest.raises(AuthenticationError):
            decode_access_token(token)

    def test_garbage_is_rejected(self) -> None:
        with pytest.raises(AuthenticationError):
            decode_access_token("not.a.jwt")


class TestImpersonationClaim:
    def test_plain_token_carries_no_actor(self) -> None:
        token, _ = create_access_token(str(uuid.uuid4()))
        assert decode_token_identity(token).is_impersonating is False

    def test_round_trip(self) -> None:
        target, admin = uuid.uuid4(), uuid.uuid4()
        token, _ = create_access_token(str(target), impersonator=str(admin))

        identity = decode_token_identity(token)
        assert identity.subject == target
        assert identity.impersonator == admin
        assert identity.is_impersonating is True

    def test_the_claim_is_signed(self) -> None:
        """Stripping `act` cannot be done quietly - it breaks the signature."""
        target, admin = uuid.uuid4(), uuid.uuid4()
        token, _ = create_access_token(str(target), impersonator=str(admin))

        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
        del payload["act"]
        stripped = jwt.encode(
            payload, "a-completely-different-signing-key", algorithm=settings.jwt_algorithm
        )

        with pytest.raises(AuthenticationError):
            decode_token_identity(stripped)

    @pytest.mark.parametrize("actor", ["not-a-dict", {"sub": "not-a-uuid"}, {}, 42])
    def test_a_malformed_actor_is_rejected_not_ignored(self, actor: object) -> None:
        """Ignoring it would silently upgrade a broken token into a full,
        unattributed session as the impersonated user."""
        token = jwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "jti": str(uuid.uuid4()),
                "type": "access",
                "exp": int(datetime.now(UTC).timestamp()) + 600,
                "act": actor,
            },
            settings.secret_key,
            algorithm=settings.jwt_algorithm,
        )
        with pytest.raises(AuthenticationError):
            decode_token_identity(token)
