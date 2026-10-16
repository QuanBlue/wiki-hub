import uuid

import pytest
from httpx import AsyncClient

from app.models.user import User

URL = "/api/v1/ai/connections"
KEY = "sk-adc2cecc0ebee434-c1c72e-c056297a"


def _body(name: str, **extra: object) -> dict[str, object]:
    return {
        "name": name,
        "base_url": "http://gateway.test/v1/",
        "model": "m",
        "api_key": KEY,
        **extra,
    }


async def _clear(client: AsyncClient) -> None:
    """Start from no connections, so "the first one" means something."""
    for item in (await client.get(URL)).json()["items"]:
        await client.delete(f"{URL}/{item['id']}")


async def _by_name(client: AsyncClient) -> dict[str, dict]:
    items = (await client.get(URL)).json()["items"]
    return {item["name"]: item for item in items}


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_saved_key_is_only_ever_returned_masked(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    await _clear(client)
    created = await client.post(URL, json=_body("masked"))

    assert created.status_code == 201
    body = created.json()
    assert body["base_url"] == "http://gateway.test/v1"
    assert body["api_key_preview"] == "sk-adc****297a"
    assert KEY not in created.text
    assert KEY not in (await client.get(URL)).text


@pytest.mark.integration
@pytest.mark.asyncio
async def test_the_first_connection_is_active_and_only_one_is_active_at_a_time(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    await _clear(client)
    first = (await client.post(URL, json=_body("first"))).json()
    # The first connection needs no "activate": it is on from the start.
    assert first["is_active"] is True
    assert (await client.get("/api/v1/ai/status")).json()["enabled"] is True

    second = (await client.post(URL, json=_body("second"))).json()
    assert second["is_active"] is False  # later ones are added switched off
    assert (await _by_name(client))["first"]["is_active"] is True

    third = (await client.post(URL, json=_body("third", activate=True))).json()
    assert third["is_active"] is True
    rows = await _by_name(client)
    assert [rows[name]["is_active"] for name in ("first", "second", "third")] == [
        False,
        False,
        True,
    ]

    activated = await client.post(f"{URL}/{second['id']}/activate")
    assert activated.json()["is_active"] is True
    rows = await _by_name(client)
    assert [rows[name]["is_active"] for name in ("first", "second", "third")] == [
        False,
        True,
        False,
    ]

    off = await client.post(f"{URL}/{second['id']}/deactivate")
    assert off.json()["is_active"] is False
    assert (await client.get("/api/v1/ai/status")).json()["enabled"] is False


@pytest.mark.integration
@pytest.mark.asyncio
async def test_editing_keeps_the_key_unless_a_new_one_is_sent(
    client: AsyncClient, api_user: User, api_access_token: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.ai import admin
    from app.schemas.ai import AITestResult

    async def fake_probe(base_url: str, api_key: str) -> AITestResult:
        return AITestResult(ok=api_key == KEY)

    monkeypatch.setattr(admin, "probe", fake_probe)
    client.cookies.set("wikihub_access", api_access_token)
    created = (await client.post(URL, json=_body("edit"))).json()

    renamed = await client.patch(f"{URL}/{created['id']}", json={"name": "renamed", "model": "m2"})
    assert renamed.json()["name"] == "renamed"
    assert renamed.json()["model"] == "m2"
    assert renamed.json()["api_key_preview"] == "sk-adc****297a"

    swapped = await client.patch(f"{URL}/{created['id']}", json={"api_key": "x" * 20})
    assert swapped.json()["api_key_preview"] == "xxxxxx****xxxx"
    # A new key is checked as soon as it is saved, not left "not checked".
    assert swapped.json()["last_check_ok"] is False
    assert swapped.json()["last_checked_at"] is not None


@pytest.mark.integration
@pytest.mark.asyncio
async def test_removing_and_missing_connections(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    created = (await client.post(URL, json=_body("gone"))).json()

    assert (await client.delete(f"{URL}/{created['id']}")).status_code == 204
    assert "gone" not in await _by_name(client)
    assert (await client.delete(f"{URL}/{created['id']}")).status_code == 404
    assert (await client.post(f"{URL}/{uuid.uuid4()}/activate")).status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio
async def test_an_endpoint_without_http_is_rejected(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    response = await client.post(URL, json=_body("bad", base_url="ftp://nope"))
    assert response.status_code == 422


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_member_cannot_manage_connections_but_can_see_status(
    client: AsyncClient, api_member_user: User, api_member_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_member_access_token)
    assert (await client.get(URL)).status_code == 403
    assert (await client.post(URL, json=_body("nope"))).status_code == 403
    status = await client.get("/api/v1/ai/status")
    assert status.status_code == 200
    assert status.json()["can_configure"] is False


@pytest.mark.integration
@pytest.mark.asyncio
async def test_the_summary_skill_can_be_customised_and_reset(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    url = "/api/v1/ai/skills/summary"
    await client.put(url, json={"instructions": ""})

    before = (await client.get(url)).json()
    assert before["is_custom"] is False
    assert before["instructions"] == ""
    assert before["default_instructions"]

    saved = (await client.put(url, json={"instructions": "  Summarise as a haiku.  "})).json()
    assert saved["is_custom"] is True
    assert saved["instructions"] == "Summarise as a haiku."

    reset = (await client.put(url, json={"instructions": "   "})).json()
    assert reset["is_custom"] is False
    assert (await client.put(url, json={"instructions": "x" * 4001})).status_code == 422


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_member_cannot_read_or_change_the_summary_skill(
    client: AsyncClient, api_member_user: User, api_member_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_member_access_token)
    assert (await client.get("/api/v1/ai/skills/summary")).status_code == 403
    response = await client.put("/api/v1/ai/skills/summary", json={"instructions": "x"})
    assert response.status_code == 403


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_new_address_resets_the_last_check_and_a_saved_key_can_be_rechecked(
    client: AsyncClient, api_user: User, api_access_token: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.ai import admin
    from app.schemas.ai import AITestResult

    seen: list[tuple[str, str]] = []

    async def fake_probe(base_url: str, api_key: str) -> AITestResult:
        seen.append((base_url, api_key))
        return AITestResult(ok=True)

    monkeypatch.setattr(admin, "probe", fake_probe)
    client.cookies.set("wikihub_access", api_access_token)
    created = (await client.post(URL, json=_body("recheck"))).json()
    # A new connection is checked when it is saved.
    assert created["last_check_ok"] is True

    checked = await client.post(f"{URL}/{created['id']}/check")
    assert checked.json()["ok"] is True
    assert seen[-1] == ("http://gateway.test/v1", KEY)
    assert (await _by_name(client))["recheck"]["last_check_ok"] is True

    moved = await client.patch(f"{URL}/{created['id']}", json={"base_url": "http://other.test/v1"})
    assert moved.json()["base_url"] == "http://other.test/v1"
    # Moving it re-checks straight away.
    assert moved.json()["last_check_ok"] is True
    assert seen[-1] == ("http://other.test/v1", KEY)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_blank_key_tests_with_the_saved_one(
    client: AsyncClient, api_user: User, api_access_token: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.ai import admin
    from app.schemas.ai import AITestResult

    seen: list[tuple[str, str]] = []

    async def fake_probe(base_url: str, api_key: str) -> AITestResult:
        seen.append((base_url, api_key))
        return AITestResult(ok=True)

    monkeypatch.setattr(admin, "probe", fake_probe)
    client.cookies.set("wikihub_access", api_access_token)
    created = (await client.post(URL, json=_body("blank"))).json()

    result = await client.post(f"{URL}/test", json={"connection_id": created["id"], "api_key": ""})
    assert result.status_code == 200, result.text
    assert seen[-1] == ("http://gateway.test/v1", KEY)


@pytest.mark.asyncio
@pytest.mark.parametrize("step", ["create", "activate"])
async def test_losing_the_race_to_activate_is_a_conflict(step: str) -> None:
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, Mock

    from sqlalchemy.exc import IntegrityError

    from app.core.exceptions import ConflictError
    from app.modules.ai.admin import AIConnectionService
    from app.schemas.ai import ConnectionCreate

    session = Mock()
    session.add = Mock()
    session.flush = AsyncMock()
    session.execute = AsyncMock()
    session.scalar = AsyncMock(return_value=None)
    session.rollback = AsyncMock()
    session.commit = AsyncMock(side_effect=IntegrityError("x", {}, Exception("dup")))
    existing = SimpleNamespace(id=uuid.uuid4(), is_active=False, updated_by_id=None)
    session.get = AsyncMock(return_value=existing)
    service = AIConnectionService(session, SimpleNamespace(id=uuid.uuid4()))

    with pytest.raises(ConflictError):
        if step == "create":
            await service.create(
                ConnectionCreate(name="n", base_url="http://x.test/v1", model="m", api_key="k" * 20)
            )
        else:
            await service.activate(uuid.uuid4())
    session.rollback.assert_awaited_once()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_member_cannot_see_index_progress(
    client: AsyncClient, api_member_user: User, api_member_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_member_access_token)
    assert (await client.get("/api/v1/ai/search-index")).status_code == 403


@pytest.mark.integration
@pytest.mark.asyncio
async def test_the_scheduled_pass_rechecks_every_saved_connection(
    client: AsyncClient, api_user: User, api_access_token: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.db.session import get_session_factory
    from app.modules.ai import admin
    from app.schemas.ai import AITestResult

    working = {"on": True}

    async def fake_probe(base_url: str, api_key: str) -> AITestResult:
        return AITestResult(ok=working["on"])

    monkeypatch.setattr(admin, "probe", fake_probe)
    client.cookies.set("wikihub_access", api_access_token)
    await _clear(client)
    await client.post(URL, json=_body("one"))
    await client.post(URL, json=_body("two"))
    assert {c["last_check_ok"] for c in (await _by_name(client)).values()} == {True}

    working["on"] = False  # the gateway goes down
    async with get_session_factory()() as session:
        assert await admin.check_all_connections(session) == 2

    assert {c["last_check_ok"] for c in (await _by_name(client)).values()} == {False}


def test_embedding_models_are_recognised_from_what_the_gateway_says_and_from_the_name() -> None:
    from app.modules.ai.admin import _model_info

    def embedding(**item: object) -> bool:
        return _model_info({"id": "x", **item}).embedding

    # The user's gateway: text-out chat models, no embedding flag.
    assert not embedding(
        id="vts/MiniMax-M3", output_modalities=["text"], capabilities={"vision": True}
    )
    assert not embedding(id="zai-org/GLM-5.3-Flash")
    assert not embedding(id="gpt-4o")
    # Said outright.
    assert embedding(capabilities={"embedding": True})
    assert embedding(mode="embedding")
    assert embedding(output_modalities=["embedding"])
    # By name - including gateways that call everything text-out.
    assert embedding(id="text-embedding-3-small")
    assert embedding(id="qwen/qwen3-embedding-8b", output_modalities=["text"])
    assert embedding(id="BAAI/bge-m3")
    assert embedding(id="intfloat/multilingual-e5-large")
    assert not embedding(id="somebody/bgetter-chat")
