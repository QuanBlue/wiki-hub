"""Administration > AI assistant > Semantic search: one wiki-wide embedding source."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.db.session import get_session_factory
from app.models.user import User
from app.modules.ai import embedding_settings, ollama
from app.modules.ai.embeddings import EmbeddingError
from app.schemas.ai import AIModelInfo, AITestResult

EMBEDDING = "/api/v1/ai/embedding"
CONNECTIONS = "/api/v1/ai/connections"
KEY = "sk-adc2cecc0ebee434-c1c72e-c056297a"

pytestmark = pytest.mark.integration


async def _reset(client: AsyncClient) -> None:
    for item in (await client.get(CONNECTIONS)).json()["items"]:
        await client.delete(f"{CONNECTIONS}/{item['id']}")
    # The setting is one shared row: start each test with none (a fresh install).
    async with get_session_factory()() as session:
        await session.execute(text("DELETE FROM ai_embedding_settings"))
        await session.commit()


@pytest.fixture
def embeds(monkeypatch: pytest.MonkeyPatch):
    """Embedding calls succeed unless a test says the endpoint refuses."""
    calls: list[tuple[str, str, str]] = []
    refusing: dict[str, bool] = {"on": False}

    async def fake_ensure(base_url: str, api_key: str, model: str) -> None:
        calls.append((base_url, api_key, model))
        if refusing["on"]:
            from app.core.exceptions import BadRequestError

            raise BadRequestError(f"This endpoint cannot create embeddings with “{model}”.")

    monkeypatch.setattr(embedding_settings, "ensure_embeddings", fake_ensure)
    return calls, refusing


async def test_it_starts_off_and_a_member_cannot_see_or_change_it(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    api_member_user: User,
    api_member_access_token: str,
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    await _reset(client)
    off = (await client.get(EMBEDDING)).json()
    assert (off["source"], off["model"], off["has_key"], off["base_url"]) == (
        "provider",
        "",
        False,
        "",
    )
    # Nothing is changed from the defaults.
    assert all(value is None for value in off["tuning"].values())
    assert off["effective"]["index_batch"] == 20 and off["effective"]["ollama_keep_alive"] == "5m"

    client.cookies.set("wikihub_access", api_member_access_token)
    assert (await client.get(EMBEDDING)).status_code == 403
    assert (await client.put(EMBEDDING, json={"source": "ollama", "model": "m"})).status_code == 403
    assert (await client.get("/api/v1/ai/ollama")).status_code == 403
    assert (await client.post("/api/v1/ai/ollama/disable")).status_code == 403


async def test_another_endpoint_is_checked_then_saved_with_its_key_masked(
    client: AsyncClient, api_user: User, api_access_token: str, embeds
) -> None:
    calls, refusing = embeds
    client.cookies.set("wikihub_access", api_access_token)
    await _reset(client)

    body = {
        "source": "custom",
        "base_url": "http://embed.test/v1/",
        "api_key": KEY,
        "model": "bge-m3",
    }
    saved = (await client.put(EMBEDDING, json=body)).json()

    assert saved["source"] == "custom" and saved["model"] == "bge-m3"
    assert saved["base_url"] == "http://embed.test/v1"
    assert saved["api_key_preview"] == "sk-adc****297a" and saved["has_key"] is True
    assert KEY not in (await client.get(EMBEDDING)).text
    assert calls[-1] == ("http://embed.test/v1", KEY, "bge-m3")

    # Editing the model keeps the saved key: it is not sent again.
    await client.put(EMBEDDING, json={"source": "custom", "model": "other"})
    assert calls[-1] == ("http://embed.test/v1", KEY, "other")

    # A model the endpoint cannot embed with is refused, and nothing changes.
    refusing["on"] = True
    refused = await client.put(EMBEDDING, json={"source": "custom", "model": "chat-only"})
    assert refused.status_code == 400 and "cannot create embeddings" in refused.text
    assert (await client.get(EMBEDDING)).json()["model"] == "other"


async def test_another_endpoint_needs_an_address_and_a_key(
    client: AsyncClient, api_user: User, api_access_token: str, embeds
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    await _reset(client)

    no_url = await client.put(EMBEDDING, json={"source": "custom", "model": "m", "api_key": KEY})
    assert no_url.status_code == 400 and "address" in no_url.text
    no_key = await client.put(
        EMBEDDING, json={"source": "custom", "base_url": "http://e.test/v1", "model": "m"}
    )
    assert no_key.status_code == 400 and "key" in no_key.text
    assert (
        await client.put(
            EMBEDDING,
            json={"source": "custom", "base_url": "ftp://x", "model": "m", "api_key": "k"},
        )
    ).status_code == 422


async def test_the_active_provider_is_used_only_when_there_is_one(
    client: AsyncClient, api_user: User, api_access_token: str, embeds
) -> None:
    calls, _ = embeds
    client.cookies.set("wikihub_access", api_access_token)
    await _reset(client)

    none = await client.put(EMBEDDING, json={"source": "provider", "model": "m"})
    assert none.status_code == 400 and "AI provider" in none.text

    await client.post(
        CONNECTIONS,
        json={"name": "p", "base_url": "http://gw.test/v1", "model": "chat", "api_key": KEY},
    )
    ok = await client.put(EMBEDDING, json={"source": "provider", "model": "m"})
    assert ok.status_code == 200
    assert calls[-1] == ("http://gw.test/v1", KEY, "m")


async def test_switching_the_chat_provider_does_not_touch_the_embedding_setting(
    client: AsyncClient, api_user: User, api_access_token: str, embeds
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    await _reset(client)
    await client.put(
        EMBEDDING,
        json={
            "source": "custom",
            "base_url": "http://e.test/v1",
            "api_key": KEY,
            "model": "bge-m3",
        },
    )
    one = (
        await client.post(
            CONNECTIONS,
            json={"name": "one", "base_url": "http://a.test/v1", "model": "m", "api_key": KEY},
        )
    ).json()
    two = (
        await client.post(
            CONNECTIONS,
            json={"name": "two", "base_url": "http://b.test/v1", "model": "m", "api_key": KEY},
        )
    ).json()

    await client.post(f"{CONNECTIONS}/{two['id']}/activate")
    await client.post(f"{CONNECTIONS}/{one['id']}/activate")

    after = (await client.get(EMBEDDING)).json()
    assert (after["source"], after["model"], after["base_url"]) == (
        "custom",
        "bge-m3",
        "http://e.test/v1",
    )


async def test_turning_it_off_needs_no_check(
    client: AsyncClient, api_user: User, api_access_token: str, embeds
) -> None:
    calls, refusing = embeds
    client.cookies.set("wikihub_access", api_access_token)
    await _reset(client)
    await client.put(
        EMBEDDING,
        json={"source": "custom", "base_url": "http://e.test/v1", "api_key": KEY, "model": "m"},
    )
    refusing["on"] = True
    before = len(calls)

    off = await client.put(EMBEDDING, json={"source": "custom", "model": ""})

    assert off.status_code == 200 and off.json()["model"] == ""
    assert len(calls) == before  # nothing was asked of the endpoint


async def test_ollama_needs_to_be_running_and_to_have_the_model(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    embeds,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls, _ = embeds
    client.cookies.set("wikihub_access", api_access_token)
    await _reset(client)

    async def down() -> list[str]:
        raise ollama.OllamaError("Ollama is not answering.")

    monkeypatch.setattr(ollama, "installed_models", down)
    off = await client.put(EMBEDDING, json={"source": "ollama", "model": "bge-m3"})
    assert off.status_code == 400 and "Enable it first" in off.text

    async def up() -> list[str]:
        return ["nomic-embed-text:latest"]

    monkeypatch.setattr(ollama, "installed_models", up)
    missing = await client.put(EMBEDDING, json={"source": "ollama", "model": "bge-m3"})
    assert missing.status_code == 400 and "Download it first" in missing.text

    async def has_it() -> list[str]:
        return ["bge-m3"]

    monkeypatch.setattr(ollama, "installed_models", has_it)
    ok = await client.put(EMBEDDING, json={"source": "ollama", "model": "bge-m3"})
    assert ok.status_code == 200 and ok.json()["source"] == "ollama"
    # The address is the one inside the compose network, with a placeholder key.
    assert calls[-1] == ("http://ollama:11434/v1", "ollama", "bge-m3")

    # Ollama lists an untagged pull as ``name:latest``; the bare name must still match it.
    async def tagged() -> list[str]:
        return ["bge-m3:latest"]

    monkeypatch.setattr(ollama, "installed_models", tagged)
    bare = await client.put(EMBEDDING, json={"source": "ollama", "model": "bge-m3"})
    assert bare.status_code == 200


async def test_the_model_list_only_offers_embedding_models(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    embeds,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    await _reset(client)
    seen: list[tuple[str, str]] = []

    async def fake_probe(base_url: str, api_key: str) -> AITestResult:
        seen.append((base_url, api_key))
        return AITestResult(
            ok=True,
            models=[
                AIModelInfo(id="chat-model", name="chat-model"),
                AIModelInfo(id="x/bge-m3", name="x/bge-m3", embedding=True),
            ],
        )

    monkeypatch.setattr(embedding_settings, "probe", fake_probe)
    models = "/api/v1/ai/embedding/models"

    custom = (
        await client.post(
            models, json={"source": "custom", "base_url": "http://e.test/v1", "api_key": KEY}
        )
    ).json()
    assert custom["ok"] is True and [m["id"] for m in custom["models"]] == ["x/bge-m3"]
    assert seen[-1] == ("http://e.test/v1", KEY)

    nothing = (await client.post(models, json={"source": "provider"})).json()
    assert nothing["ok"] is False and "AI provider" in nothing["error"]

    async def installed() -> list[str]:
        return ["bge-m3:latest", "llama3:8b"]

    monkeypatch.setattr(ollama, "installed_models", installed)
    local = (await client.post(models, json={"source": "ollama"})).json()
    assert [m["id"] for m in local["models"]] == ["bge-m3:latest"]  # the chat model is left out


async def test_a_failing_endpoint_is_reported_not_raised(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    await _reset(client)

    async def bad(base_url: str, api_key: str) -> AITestResult:
        return AITestResult(ok=False, error="The endpoint rejected the API key.")

    monkeypatch.setattr(embedding_settings, "probe", bad)
    result = (
        await client.post(
            "/api/v1/ai/embedding/models",
            json={"source": "custom", "base_url": "http://e.test/v1", "api_key": "x"},
        )
    ).json()
    assert result == {"ok": False, "models": [], "error": "The endpoint rejected the API key."}


async def test_the_ollama_endpoints_report_enable_disable_and_cancel(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    queued: list[tuple] = []

    class Pool:
        async def enqueue_job(self, *args: object) -> None:
            queued.append(args)

        async def aclose(self) -> None:
            return None

    async def fake_pool(*_: object, **__: object) -> Pool:
        return Pool()

    stored: dict[str, ollama.Progress] = {}

    async def describe(tuning=None) -> dict:
        progress = stored.get("p", ollama.Progress())
        return {
            "state": "installing" if progress.state == "installing" else "not_installed",
            "controller_ok": True,
            "docker_ok": True,
            "image": "ollama/ollama:test",
            "image_bytes": 0,
            "memory_bytes": None,
            "memory_limit": "3g",
            "volume_present": False,
            "models": [],
            "available_models": [{"name": "bge-m3", "note": "x"}],
            "step": progress.step,
            "model": progress.model,
            "host_cpus": 12,
            "applied_memory_mb": None,
            "applied_cpus": None,
            "applied_keep_alive": None,
            "restart_needed": False,
            "percent": 0,
            "overall": 0,
            "message": progress.message,
            "current": 0,
            "total": 0,
            "error": "",
        }

    async def write(progress: ollama.Progress) -> None:
        stored["p"] = progress

    cancelled: list[bool] = []

    async def cancel() -> None:
        cancelled.append(True)

    stopped: list[bool] = []

    async def stop() -> None:
        stopped.append(True)

    from app.api.v1 import ai as ai_api

    monkeypatch.setattr(ai_api, "create_pool", fake_pool)
    monkeypatch.setattr(ollama, "describe", describe)
    monkeypatch.setattr(ollama, "write_progress", write)
    monkeypatch.setattr(ollama, "request_cancel", cancel)
    monkeypatch.setattr(ollama, "disable", stop)

    assert (await client.get("/api/v1/ai/ollama")).json()["state"] == "not_installed"

    # Only the offered models can be requested - never free text.
    bad = await client.post("/api/v1/ai/ollama/enable", json={"model": "llama3:70b"})
    assert bad.status_code == 400 and queued == []

    ok = await client.post("/api/v1/ai/ollama/enable", json={"model": "bge-m3"})
    assert ok.status_code == 200 and ok.json()["state"] == "installing"
    assert queued == [("install_ollama", "bge-m3")]

    assert (await client.post("/api/v1/ai/ollama/cancel")).status_code == 200 and cancelled
    assert (await client.post("/api/v1/ai/ollama/disable")).status_code == 200 and stopped


async def test_a_broken_worker_queue_is_a_clear_error_and_nothing_is_marked_installing(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    written: list[object] = []

    async def broken(*_: object, **__: object) -> None:
        raise ConnectionError("redis down")

    async def write(progress: ollama.Progress) -> None:
        written.append(progress)

    from app.api.v1 import ai as ai_api

    monkeypatch.setattr(ai_api, "create_pool", broken)
    monkeypatch.setattr(ollama, "write_progress", write)

    response = await client.post("/api/v1/ai/ollama/enable", json={"model": "bge-m3"})

    assert response.status_code == 503 and "queue is unavailable" in response.text
    assert written == []


def test_an_embedding_error_carries_what_the_log_needs() -> None:
    error = EmbeddingError("x", permanent=True, status=404, detail="Not Found")
    assert (error.status, error.detail, error.permanent) == (404, "Not Found", True)


async def test_tuning_is_saved_validated_and_reset_from_the_admin_form(
    client: AsyncClient, api_user: User, api_access_token: str, embeds
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    await _reset(client)

    saved = await client.put(
        EMBEDDING,
        json={
            "source": "ollama" if False else "provider",
            "model": "",
            "tuning": {"index_batch": 5, "margin": 0.2, "ollama_keep_alive": "1h"},
        },
    )
    body = saved.json()
    assert saved.status_code == 200
    assert body["tuning"]["index_batch"] == 5 and body["tuning"]["margin"] == 0.2
    assert body["effective"]["index_batch"] == 5 and body["effective"]["margin"] == 0.2
    # What was not touched stays at its default.
    assert (
        body["tuning"]["embed_batch_size"] is None and body["effective"]["embed_batch_size"] == 16
    )
    # The form is described by the server: label, bounds, whether it needs a restart.
    by_key = {spec["key"]: spec for spec in body["specs"]}
    assert by_key["index_batch"]["minimum"] == 1 and by_key["index_batch"]["maximum"] == 500
    assert by_key["ollama_memory_gb"]["restart"] is True
    assert by_key["ollama_keep_alive"]["choices"][0] == "0"

    # Saving without a tuning block leaves the knobs alone.
    again = (await client.put(EMBEDDING, json={"source": "provider", "model": ""})).json()
    assert again["tuning"]["index_batch"] == 5

    # null resets one knob to its default.
    reset = (
        await client.put(
            EMBEDDING, json={"source": "provider", "model": "", "tuning": {"index_batch": None}}
        )
    ).json()
    assert reset["tuning"]["index_batch"] is None and reset["effective"]["index_batch"] == 20
    assert reset["tuning"]["margin"] == 0.2


async def test_a_bad_tuning_value_is_refused_with_the_allowed_range_and_nothing_changes(
    client: AsyncClient, api_user: User, api_access_token: str, embeds
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    await _reset(client)
    await client.put(
        EMBEDDING, json={"source": "provider", "model": "", "tuning": {"index_batch": 5}}
    )

    refused = await client.put(
        EMBEDDING,
        json={"source": "provider", "model": "", "tuning": {"index_batch": 99999, "margin": 0.3}},
    )

    assert refused.status_code == 400 and "between 1 and 500" in refused.text
    after = (await client.get(EMBEDDING)).json()
    assert after["tuning"]["index_batch"] == 5 and after["tuning"]["margin"] is None


async def test_the_benchmark_times_a_few_passages_with_the_saved_source(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    embeds,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    await _reset(client)
    bench = "/api/v1/ai/embedding/benchmark"

    # Nothing chosen yet: it says what to do rather than failing.
    nothing = (await client.post(bench)).json()
    assert nothing["ok"] is False and "Choose and save an embedding model" in nothing["error"]

    await client.post(
        CONNECTIONS,
        json={"name": "p", "base_url": "http://gw.test/v1", "model": "chat", "api_key": KEY},
    )
    await client.put(
        EMBEDDING,
        json={"source": "provider", "model": "m", "tuning": {"embed_batch_size": 4}},
    )
    sent: list[int] = []

    async def fake_embed(config, texts):
        sent.append(len(texts))
        assert config.tuning.embed_batch_size == 4  # the saved tuning is what is measured
        return [[0.1, 0.2] for _ in texts]

    monkeypatch.setattr(embedding_settings, "embed", fake_embed)

    result = (await client.post(bench)).json()

    assert result["ok"] is True and result["passages"] == 8 and sent == [8]
    assert result["batch_size"] == 4 and result["characters"] > 8 * 400
    assert result["seconds"] >= 0 and result["estimated_minutes_per_100_pages"] >= 0

    async def failing(config, texts):
        raise EmbeddingError("Could not create embeddings (HTTP 500).", detail="boom")

    monkeypatch.setattr(embedding_settings, "embed", failing)
    bad = (await client.post(bench)).json()
    assert bad["ok"] is False and "HTTP 500" in bad["error"] and "boom" in bad["error"]


async def test_a_member_cannot_run_the_benchmark(
    client: AsyncClient, api_member_user: User, api_member_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_member_access_token)
    assert (await client.post("/api/v1/ai/embedding/benchmark")).status_code == 403
