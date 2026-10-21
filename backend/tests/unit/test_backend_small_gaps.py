"""Small corners of the backend that each need one more test: bad settings, odd tokens, a down
Redis, a controller that cannot be reached."""

from __future__ import annotations

import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import jwt
import pytest
from pydantic import ValidationError

from app.api.v1 import admin_monitor
from app.core import logging as log_module
from app.core import security
from app.core.config import Settings, _split_csv, settings
from app.core.exceptions import (
    AuthenticationError,
    BadRequestError,
    ServiceUnavailableError,
)
from app.models.space import SpaceRole
from app.modules.ai import admin as ai_admin
from app.modules.ai import ollama
from app.modules.ai import service as service_module
from app.modules.ai.config import AIConfig, decrypt_embedding_key
from app.modules.ai.embedding_settings import EmbeddingSettingsService
from app.modules.ai.embeddings import EmbeddingError
from app.modules.ai.service import AIService
from app.modules.search.query import IP_MARKER, best_snippet
from app.schemas.ai import AnswerRequest, EmbeddingModelsRequest, ExplainRequest
from app.schemas.pagination import Page
from app.workers import tasks

# ---------------------------------------------------------------- settings written as lists


def test_an_empty_list_setting_is_an_empty_list() -> None:
    assert _split_csv("   ") == []


def test_a_list_setting_in_json_that_is_not_json_is_refused_with_the_reason() -> None:
    with pytest.raises(ValueError, match="Expected a JSON array or a comma-separated list"):
        _split_csv("[not json")


def test_the_redis_address_must_be_a_redis_url() -> None:
    with pytest.raises(ValidationError, match="redis://"):
        Settings(redis_url="http://localhost:6379")


# ---------------------------------------------------------------- passwords and tokens


def test_a_hash_that_is_not_one_needs_replacing() -> None:
    assert security.needs_rehash("not-a-hash") is True


def test_a_token_without_the_claims_that_identify_it_is_not_accepted() -> None:
    now = int(time.time())
    token = jwt.encode(
        {"sub": "not-a-uuid", "type": "access", "exp": now + 60, "jti": "also-not-one"},
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )

    with pytest.raises(AuthenticationError):
        security.decode_token_identity(token)


# ---------------------------------------------------------------- logging


def test_scrubbing_stops_descending_at_a_sane_depth() -> None:
    deep: dict = {"password": "x"}
    for _ in range(9):
        deep = {"inner": deep}

    scrubbed = log_module.scrub_value(deep)

    node = scrubbed
    for _ in range(7):
        node = node["inner"]
    # Beyond the limit the rest is returned as it is rather than followed forever.
    assert isinstance(node, dict)


def test_the_signed_in_user_is_added_to_every_log_line() -> None:
    token = log_module.user_id_ctx.set("user-1")
    try:
        event = log_module._add_context(None, "info", {"event": "x"})
    finally:
        log_module.user_id_ctx.reset(token)

    assert event["user_id"] == "user-1"


# ---------------------------------------------------------------- pages of results


def test_a_page_knows_whether_there_is_more() -> None:
    assert Page.of([1, 2], 5, limit=2, offset=0).has_more is True
    assert Page.of([5], 5, limit=2, offset=4).has_more is False


def test_a_space_role_ranks_viewer_below_editor_below_admin() -> None:
    assert [SpaceRole(r).rank for r in ("viewer", "editor", "admin")] == [0, 1, 2]


# ---------------------------------------------------------------- search snippets


def test_blank_terms_are_ignored_and_very_many_matches_are_capped() -> None:
    content = "<p>" + "address 10.0.0.5 " * 400 + "</p>"

    snippet, found = best_snippet(content, [("", 1.0), ("address", 1.0), (IP_MARKER, 1.0)])

    assert found is True and "address" in snippet


# ---------------------------------------------------------------- the question box


def test_a_question_that_is_one_letter_once_tidied_is_refused() -> None:
    with pytest.raises(ValidationError, match="longer question"):
        AnswerRequest(query="a ")


# ---------------------------------------------------------------- the embedding endpoint


