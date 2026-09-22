from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock

import jwt
import pytest
from pydantic import ValidationError

from app.core import config
from app.core import logging as app_logging
from app.core.config import Environment, Settings
from app.core.exceptions import AuthenticationError
from app.core.security import decode_access_token, needs_rehash
from app.db import session as db_session
from app.models.space import SpaceRole
from app.schemas.pagination import Page
from app.schemas.site_settings import SidebarPermissions, SiteSettingsUpdate
from app.schemas.space import SpaceCreate


def test_config_parsers_validators_and_production_hardening(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert config._split_csv("a, b,,c") == ["a", "b", "c"]
    assert config._split_csv("   ") == []
    assert config._split_csv('["a", 2]') == ["a", "2"]
    assert config._split_csv(3) == 3
    with pytest.raises(ValueError):
        config._split_csv("[broken")
    monkeypatch.setattr(config.json, "loads", lambda _value: {})
    with pytest.raises(ValueError):
        config._split_csv("[not-a-list]")

    parsed = Settings(postgres_user="u", postgres_password="p", postgres_host="localhost", postgres_db="db")
    assert parsed.database_url == "postgresql+asyncpg://u:p@localhost:5432/db"
    assert parsed.sync_database_url.startswith("postgresql://")
    with pytest.raises(ValidationError):
        Settings(redis_url="http://localhost")
    with pytest.raises(ValidationError):
        Settings(env=Environment.production, secret_key="short", admin_password="changed")
    with pytest.raises(ValidationError):
        Settings(env=Environment.production, secret_key="x" * 40)


def test_logging_security_and_small_schema_edges() -> None:
    assert (
        app_logging.scrub_value({"nested": {"password": "secret"}})["nested"]["password"]
        == app_logging.REDACTED
    )
    app_logging.request_id_ctx.set("request")
    app_logging.user_id_ctx.set("user")
    event = app_logging._add_context(None, "event", {})
    assert event == {"request_id": "request", "user_id": "user"}
    assert app_logging.scrub_value({"x": "y"}, depth=7) == {"x": "y"}

    assert needs_rehash("invalid hash") is True
    bad = jwt.encode(
        {"type": "access", "sub": "not-a-uuid", "exp": int(datetime.now(UTC).timestamp()) + 60},
        config.settings.secret_key,
        algorithm=config.settings.jwt_algorithm,
    )
    with pytest.raises(AuthenticationError):
        decode_access_token(bad)

    assert Page.of(["a"], 2, limit=1, offset=0).has_more
    assert not Page.of(["a"], 1, limit=1, offset=0).has_more
    assert SiteSettingsUpdate(allowed_attachment_types=None).allowed_attachment_types is None
    assert SiteSettingsUpdate(
        allowed_attachment_types=["png", "png", "jpg"]
    ).allowed_attachment_types == ["png", "jpg"]
    assert SiteSettingsUpdate(site_name=None).site_name is None
    assert SpaceCreate(key="eng-1", name="Engineering").key == "ENG_1"
    assert SidebarPermissions(spaces=["admin", "admin"]).spaces == ["admin"]
    assert SidebarPermissions(home=["admin", "admin"]).home == ["admin", "member"]
    assert SpaceRole.admin.rank == 2
    with pytest.raises(ValidationError):
        SpaceCreate(key="1bad", name="Invalid")


@pytest.mark.asyncio
async def test_database_engine_factory_scope_and_disposal(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_engine = AsyncMock()
    factory = Mock()
    monkeypatch.setattr(db_session, "create_async_engine", Mock(return_value=fake_engine))
    monkeypatch.setattr(db_session, "async_sessionmaker", Mock(return_value=factory))
    db_session._engine = None
    db_session._session_factory = None
    assert db_session.get_engine() is fake_engine
    assert db_session.get_engine() is fake_engine
    assert db_session.get_session_factory() is factory
    assert db_session.get_session_factory() is factory

    session = AsyncMock()
    context = Mock()
    context.__aenter__ = AsyncMock(return_value=session)
    context.__aexit__ = AsyncMock(return_value=False)
    factory.return_value = context
    async with db_session.session_scope() as yielded:
        assert yielded is session
    session.commit.assert_awaited_once()

    session.commit.reset_mock()
    session.rollback.reset_mock()
    context = Mock()
    context.__aenter__ = AsyncMock(return_value=session)
    context.__aexit__ = AsyncMock(return_value=False)
    factory.return_value = context
    with pytest.raises(RuntimeError):
        async with db_session.session_scope():
            raise RuntimeError("boom")
    session.rollback.assert_awaited_once()

    await db_session.dispose_engine()
    fake_engine.dispose.assert_awaited_once()
    assert db_session._engine is None
    assert db_session._session_factory is None
