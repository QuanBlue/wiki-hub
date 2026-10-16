"""``/api/v1/ai/web-search``: only an administrator may turn the internet on for the chat."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core.exceptions import ServiceUnavailableError
from app.models.user import User
from app.modules.ai import websearch
from app.modules.ai.websearch import WebResult

URL = "/api/v1/ai/web-search"
KEY = "tvly-abcdef0123456789abcdef"


async def _reset(client: AsyncClient) -> None:
    await client.put(URL, json={"enabled": False, "provider": "tavily", "api_key": ""})


@pytest.mark.integration
@pytest.mark.asyncio
async def test_it_needs_a_signed_in_administrator(client: AsyncClient) -> None:
    assert (await client.get(URL)).status_code == 401


@pytest.mark.integration
@pytest.mark.asyncio
async def test_an_ordinary_member_cannot_read_or_change_it(
    client: AsyncClient, api_member_user: User, api_member_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_member_access_token)

    assert (await client.get(URL)).status_code == 403
    body = {"enabled": True, "provider": "tavily", "api_key": KEY}
    assert (await client.put(URL, json=body)).status_code == 403
    assert (await client.post(f"{URL}/test", json=body)).status_code == 403


@pytest.mark.integration
@pytest.mark.asyncio
async def test_it_is_off_until_it_is_turned_on_with_a_key(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    await _reset(client)

    first = (await client.get(URL)).json()
    assert first == {"enabled": False, "provider": "tavily", "has_key": False, "key_preview": ""}

    refused = await client.put(URL, json={"enabled": True, "provider": "brave"})
    assert refused.status_code == 400

    saved = await client.put(URL, json={"enabled": True, "provider": "brave", "api_key": KEY})
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["enabled"] is True and body["provider"] == "brave" and body["has_key"] is True
    # The key is never sent back, only enough of it to recognise it.
    assert KEY not in saved.text and body["key_preview"].startswith(KEY[:6])

    # Leaving the key out keeps it; an empty one removes it, which also stops it being on.
    kept = await client.put(URL, json={"enabled": True, "provider": "serper"})
    assert kept.json()["has_key"] is True and kept.json()["provider"] == "serper"
    removed = await client.put(URL, json={"enabled": True, "provider": "serper", "api_key": ""})
    assert removed.status_code == 400
    await _reset(client)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_an_unknown_search_service_is_refused(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)

    response = await client.put(URL, json={"enabled": False, "provider": "bing"})

    assert response.status_code == 422


@pytest.mark.integration
@pytest.mark.asyncio
async def test_the_test_button_tries_a_real_search_with_the_key_entered(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    await _reset(client)
    used: list[str] = []

    async def search(config, query: str):
        used.append(config.api_key)
        if config.api_key == "bad":
            raise ServiceUnavailableError("no")
        return [WebResult("t", "https://a.example", "s")]

    monkeypatch.setattr(websearch, "search_web", search)

    good = await client.post(
        f"{URL}/test", json={"enabled": False, "provider": "tavily", "api_key": KEY}
    )
    bad = await client.post(
        f"{URL}/test", json={"enabled": False, "provider": "tavily", "api_key": "bad"}
    )
    nothing = await client.post(URL + "/test", json={"enabled": False, "provider": "tavily"})

    assert good.json() == {"ok": True, "error": None, "results": 1}
    assert bad.json()["ok"] is False and "key" in bad.json()["error"]
    assert nothing.json()["ok"] is False
    assert used == [KEY, "bad"]
    # Trying a key saves nothing.
    assert (await client.get(URL)).json()["has_key"] is False


@pytest.mark.integration
@pytest.mark.asyncio
async def test_searching_through_the_ai_gateway_needs_no_key_of_its_own(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    await _reset(client)

    saved = await client.put(URL, json={"enabled": True, "provider": "gateway"})

    assert saved.status_code == 200, saved.text
    assert saved.json()["enabled"] is True and saved.json()["provider"] == "gateway"
    assert saved.json()["has_key"] is False
    await _reset(client)
