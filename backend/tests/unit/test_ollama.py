"""Installing and running WikiHub's own Ollama: the steps, the progress card's
numbers, and what the admin page is told in each state."""

from __future__ import annotations

import json
import time

import httpx
import pytest

from app.modules.ai import ollama


class FakeRedis:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.data.get(key)

    async def set(self, key: str, value: str, nx: bool = False, ex: int | None = None) -> bool:
        if nx and key in self.data:
            return False
        self.data[key] = value
        return True

    async def delete(self, key: str) -> None:
        self.data.pop(key, None)


@pytest.fixture
def redis(monkeypatch: pytest.MonkeyPatch) -> FakeRedis:
    fake = FakeRedis()
    monkeypatch.setattr(ollama, "get_redis", lambda: fake)
    return fake


class Script:
    """Stands in for the controller and for Ollama, recording what the install did."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.calls: list[str] = []
        self.bodies: list[dict] = []
        self.progress_seen: list[tuple[str, int, int]] = []
        self.status = {
            "docker_ok": True,
            "image": "ollama/ollama:test",
            "image_present": False,
            "image_bytes": 0,
            "container": "none",
            "memory_bytes": None,
            "memory_limit": "3g",
            "volume_present": False,
        }
        self.models: list[str] = []
        self.fail_at: str | None = None
        monkeypatch.setattr(ollama, "controller_status", self._status)
        monkeypatch.setattr(ollama, "pull_image", self._pull_image)
        monkeypatch.setattr(ollama, "_controller_post", self._post)
        monkeypatch.setattr(ollama, "installed_models", self._models)
        monkeypatch.setattr(ollama, "pull_model", self._pull_model)

    async def _status(self) -> dict:
        return dict(self.status)

    async def _pull_image(self):
        self.calls.append("pull_image")
        for percent in (10, 60, 100):
            yield {"status": "Downloading", "percent": percent, "current": percent, "total": 100}
        self.status["image_present"] = True

    async def _post(
        self, path: str, *, method: str = "POST", json_body: dict | None = None
    ) -> None:
        self.calls.append(f"{method} {path}")
        if json_body is not None:
            self.bodies.append(json_body)
        if path == "/start":
            self.status["container"] = "running"

    async def _models(self) -> list[str]:
        if self.status["container"] != "running":
            raise ollama.OllamaError("Ollama is not answering.")
        return list(self.models)

    async def _pull_model(self, model: str):
        self.calls.append(f"pull_model {model}")
        if self.fail_at == "model":
            raise ollama.OllamaError("registry unreachable")
        for percent in (25, 100):
            yield {"status": "pulling", "percent": percent, "current": percent, "total": 100}
        self.models.append(model + ":latest")


@pytest.fixture
def script(monkeypatch: pytest.MonkeyPatch, redis: FakeRedis) -> Script:
    return Script(monkeypatch)


# ------------------------------------------------------------------- the job


async def test_a_full_install_walks_image_start_ready_model_in_order(script: Script) -> None:
    assert await ollama.install("bge-m3") is True

    assert script.calls == [
        "pull_image",
        "POST /start",
        "pull_model bge-m3",
    ]
    progress = await ollama.read_progress()
    assert progress.state == "idle" and progress.overall == 100 and progress.error == ""


async def test_finished_steps_are_skipped_so_an_install_can_resume(script: Script) -> None:
    script.status.update(image_present=True, container="running")
    script.models = ["bge-m3:latest"]

    await ollama.install("bge-m3")

    # Image there, model there: it only (re)starts the container, which is harmless.
    assert script.calls == ["POST /start"]


async def test_the_progress_bar_covers_the_steps_by_weight() -> None:
    assert ollama.overall_percent("image", 0) == 0
    assert ollama.overall_percent("image", 100) == 60
    assert ollama.overall_percent("start", 100) == 63
    assert ollama.overall_percent("model", 0) == 65
    assert ollama.overall_percent("model", 100) == 100
    assert ollama.overall_percent("unknown", 50) == 0
    assert sum(weight for _, weight in ollama.STEPS) == 100


async def test_progress_is_written_as_it_goes(
    script: Script, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[tuple[str, int]] = []
    real = ollama.write_progress

    async def spy(progress: ollama.Progress) -> None:
        seen.append((progress.step, progress.percent))
        await real(progress)

    monkeypatch.setattr(ollama, "write_progress", spy)
    await ollama.install("bge-m3")

    steps = [step for step, _ in seen]
    assert steps.index("image") < steps.index("start") < steps.index("ready") < steps.index("model")
    assert ("image", 60) in seen and ("model", 25) in seen


async def test_only_the_offered_embedding_models_can_be_installed(script: Script) -> None:
    with pytest.raises(ollama.OllamaError, match="not one of the embedding models"):
        await ollama.install("llama3:70b")
    assert script.calls == []  # nothing was started or downloaded


async def test_a_failure_is_recorded_for_the_card_and_the_lock_is_released(
    script: Script, redis: FakeRedis
) -> None:
    script.fail_at = "model"

    await ollama.install("bge-m3")

    progress = await ollama.read_progress()
    assert progress.state == "error" and progress.error == "registry unreachable"
    assert progress.step == "model"
    assert ollama._LOCK_KEY not in redis.data
    # Trying again is allowed and continues from where it stopped.
    script.fail_at = None
    script.calls.clear()
    await ollama.install("bge-m3")
    assert "pull_image" not in script.calls and "pull_model bge-m3" in script.calls


async def test_docker_being_unreachable_stops_before_anything_starts(script: Script) -> None:
    script.status.update(docker_ok=False, error="Docker is not reachable from the controller.")

    await ollama.install("bge-m3")

    assert script.calls == []
    assert "not reachable" in (await ollama.read_progress()).error


async def test_a_second_install_while_one_runs_does_nothing(
    script: Script, redis: FakeRedis
) -> None:
    redis.data[ollama._LOCK_KEY] = "1"

    assert await ollama.install("bge-m3") is False
    assert script.calls == []


async def test_cancelling_stops_the_install_and_says_so(script: Script) -> None:
    await ollama.request_cancel()

    async def pull_forever():
        script.calls.append("pull_image")
        for percent in range(0, 100, 10):
            yield {"status": "x", "percent": percent, "current": percent, "total": 100}

    # The flag is checked on every progress update, but ``install`` clears a stale
    # one at its start, so cancel from inside the first update instead.
    original = ollama._step

    async def cancel_after_first(progress, step, percent, message="", **extra):
        if script.calls:
            await ollama.request_cancel()
        await original(progress, step, percent, message, **extra)

    script_pull = script._pull_image
    ollama.pull_image = pull_forever  # type: ignore[assignment]
    ollama._step = cancel_after_first  # type: ignore[assignment]
    try:
        await ollama.install("bge-m3")
    finally:
        ollama.pull_image = script_pull  # type: ignore[assignment]
        ollama._step = original  # type: ignore[assignment]

    progress = await ollama.read_progress()
    assert progress.state == "error" and progress.error.endswith("was cancelled.")
    assert "POST /start" not in script.calls


# ------------------------------------------------------------ what the page sees


async def test_describe_for_each_state(script: Script, redis: FakeRedis) -> None:
    assert (await ollama.describe())["state"] == "not_installed"

    script.status.update(image_present=True)
    assert (await ollama.describe())["state"] == "stopped"

    script.status.update(container="running", memory_bytes=800)
    script.models = ["bge-m3:latest"]
    running = await ollama.describe()
    assert running["state"] == "running" and running["models"] == ["bge-m3:latest"]
    assert running["memory_bytes"] == 800 and running["memory_limit"] == "3g"
    assert {m["name"] for m in running["available_models"]} == ollama.ALLOWED_MODELS

    script.models = []
    script.status["container"] = "running"
    # Running but with no model yet: still "running" (nothing to show an error for).
    assert (await ollama.describe())["state"] == "running"


async def test_describe_shows_an_install_in_progress_then_calls_a_silent_one_dead(
    script: Script, redis: FakeRedis
) -> None:
    await ollama.write_progress(
        ollama.Progress(state="installing", step="model", percent=40, overall=79, model="bge-m3")
    )
    live = await ollama.describe()
    assert live["state"] == "installing" and live["step"] == "model" and live["overall"] == 79

    stale = json.loads(redis.data[ollama._PROGRESS_KEY])
    stale["updated_at"] = time.time() - ollama.STALE_AFTER_SECONDS - 5
    redis.data[ollama._PROGRESS_KEY] = json.dumps(stale)
    dead = await ollama.describe()
    assert dead["state"] == "error" and "interrupted" in dead["error"]


async def test_describe_explains_a_missing_controller_and_unreachable_docker(
    monkeypatch: pytest.MonkeyPatch, redis: FakeRedis
) -> None:
    async def down() -> dict:
        raise ollama.OllamaError("The Ollama controller is not running.")

    monkeypatch.setattr(ollama, "controller_status", down)
    result = await ollama.describe()
    assert result["state"] == "controller_down" and "not running" in result["error"]

    async def no_docker() -> dict:
        return {"docker_ok": False, "error": "Docker is not reachable from the controller."}

    monkeypatch.setattr(ollama, "controller_status", no_docker)
    assert (await ollama.describe())["state"] == "docker_unavailable"


async def test_an_old_failure_is_forgotten_once_ollama_is_up_with_a_model(
    script: Script, redis: FakeRedis
) -> None:
    await ollama.write_progress(ollama.Progress(state="error", error="old failure"))
    script.status.update(image_present=True, container="running")
    script.models = ["bge-m3:latest"]

    result = await ollama.describe()

    assert result["state"] == "running" and result["error"] == ""
    # ...but it is still told, as a notice, so a cancelled or refused download does not vanish.
    assert result["notice"] == "old failure"


async def test_disabling_stops_the_container_and_clears_the_card(
    script: Script, redis: FakeRedis
) -> None:
    await ollama.write_progress(ollama.Progress(state="error", error="x"))

    await ollama.disable()

    assert script.calls == ["POST /stop"]
    assert ollama._PROGRESS_KEY not in redis.data


async def test_deleting_models_goes_through_the_controller(script: Script) -> None:
    await ollama.delete_models()
    assert script.calls == ["DELETE /models"]


# --------------------------------------------------------------- the wire side


def test_embedding_names_are_recognised() -> None:
    for name in ("bge-m3:latest", "nomic-embed-text", "granite-embedding:278m", "x/e5-large"):
        assert ollama.is_embedding_name(name), name
    assert not ollama.is_embedding_name("llama3:8b")


async def test_the_model_download_reports_summed_progress(monkeypatch: pytest.MonkeyPatch) -> None:
    lines = [
        {"status": "pulling manifest"},
        {"status": "pulling a", "digest": "a", "total": 100, "completed": 50},
        {"status": "pulling b", "digest": "b", "total": 100, "completed": 0},
        {"status": "pulling a", "digest": "a", "total": 100, "completed": 100},
        {"status": "success"},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content) == {"model": "bge-m3", "stream": True}
        return httpx.Response(200, content="".join(json.dumps(line) + "\n" for line in lines))

    real = httpx.AsyncClient
    monkeypatch.setattr(
        ollama.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler))
    )

    events = [event async for event in ollama.pull_model("bge-m3")]

    # 50 of 100, then a second layer appears (50 of 200 = 25) - the bar must not go back.
    assert [e["percent"] for e in events] == [0, 50, 50, 50, 50]
    assert events[-1]["status"] == "success"


async def test_a_refused_download_raises_with_ollamas_words(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real = httpx.AsyncClient
    monkeypatch.setattr(
        ollama.httpx,
        "AsyncClient",
        lambda **kw: real(
            transport=httpx.MockTransport(
                lambda r: httpx.Response(
                    200, content='{"error":"pull model manifest: file does not exist"}\n'
                )
            )
        ),
    )
    with pytest.raises(ollama.OllamaError, match="file does not exist"):
        [event async for event in ollama.pull_model("bge-m3")]


async def test_the_install_starts_ollama_with_the_chosen_memory_cores_and_keep_alive(
    script: Script,
) -> None:
    from app.modules.ai.tuning import resolve

    tuning = resolve({"ollama_memory_gb": 4, "ollama_cpus": 6, "ollama_keep_alive": "30m"})

    await ollama.install("bge-m3", tuning)

    assert script.bodies == [{"memory_mb": 4096, "cpus": 6, "keep_alive": "30m"}]


async def test_without_a_choice_it_starts_with_the_defaults(script: Script) -> None:
    await ollama.install("bge-m3")

    assert script.bodies == [{"memory_mb": 3072, "cpus": 0, "keep_alive": "5m"}]


async def test_a_restart_is_needed_when_the_saved_settings_differ_from_what_runs(
    script: Script,
) -> None:
    from app.modules.ai.tuning import resolve

    script.status.update(
        image_present=True,
        container="running",
        host_cpus=12,
        applied={"memory_mb": 3072, "cpus": 0, "keep_alive": "5m"},
    )
    script.models = ["bge-m3:latest"]

    same = await ollama.describe(resolve({}))
    assert same["restart_needed"] is False and same["host_cpus"] == 12
    assert (same["applied_memory_mb"], same["applied_cpus"], same["applied_keep_alive"]) == (
        3072,
        0,
        "5m",
    )

    for change in ({"ollama_memory_gb": 4}, {"ollama_cpus": 4}, {"ollama_keep_alive": "1h"}):
        assert (await ollama.describe(resolve(change)))["restart_needed"] is True


async def test_a_stopped_ollama_is_started_again_but_a_disabled_one_is_left_alone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    posts: list[str] = []
    state = {"docker_ok": True, "container": "exited"}

    async def status() -> dict:
        return state

    async def post(path: str, **_: object) -> None:
        posts.append(path)

    async def up(_wait: float = 0) -> None:
        return None

    monkeypatch.setattr(ollama, "controller_status", status)
    monkeypatch.setattr(ollama, "_controller_post", post)
    monkeypatch.setattr(ollama, "wait_until_up", up)

    assert await ollama.ensure_running() is True and posts == ["/start"]
    for container in ("running", "none"):
        state["container"] = container
        assert await ollama.ensure_running() is False
    assert posts == ["/start"]
