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


def test_database_url_is_assembled_from_the_discrete_postgres_settings() -> None:
    settings = Settings(
        postgres_user="u",
        postgres_password="p",
        postgres_host="h",
        postgres_port=5433,
        postgres_db="d",
    )
    assert settings.database_url == "postgresql+asyncpg://u:p@h:5433/d"


def test_database_url_percent_encodes_special_characters_in_credentials() -> None:
    settings = Settings(postgres_user="u@1", postgres_password="p@ss:w/ord")
    assert settings.database_url.startswith("postgresql+asyncpg://u%401:p%40ss%3Aw%2Ford@")


def test_sync_database_url_drops_the_async_driver() -> None:
    settings = Settings(postgres_user="u", postgres_password="p", postgres_host="h", postgres_db="d")
    assert settings.sync_database_url.startswith("postgresql://")


def test_frontend_internal_url_strips_a_trailing_slash() -> None:
    settings = Settings(frontend_internal_url="http://frontend:3000/")  # type: ignore[arg-type]
    assert settings.frontend_internal_url == "http://frontend:3000"


def test_frontend_internal_url_rejects_a_non_http_scheme() -> None:
    with pytest.raises(ValueError, match="FRONTEND_INTERNAL_URL"):
        Settings(frontend_internal_url="frontend:3000")  # type: ignore[arg-type]


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
