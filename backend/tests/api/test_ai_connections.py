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
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    created = (await client.post(URL, json=_body("edit"))).json()

    renamed = await client.patch(f"{URL}/{created['id']}", json={"name": "renamed", "model": "m2"})
    assert renamed.json()["name"] == "renamed"
    assert renamed.json()["model"] == "m2"
    assert renamed.json()["api_key_preview"] == "sk-adc****297a"

    swapped = await client.patch(f"{URL}/{created['id']}", json={"api_key": "x" * 20})
    assert swapped.json()["api_key_preview"] == "xxxxxx****xxxx"
    assert swapped.json()["last_check_ok"] is None


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
