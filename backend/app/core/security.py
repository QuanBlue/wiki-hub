"""Password hashing and JWT issuing/verification.

Argon2id is used for passwords (memory-hard, the current OWASP recommendation).
Access tokens are short-lived HS256 JWTs signed with ``WIKIHUB_SECRET_KEY``.
"""

from __future__ import annotations

import uuid
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Final

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import settings
from app.core.exceptions import AuthenticationError

_hasher = PasswordHasher()

TOKEN_TYPE_ACCESS: Final = "access"  # noqa: S105 - a token *type* label, not a credential
TOKEN_TYPE_EXPORT: Final = "export"  # noqa: S105 - a token *type* label, not a credential

#: A throwaway hash used to burn CPU when the username does not exist, so a
#: caller cannot distinguish "no such user" from "wrong password" by timing.
_DUMMY_HASH: Final = _hasher.hash("wikihub-timing-equaliser")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    """Check a password, in constant-ish time whether or not the hash exists."""
    if not password_hash:
        # Still do the work: an account with no local credential must not answer
        # faster than one with a password. The result is discarded by design.
        with suppress(VerifyMismatchError, VerificationError, InvalidHashError):
            _hasher.verify(_DUMMY_HASH, password)
        return False

    try:
        _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    return True


def needs_rehash(password_hash: str) -> bool:
    """True when the hash was produced with outdated Argon2 parameters."""
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


@dataclass(frozen=True)
class TokenIdentity:
    """Who a token speaks for, and who is really behind it.

    ``impersonator`` is set only on tokens minted by the impersonation endpoint.
    It is carried *in the signed token* rather than in a server-side session so
    it cannot be stripped: dropping the claim would invalidate the signature,
    and a request that arrives with no claim is simply a normal session.
    """

    subject: uuid.UUID
    jti: str
    impersonator: uuid.UUID | None = None

    @property
    def is_impersonating(self) -> bool:
        return self.impersonator is not None


def create_access_token(
    subject: str,
    *,
    expires_in: int | None = None,
    impersonator: str | None = None,
) -> tuple[str, datetime]:
    """Return ``(token, expires_at)`` for the given user id.

    ``impersonator`` records the administrator acting as ``subject``. The claim
    name follows RFC 8693's ``act`` (actor) claim for delegation.
    """
    ttl = expires_in if expires_in is not None else settings.access_token_ttl_seconds
    now = datetime.now(UTC)
    expires_at = now + timedelta(seconds=ttl)

    payload: dict[str, Any] = {
        "sub": subject,
        "type": TOKEN_TYPE_ACCESS,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": str(uuid.uuid4()),
    }
    if impersonator is not None:
        payload["act"] = {"sub": impersonator}

    token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
    return token, expires_at


def decode_token_identity(token: str) -> TokenIdentity:
    """Validate an access token and return the identity it carries."""
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise AuthenticationError("Your session has expired. Please sign in again.") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthenticationError("Invalid authentication token.") from exc

    if payload.get("type") != TOKEN_TYPE_ACCESS:
        raise AuthenticationError("Invalid authentication token.")

    try:
        subject = uuid.UUID(str(payload["sub"]))
        jti = str(uuid.UUID(str(payload["jti"])))
    except (KeyError, ValueError) as exc:
        raise AuthenticationError("Invalid authentication token.") from exc

    impersonator: uuid.UUID | None = None
    actor = payload.get("act")
    if actor is not None:
        # A malformed `act` is rejected rather than ignored: silently dropping
        # it would turn a broken impersonation token into a full, unattributed
        # session as the impersonated user.
        if not isinstance(actor, dict):
            raise AuthenticationError("Invalid authentication token.")
        try:
            impersonator = uuid.UUID(str(actor["sub"]))
        except (KeyError, ValueError, TypeError) as exc:
            raise AuthenticationError("Invalid authentication token.") from exc

    return TokenIdentity(subject=subject, jti=jti, impersonator=impersonator)


def decode_access_token(token: str) -> uuid.UUID:
    """Validate an access token and return the user id it identifies."""
    return decode_token_identity(token).subject


@dataclass(frozen=True)
class ExportTokenIdentity:
    """A narrow, single-page capability handed to the headless-browser render.

    Deliberately its own token family, not a short-lived access token: it must
    never be usable as a session (``decode_token_identity`` rejects anything
    whose ``type`` is not ``"access"``, and this rejects anything whose
    ``type`` is not ``"export"`` - the two are disjoint by construction), it
    is scoped to exactly one page, and it carries the requested export format
    so a captured render can't quietly be reused for a different one.
    """

    subject: uuid.UUID
    space_id: uuid.UUID
    page_id: uuid.UUID
    fmt: str
    jti: str


def create_export_token(
    *,
    user_id: uuid.UUID,
    space_id: uuid.UUID,
    page_id: uuid.UUID,
    fmt: str,
    ttl_seconds: int,
) -> tuple[str, datetime]:
    """Return ``(token, expires_at)`` scoped to one user/space/page/format."""
    now = datetime.now(UTC)
    expires_at = now + timedelta(seconds=ttl_seconds)

    payload: dict[str, Any] = {
        "sub": str(user_id),
        "sid": str(space_id),
        "pid": str(page_id),
        "fmt": fmt,
        "type": TOKEN_TYPE_EXPORT,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": str(uuid.uuid4()),
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
    return token, expires_at


def decode_export_token(token: str) -> ExportTokenIdentity:
    """Validate an export token and return the page/format it grants access to."""
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "sub", "sid", "pid", "fmt"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise AuthenticationError("This export link has expired.") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthenticationError("Invalid export token.") from exc

    if payload.get("type") != TOKEN_TYPE_EXPORT:
        raise AuthenticationError("Invalid export token.")

    try:
        subject = uuid.UUID(str(payload["sub"]))
        space_id = uuid.UUID(str(payload["sid"]))
        page_id = uuid.UUID(str(payload["pid"]))
        jti = str(uuid.UUID(str(payload["jti"])))
        fmt = str(payload["fmt"])
    except (KeyError, ValueError) as exc:
        raise AuthenticationError("Invalid export token.") from exc

    if not fmt:
        raise AuthenticationError("Invalid export token.")

    return ExportTokenIdentity(
        subject=subject, space_id=space_id, page_id=page_id, fmt=fmt, jti=jti
    )