async def test_an_endpoint_that_cannot_embed_is_refused_with_the_models_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def refuse(_config: AIConfig, _texts: list[str]) -> list[list[float]]:
        raise EmbeddingError("no /embeddings", permanent=True)

    monkeypatch.setattr(ai_admin, "embed", refuse)

    with pytest.raises(BadRequestError, match="cannot create embeddings with “m-1”"):
        await ai_admin.ensure_embeddings("http://gw/v1", "key", "m-1")


async def test_self_hosted_models_cannot_be_listed_while_ollama_is_down(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def down() -> list[str]:
        raise ollama.OllamaError("Ollama is not answering.")

    monkeypatch.setattr(ollama, "installed_models", down)
    service = EmbeddingSettingsService(None, SimpleNamespace(id="a"))  # type: ignore[arg-type]

    result = await service.models(EmbeddingModelsRequest(source="ollama"))

    assert result.ok is False and result.error == "Ollama is not answering."


def test_an_embedding_endpoint_with_no_key_saved_has_none() -> None:
    row = SimpleNamespace(api_key_encrypted="")

    assert decrypt_embedding_key(row) == ""  # type: ignore[arg-type]


# ---------------------------------------------------------------- explaining words in the chat


async def test_words_of_a_chat_answer_cannot_be_explained_while_the_assistant_is_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def off(_session: object) -> AIConfig:
        return AIConfig(False, "", "", "")

    monkeypatch.setattr(service_module, "load_config", off)
    service = AIService.__new__(AIService)
    service.session = None  # type: ignore[assignment]
    service.user = SimpleNamespace(id="u1")  # type: ignore[assignment]

    with pytest.raises(ServiceUnavailableError, match="not enabled"):
        await service.explain_text(ExplainRequest(text="PromQL", action="explain"))


# ---------------------------------------------------------------- the admin monitor


async def test_logs_cannot_be_read_while_the_controller_is_unreachable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    real = httpx.AsyncClient
    monkeypatch.setattr(
        admin_monitor,
        "controller_client",
        lambda: real(transport=httpx.MockTransport(refuse), base_url="http://controller"),
    )

    with pytest.raises(ServiceUnavailableError):
        await admin_monitor.container_logs("wikihub-web-1", SimpleNamespace(), tail=50)


# ---------------------------------------------------------------- background tasks


async def test_the_install_task_hands_the_saved_tuning_to_the_installer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[tuple[str, object]] = []

    class Scope:
        async def __aenter__(self) -> object:
            return object()

        async def __aexit__(self, *exc: object) -> None:
            return None

    async def load(_session: object) -> SimpleNamespace:
        return SimpleNamespace(tuning="the-tuning")

    async def install(model: str, tuning: object) -> bool:
        seen.append((model, tuning))
        return True

    monkeypatch.setattr(tasks, "session_scope", lambda: Scope())
    monkeypatch.setattr(tasks, "load_config", load)
    monkeypatch.setattr(tasks.ollama, "install", install)

    assert await tasks.install_ollama({}, "bge-m3") is True
    assert seen == [("bge-m3", "the-tuning")]


async def test_a_long_indexing_pass_keeps_renewing_its_lock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    renewed: list[str] = []

    class Redis:
        async def set(self, *args: object, **kwargs: object) -> bool:
            return True

        async def expire(self, key: str, seconds: int) -> None:
            renewed.append(key)

        async def eval(self, *args: object) -> int:
            return 1

    class Scope:
        async def __aenter__(self) -> object:
            return object()

        async def __aexit__(self, *exc: object) -> None:
            return None

    async def load(_session: object) -> object:
        return object()

    batches = iter([3, 0])  # one batch, then the backlog is done

    async def index(
        _session: object, _config: object, *, deadline: float, heartbeat, stop=None
    ) -> int:
        await heartbeat()
        return next(batches)

    monkeypatch.setattr(tasks, "get_redis", lambda: Redis())
    monkeypatch.setattr(tasks, "session_scope", lambda: Scope())
    monkeypatch.setattr(tasks, "load_config", load)
    monkeypatch.setattr(tasks, "index_pending", index)
    monkeypatch.setattr(tasks, "indexing_paused", AsyncMock(return_value=False))

    assert await tasks.index_search_pages({}) == 3
    # Renewed by every batch's heartbeat, and only ever this pass's own lock.
    assert renewed and set(renewed) == {"lock:search_index"}
