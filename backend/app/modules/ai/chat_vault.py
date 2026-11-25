"""The keys behind the encryption of the AI chat history kept in each browser.

The history itself never comes to the server. The browser encrypts it with a key the server
gives to the signed-in person and never stores itself: once they sign out, what is left in the
browser cannot be read. The key is derived, so nothing is kept in the database and the same
person gets the same one on every sign-in.
"""

from __future__ import annotations

import base64
import hashlib
import uuid

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import settings

_INFO = b"wikihub-chat-storage-v1"


def chat_storage_key(user_id: uuid.UUID) -> tuple[str, str]:
    """This person's key (base64) and a name for it that tells nothing about it.

    The name lets the browser see that the server's key changed, and so not write over what
    the former one encrypted.
    """
    master = settings.chat_storage_key or settings.secret_key
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=user_id.bytes, info=_INFO).derive(
        master.encode()
    )
    key_id = hashlib.sha256(b"wikihub-chat-key-id:" + key).hexdigest()[:16]
    return base64.b64encode(key).decode(), key_id
