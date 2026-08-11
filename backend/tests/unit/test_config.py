"""Configuration and log-redaction behaviour."""

from __future__ import annotations

import pytest

from app.core.config import Settings
from app.core.logging import _redact


def test_cors_origins_accept_comma_separated_values() -> None:
    settings = Settings(cors_origins="http://a.test, http://b.test")  # type: ignore[arg-type]
    assert settings.cors_origins == ["http://a.test", "http://b.test"]


def test_cors_origins_parse_from_a_plain_environment_variable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression: a bare URL in the env must not be JSON-decoded at startup."""
    monkeypatch.setenv("WIKIHUB_CORS_ORIGINS", "http://localhost:3000")

    assert Settings(_env_file=None).cors_origins == ["http://localhost:3000"]  # type: ignore[call-arg]


def test_cors_origins_accept_a_json_array_from_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("WIKIHUB_CORS_ORIGINS", '["http://a.test", "http://b.test"]')

    assert Settings(_env_file=None).cors_origins == ["http://a.test", "http://b.test"]  # type: ignore[call-arg]


def test_cors_origins_default_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("WIKIHUB_CORS_ORIGINS", raising=False)

    assert Settings(_env_file=None).cors_origins == ["http://localhost:3000"]  # type: ignore[call-arg]


def test_upload_limits_are_exposed_in_bytes() -> None:
    settings = Settings(max_upload_size_mb=10)
    assert settings.max_upload_size_bytes == 10 * 1024 * 1024


def test_production_rejects_a_weak_secret_key() -> None:
    with pytest.raises(ValueError, match="SECRET_KEY"):
        Settings(env="production", secret_key="dev-only-insecure-change-me")  # type: ignore[arg-type]


def test_production_accepts_a_strong_secret_key() -> None:
    settings = Settings(
        env="production",  # type: ignore[arg-type]
        secret_key="x" * 64,
        debug=True,
        admin_password="a-real-bootstrap-password",
    )
    assert settings.is_production
    assert settings.debug is False  # forced off in production


def test_production_rejects_the_default_admin_password() -> None:
    # The bootstrap admin password cannot be rotated through the API, so
    # shipping the documented default would leave a permanent known credential.
    with pytest.raises(ValueError, match="ADMIN_PASSWORD"):
        Settings(
            env="production",  # type: ignore[arg-type]
            secret_key="x" * 64,
            admin_password="admin123",
        )


def test_sync_database_url_drops_the_async_driver() -> None:
    settings = Settings(database_url="postgresql+asyncpg://u:p@h:5432/d")  # type: ignore[arg-type]
    assert settings.sync_database_url.startswith("postgresql://")


@pytest.mark.parametrize(
    "key",
    ["password", "Password", "secret_key", "access_token", "Authorization", "client_secret"],
)
def test_sensitive_keys_are_redacted(key: str) -> None:
    result = _redact(None, "info", {key: "super-sensitive", "safe": "visible"})

    assert result[key] == "***redacted***"
    assert result["safe"] == "visible"


def test_redaction_reaches_nested_structures() -> None:
    event = {
        "payload": {"user": {"email": "a@b.test", "password": "hunter2"}},
        "items": [{"token": "t"}],
    }

    result = _redact(None, "info", event)

    assert result["payload"]["user"]["password"] == "***redacted***"
    assert result["payload"]["user"]["email"] == "a@b.test"
    assert result["items"][0]["token"] == "***redacted***"
