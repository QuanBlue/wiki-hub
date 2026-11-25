"""The keys behind the encryption of the chat history each browser keeps."""

from __future__ import annotations

import base64
import uuid

import pytest
from pydantic import ValidationError

from app.core.config import Settings, settings
from app.modules.ai.chat_vault import chat_storage_key

ONE = uuid.UUID("00000000-0000-0000-0000-000000000001")
TWO = uuid.UUID("00000000-0000-0000-0000-000000000002")


def test_a_person_gets_the_same_key_every_time_and_nobody_else_does() -> None:
    key, key_id = chat_storage_key(ONE)

    assert len(base64.b64decode(key)) == 32
    assert chat_storage_key(ONE) == (key, key_id)
    assert chat_storage_key(TWO)[0] != key
    assert chat_storage_key(TWO)[1] != key_id


def test_a_key_of_its_own_is_used_instead_of_the_main_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "chat_storage_key", "")
    from_main = chat_storage_key(ONE)
    monkeypatch.setattr(settings, "chat_storage_key", "c" * 48)
    from_own = chat_storage_key(ONE)

    assert from_own != from_main
    # Then the main secret may change without losing anyone's chats.
    monkeypatch.setattr(settings, "secret_key", "another-secret-" * 4)
    assert chat_storage_key(ONE) == from_own


def test_a_short_key_of_its_own_is_refused() -> None:
    with pytest.raises(ValidationError, match="WIKIHUB_CHAT_STORAGE_KEY"):
        Settings(chat_storage_key="too-short")
    assert Settings(chat_storage_key="   ").chat_storage_key == ""
