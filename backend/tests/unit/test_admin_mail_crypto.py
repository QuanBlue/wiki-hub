"""Stored SMTP passwords: encrypted at rest, and a lost key is recoverable."""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet

from app.core.config import settings
from app.modules.admin_mail.crypto import (
    CredentialUnreadableError,
    decrypt_password,
    encrypt_password,
)


class TestRoundTrip:
    def test_a_password_survives_encryption_and_is_not_stored_in_the_clear(self) -> None:
        token = encrypt_password("s3cret-mail-password")

        assert "s3cret-mail-password" not in token
        assert decrypt_password(token) == "s3cret-mail-password"

    def test_each_encryption_differs_so_equal_passwords_are_not_recognisable(self) -> None:
        assert encrypt_password("same") != encrypt_password("same")

    def test_non_ascii_passwords_work(self) -> None:
        assert decrypt_password(encrypt_password("mật-khẩu-Ω")) == "mật-khẩu-Ω"


class TestKeys:
    def test_a_configured_key_is_used_and_a_different_one_cannot_read_it(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "mail_encryption_key", Fernet.generate_key().decode())
        token = encrypt_password("pw")
        assert decrypt_password(token) == "pw"

        monkeypatch.setattr(settings, "mail_encryption_key", Fernet.generate_key().decode())
        with pytest.raises(CredentialUnreadableError):
            decrypt_password(token)

    def test_without_a_configured_key_one_is_derived_from_the_secret(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "mail_encryption_key", "")
        monkeypatch.setattr(settings, "secret_key", "first-secret-" + "x" * 40)
        token = encrypt_password("pw")
        assert decrypt_password(token) == "pw"

        # Rotating the secret is survivable, not a crash: the caller is told the
        # password is unreadable and asks for it again.
        monkeypatch.setattr(settings, "secret_key", "second-secret-" + "y" * 40)
        with pytest.raises(CredentialUnreadableError):
            decrypt_password(token)


class TestUnreadable:
    def test_a_token_without_the_version_prefix_is_rejected(self) -> None:
        with pytest.raises(CredentialUnreadableError):
            decrypt_password("not-a-token")

    def test_a_corrupted_token_is_rejected(self) -> None:
        with pytest.raises(CredentialUnreadableError):
            decrypt_password("v1:this-is-not-valid-fernet-data")
