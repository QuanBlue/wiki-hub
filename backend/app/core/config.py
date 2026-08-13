"""Application configuration.

Every setting is sourced from the environment (prefix ``WIKIHUB_``) so that no
secret ever needs to live in the repository. A single cached ``Settings``
instance is exposed through :func:`get_settings`.
"""

from __future__ import annotations

import json
import secrets
from enum import StrEnum
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import AnyHttpUrl, BeforeValidator, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Environment(StrEnum):
    development = "development"
    test = "test"
    production = "production"


def _split_csv(value: object) -> object:
    """Parse a list setting written as CSV or as a JSON array.

    Both forms show up in the wild: ``a,b`` is what people type in a ``.env``
    file, ``["a","b"]`` is what Helm and CI systems tend to render.
    """
    if not isinstance(value, str):
        return value

    stripped = value.strip()
    if not stripped:
        return []
    if stripped.startswith("["):
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Expected a JSON array or a comma-separated list: {exc}") from exc
        if not isinstance(parsed, list):
            raise ValueError("Expected a JSON array or a comma-separated list.")
        return [str(item).strip() for item in parsed]
    return [item.strip() for item in stripped.split(",") if item.strip()]


#: A list that may be written as a comma-separated string.
#:
#: ``NoDecode`` is essential: without it pydantic-settings tries to ``json.loads``
#: every list-typed environment variable *before* validators run, so a perfectly
#: reasonable ``WIKIHUB_CORS_ORIGINS=http://localhost:3000`` would abort startup.
CsvList = Annotated[list[str], NoDecode, BeforeValidator(_split_csv)]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="WIKIHUB_",
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- general ----------------------------------------------------------
    env: Environment = Environment.development
    debug: bool = False
    site_name: str = "WikiHub"
    api_v1_prefix: str = "/api/v1"
    project_version: str = "0.1.0"

    # --- logging ----------------------------------------------------------
    log_level: str = "INFO"
    log_format: Literal["console", "json"] = "json"

    # --- security ---------------------------------------------------------
    secret_key: str = Field(default_factory=lambda: secrets.token_urlsafe(64))
    access_token_ttl_seconds: int = 43200
    refresh_token_ttl_seconds: int = 1_209_600
    jwt_algorithm: str = "HS256"
    cors_origins: CsvList = Field(default_factory=lambda: ["http://localhost:3000"])
    login_rate_limit: str = "10/minute"
    secure_cookies: bool = False
    auth_provider: Literal["local", "oidc"] = "local"

    # --- database ---------------------------------------------------------
    # Kept as plain strings: SQLAlchemy and arq both want the raw DSN, and the
    # validators below give a clearer failure than a coerced URL object would.
    database_url: str = "postgresql+asyncpg://wikihub:wikihub@localhost:5432/wikihub"
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_echo: bool = False

    # --- redis ------------------------------------------------------------
    redis_url: str = "redis://localhost:6379/0"

    # --- object storage ---------------------------------------------------
    s3_endpoint_url: AnyHttpUrl | None = None
    s3_public_endpoint_url: AnyHttpUrl | None = None
    s3_region: str = "us-east-1"
    s3_bucket: str = "wikihub"
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    s3_use_path_style: bool = True
    s3_presign_ttl_seconds: int = 300

    # --- uploads ----------------------------------------------------------
    max_upload_size_mb: int = 50
    max_import_size_mb: int = 1024
    #: Default attachment allowlist. Overridable at runtime from the admin UI
    #: (see app/services/site_settings.py); this is the fallback.
    #: SVG is deliberately absent - it executes script when served inline.
    attachment_allowed_types: CsvList = Field(
        default_factory=lambda: ["*"]
    )

    # --- bootstrap admin --------------------------------------------------
    # Seeded once by `python -m scripts.seed` as a *protected* account: it can
    # never be renamed, deactivated, deleted, or have its password changed
    # through the API, so an operator always has a way back in.
    admin_username: str = "admin"
    admin_email: str = "admin@wikihub.local"
    admin_password: str = "admin123"  # noqa: S105 - dev default, overridden by env
    admin_full_name: str = "WikiHub Administrator"

    # --- derived ----------------------------------------------------------
    @property
    def is_production(self) -> bool:
        return self.env is Environment.production

    @property
    def max_upload_size_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    @property
    def max_import_size_bytes(self) -> int:
        return self.max_import_size_mb * 1024 * 1024

    @property
    def sync_database_url(self) -> str:
        """psycopg-style URL, used by Alembic's synchronous tooling if needed."""
        return self.database_url.replace("+asyncpg", "")

    @field_validator("database_url")
    @classmethod
    def _validate_database_url(cls, value: str) -> str:
        if not value.startswith(("postgresql://", "postgresql+asyncpg://")):
            raise ValueError(
                "WIKIHUB_DATABASE_URL must be a PostgreSQL DSN "
                "(postgresql+asyncpg://user:pass@host:port/db)"
            )
        # The application is async end to end; normalise the driver so a plain
        # `postgresql://` DSN from a Helm chart or CI secret still works.
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+asyncpg://", 1)
        return value

    @field_validator("redis_url")
    @classmethod
    def _validate_redis_url(cls, value: str) -> str:
        if not value.startswith(("redis://", "rediss://", "unix://")):
            raise ValueError("WIKIHUB_REDIS_URL must be a redis:// or rediss:// URL")
        return value

    @model_validator(mode="after")
    def _harden_production(self) -> Settings:
        if self.env is Environment.production:
            weak = not self.secret_key or "change-me" in self.secret_key.lower()
            if weak or len(self.secret_key) < 32:
                raise ValueError(
                    "WIKIHUB_SECRET_KEY must be set to a strong random value in production"
                )
            # The bootstrap admin password cannot be rotated through the API by
            # design, so shipping the well-known default into production would
            # leave a permanent known credential. Fail closed instead.
            if self.admin_password == "admin123":  # noqa: S105 - the documented default
                raise ValueError(
                    "WIKIHUB_ADMIN_PASSWORD must be changed from the default "
                    "'admin123' in production"
                )
            self.debug = False
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
