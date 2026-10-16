"""The web search settings: what is loaded for the chat, and how an administrator's choice is saved."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.exceptions import BadRequestError, ServiceUnavailableError
from app.models.ai_web_search_settings import AiWebSearchSettings
from app.modules.ai import websearch
from app.modules.ai.config import AIConfig
from app.modules.ai.websearch import WebConfig, WebSearchSettingsService, load_web_config
from app.schemas.ai import WebSearchUpdate

READY = AIConfig(True, "http://gateway.test/v1", "gw-key", "model-1")


class FakeSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.commits = 0

    def add(self, row: object) -> None:
        self.added.append(row)

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, row: AiWebSearchSettings) -> None:
        # What the database fills in for a row created without them.
        row.api_key_encrypted = row.api_key_encrypted or ""
        row.api_key_preview = row.api_key_preview or ""


def row(**fields: object) -> AiWebSearchSettings:
    values = {
        "id": 1,
        "enabled": False,
        "provider": "tavily",
        "api_key_encrypted": "",
        "api_key_preview": "",
    }
    return AiWebSearchSettings(**{**values, **fields})


def stored(monkeypatch: pytest.MonkeyPatch, current: AiWebSearchSettings | None) -> None:
    async def get_row(_session: object) -> AiWebSearchSettings | None:
        return current

    monkeypatch.setattr(websearch, "get_row", get_row)


async def active(_session: object) -> AIConfig:
    return READY


# ---------------------------------------------------------------- what the chat loads


async def test_with_nothing_saved_the_web_is_off(monkeypatch: pytest.MonkeyPatch) -> None:
    stored(monkeypatch, None)

    config = await load_web_config(FakeSession())  # type: ignore[arg-type]

    assert config.ready is False and config.enabled is False


async def test_the_gateway_borrows_the_active_ai_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored(monkeypatch, row(enabled=True, provider="gateway"))
    monkeypatch.setattr(websearch, "load_config", active)

    config = await load_web_config(FakeSession())  # type: ignore[arg-type]

    assert config == WebConfig(True, "gateway", "gw-key", "http://gateway.test/v1", "model-1")
    assert config.ready is True


async def test_the_gateway_is_not_ready_when_no_ai_connection_is_set_up(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored(monkeypatch, row(enabled=True, provider="gateway"))

    async def off(_session: object) -> AIConfig:
        return AIConfig(False, "", "", "")

    monkeypatch.setattr(websearch, "load_config", off)

    config = await load_web_config(FakeSession())  # type: ignore[arg-type]

    assert config.enabled is True and config.ready is False


async def test_a_saved_key_that_can_no_longer_be_read_counts_as_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The encryption key changed since it was saved: it is not an error, the key just has to
    # be entered again.
    stored(monkeypatch, row(enabled=True, provider="brave", api_key_encrypted="garbage"))

    config = await load_web_config(FakeSession())  # type: ignore[arg-type]

    assert config.api_key == "" and config.ready is False


# ---------------------------------------------------------------- what the administrator sees


async def test_with_nothing_saved_the_settings_read_as_off_through_the_gateway(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored(monkeypatch, None)
    service = WebSearchSettingsService(FakeSession(), SimpleNamespace(id="u1"))  # type: ignore[arg-type]

    read = await service.get()

    assert (read.enabled, read.provider, read.has_key) == (False, "gateway", False)


async def test_the_first_save_creates_the_one_row(monkeypatch: pytest.MonkeyPatch) -> None:
    stored(monkeypatch, None)
    session = FakeSession()
    service = WebSearchSettingsService(session, SimpleNamespace(id="u1"))  # type: ignore[arg-type]

    saved = await service.put(WebSearchUpdate(enabled=True, provider="gateway"))

    assert len(session.added) == 1 and session.commits == 1
    assert saved.enabled is True and saved.provider == "gateway"


async def test_a_service_with_its_own_key_cannot_be_turned_on_without_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored(monkeypatch, None)
    service = WebSearchSettingsService(FakeSession(), SimpleNamespace(id="u1"))  # type: ignore[arg-type]

    with pytest.raises(BadRequestError):
        await service.put(WebSearchUpdate(enabled=True, provider="serper"))


# ---------------------------------------------------------------- trying a search


async def test_trying_the_gateway_needs_an_ai_connection(monkeypatch: pytest.MonkeyPatch) -> None:
    stored(monkeypatch, None)

    async def off(_session: object) -> AIConfig:
        return AIConfig(False, "", "", "")

    monkeypatch.setattr(websearch, "load_config", off)
    service = WebSearchSettingsService(FakeSession(), SimpleNamespace(id="u1"))  # type: ignore[arg-type]

    result = await service.test(WebSearchUpdate(enabled=False, provider="gateway"))

    assert result.ok is False and "AI endpoint" in (result.error or "")


async def test_trying_the_gateway_searches_through_the_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored(monkeypatch, None)
    monkeypatch.setattr(websearch, "load_config", active)
    used: list[WebConfig] = []

    async def search(config: WebConfig, query: str) -> list[object]:
        used.append(config)
        return [object(), object()]

    monkeypatch.setattr(websearch, "search_web", search)
    service = WebSearchSettingsService(FakeSession(), SimpleNamespace(id="u1"))  # type: ignore[arg-type]

    result = await service.test(WebSearchUpdate(enabled=False, provider="gateway"))

    assert (result.ok, result.results) == (True, 2)
    assert used[0].base_url == "http://gateway.test/v1" and used[0].api_key == "gw-key"


async def test_a_search_that_fails_is_reported_without_the_services_own_words(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored(monkeypatch, None)
    monkeypatch.setattr(websearch, "load_config", active)

    async def failing(config: WebConfig, query: str) -> list[object]:
        raise ServiceUnavailableError("secret detail")

    monkeypatch.setattr(websearch, "search_web", failing)
    service = WebSearchSettingsService(FakeSession(), SimpleNamespace(id="u1"))  # type: ignore[arg-type]

    result = await service.test(WebSearchUpdate(enabled=False, provider="gateway"))

    assert result.ok is False and "secret detail" not in (result.error or "")
