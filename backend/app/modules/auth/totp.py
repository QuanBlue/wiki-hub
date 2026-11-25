"""RFC 6238 TOTP (Time-based One-Time Password) and recovery code helpers.

Implemented with Python's standard library only (``hmac``, ``hashlib``,
``struct``, ``base64``, ``secrets``) — SHA-1, 6 digits, 30-second period,
±1 step clock-skew tolerance — so no additional third-party dependency is
required.

TOTP secrets are encrypted at rest using the application's reversible Fernet
helper (:mod:`app.modules.admin_mail.crypto`). Recovery codes are stored as
keyed HMAC-SHA256 digests derived from ``settings.secret_key`` so verification
is both constant-time and fast across all 10 codes.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import re
import secrets
import struct
import time
from datetime import datetime
from typing import TYPE_CHECKING, Final
from urllib.parse import quote, urlencode

from app.core.config import settings
from app.modules.admin_mail.crypto import decrypt_password, encrypt_password

if TYPE_CHECKING:  # pragma: no cover
    from app.models.user import User

TOTP_DIGITS: Final = 6
TOTP_PERIOD: Final = 30
TOTP_WINDOW: Final = 1
RECOVERY_CODE_COUNT: Final = 10

# Unambiguous uppercase alphanumeric alphabet (omits 0, O, 1, I).
_RECOVERY_ALPHABET: Final = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_RECOVERY_HASH_PREFIX: Final = "hmac-sha256:"
_RECOVERY_HMAC_DOMAIN: Final = b"wikihub-totp-recovery-v1"
_CODE_STRIP_RE: Final = re.compile(r"[\s-]+")


def generate_totp_secret() -> str:
    """Return a new 160-bit base32-encoded TOTP shared secret (unpadded)."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _decode_base32_secret(secret: str) -> bytes | None:
    cleaned = _CODE_STRIP_RE.sub("", secret).upper()
    if not cleaned:
        return None
    padding = (-len(cleaned)) % 8
    try:
        return base64.b32decode(cleaned + ("=" * padding), casefold=True)
    except (binascii.Error, ValueError):
        return None


def _hotp(key: bytes, counter: int, digits: int = TOTP_DIGITS) -> str:
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code_int = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return f"{code_int % (10**digits):0{digits}d}"


def generate_totp_code(
    secret: str,
    now: float | datetime | None = None,
    *,
    period: int = TOTP_PERIOD,
    digits: int = TOTP_DIGITS,
) -> str:
    """Compute the current RFC 6238 TOTP code for ``secret`` at ``now``."""
    key = _decode_base32_secret(secret)
    if key is None:
        raise ValueError("Invalid base32 TOTP secret.")
    ts = _resolve_timestamp(now)
    counter = int(ts) // period
    return _hotp(key, counter, digits=digits)


def _resolve_timestamp(now: float | datetime | None) -> float:
    if now is None:
        return time.time()
    if isinstance(now, datetime):
        return now.timestamp()
    return float(now)


def verify_totp_code(
    secret: str,
    code: str,
    now: float | datetime | None = None,
    *,
    period: int = TOTP_PERIOD,
    digits: int = TOTP_DIGITS,
    window: int = TOTP_WINDOW,
) -> bool:
    """Verify a 6-digit TOTP ``code`` against ``secret`` with ±``window`` steps."""
    cleaned = _CODE_STRIP_RE.sub("", code)
    if len(cleaned) != digits or not cleaned.isdigit():
        return False
    key = _decode_base32_secret(secret)
    if key is None:
        return False

    counter = int(_resolve_timestamp(now)) // period
    matched = False
    for offset in range(-window, window + 1):
        step = counter + offset
        if step < 0:
            continue
        expected = _hotp(key, step, digits=digits)
        if hmac.compare_digest(expected, cleaned):
            matched = True
    return matched


def build_otpauth_uri(secret: str, account_name: str, issuer: str) -> str:
    """Build an ``otpauth://totp/...`` URI compatible with authenticator apps."""
    label = f"{quote(issuer, safe='')}:{quote(account_name, safe='')}"
    query = urlencode(
        {
            "secret": secret,
            "issuer": issuer,
            "algorithm": "SHA1",
            "digits": TOTP_DIGITS,
            "period": TOTP_PERIOD,
        },
        quote_via=quote,
    )
    return f"otpauth://totp/{label}?{query}"


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    """Generate ``count`` human-friendly one-time recovery codes (``XXXX-XXXX``)."""
    codes: list[str] = []
    for _ in range(count):
        left = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(4))
        right = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(4))
        codes.append(f"{left}-{right}")
    return codes


def _recovery_key() -> bytes:
    return hmac.new(
        settings.secret_key.encode("utf-8"),
        _RECOVERY_HMAC_DOMAIN,
        hashlib.sha256,
    ).digest()


def _normalize_recovery_code(code: str) -> str:
    return _CODE_STRIP_RE.sub("", code).upper()


def hash_recovery_code(code: str) -> str:
    """Hash a single recovery code using keyed HMAC-SHA256."""
    normalized = _normalize_recovery_code(code)
    digest = hmac.new(_recovery_key(), normalized.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{_RECOVERY_HASH_PREFIX}{digest}"


def hash_recovery_codes(codes: list[str]) -> list[str]:
    """Hash a list of plaintext recovery codes for database storage."""
    return [hash_recovery_code(code) for code in codes]


def verify_and_consume_recovery_code(
    code: str, stored_hashes: list[str]
) -> tuple[bool, list[str]]:
    """Verify ``code`` against ``stored_hashes`` and remove the matched hash.

    Returns ``(matched, remaining_hashes)``. Always iterates every stored hash
    so timing does not reveal which slot matched.
    """
    normalized = _normalize_recovery_code(code)
    if not normalized or not stored_hashes:
        return False, list(stored_hashes)

    candidate = hash_recovery_code(normalized)
    matched_index = -1
    for idx, stored in enumerate(stored_hashes):
        if hmac.compare_digest(stored, candidate) and matched_index == -1:
            matched_index = idx

    if matched_index == -1:
        return False, list(stored_hashes)

    remaining = [h for idx, h in enumerate(stored_hashes) if idx != matched_index]
    return True, remaining


def encrypt_totp_secret(secret: str) -> str:
    """Encrypt a base32 TOTP secret for database storage."""
    return encrypt_password(secret)


def decrypt_totp_secret(token: str) -> str:
    """Decrypt a stored TOTP secret."""
    return decrypt_password(token)


def is_2fa_enforced_for(
    user: User,
    require_2fa_mode: str,
    *,
    is_admin: bool | None = None,
) -> bool:
    """Return True when ``require_2fa_mode`` requires ``user`` to have 2FA enabled.

    The protected bootstrap administrator (``user.is_protected``) is ALWAYS
    exempt so the instance can never be locked out.
    """
    if user.is_protected:
        return False
    if require_2fa_mode == "all":
        return True
    if require_2fa_mode == "admins":
        return bool(user.is_superuser if is_admin is None else is_admin)
    return False
