"""The shared secret between the backend and the controller.

Derived from ``WIKIHUB_SECRET_KEY``, which both already have, so there is nothing
extra to configure or leak.
"""

from __future__ import annotations

import hashlib
import hmac

HEADER = "X-Controller-Token"


def token(secret_key: str) -> str:
    return hmac.new(secret_key.encode(), b"wikihub-ollama-controller", hashlib.sha256).hexdigest()


def is_valid(secret_key: str, presented: str | None) -> bool:
    return bool(presented) and hmac.compare_digest(token(secret_key), presented or "")
