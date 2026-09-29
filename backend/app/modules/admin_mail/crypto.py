"""Reversible encryption for the SMTP passwords of administrator mailboxes.

A login password is hashed because it only ever has to be *checked*. An SMTP
password has to be presented to a mail server, so it must be recoverable, and
"recoverable" means "encrypted with a key kept somewhere else" - this module.

The key is ``WIKIHUB_MAIL_ENCRYPTION_KEY`` when set; otherwise it is derived
from ``WIKIHUB_SECRET_KEY`` with HKDF. The derived key is the fallback so a
deployment works without extra setup, but it ties the stored passwords to the
secret: rotate it and they cannot be decrypted. That is not a crash - see
:class:`CredentialUnreadableError` - it just means each mailbox needs its
password entered again, which the existing "update password" flow handles.

Tokens carry a version prefix so a later change of scheme can tell old rows
from new ones.
"""

from __future__ import annotations

import base64

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import settings

_PREFIX = "v1:"
_HKDF_INFO = b"wikihub-admin-mail-v1"


class CredentialUnreadableError(Exception):
    """A stored password cannot be decrypted (wrong or rotated key)."""


def _fernet() -> Fernet:
    configured = settings.mail_encryption_key.strip()
    if configured:
        return Fernet(configured.encode())
    derived = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=_HKDF_INFO,
    ).derive(settings.secret_key.encode())
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt_password(password: str) -> str:
    return _PREFIX + _fernet().encrypt(password.encode()).decode()


def decrypt_password(token: str) -> str:
    if not token.startswith(_PREFIX):
        raise CredentialUnreadableError("Unrecognised stored password format.")
    try:
        return _fernet().decrypt(token[len(_PREFIX) :].encode()).decode()
    except (InvalidToken, ValueError) as exc:
        raise CredentialUnreadableError(
            "The stored password could not be decrypted; enter it again."
        ) from exc
