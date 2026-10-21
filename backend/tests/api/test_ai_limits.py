"""How many AI calls a person may make an hour, set by an administrator."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.models.user import User
from app.modules.ai import limits


@pytest.mark.integration
@pytest.mark.asyncio
async def test_an_administrator_sets_the_hourly_ai_limits_and_can_go_back_to_the_defaults(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)

    before = await client.get("/api/v1/ai/limits")
    assert before.status_code == 200, before.text
    assert before.json()["default_requests_per_hour"] == limits.per_hour(settings.ai_rate_limit)

    saved = await client.put(
        "/api/v1/ai/limits", json={"requests_per_hour": 200, "translate_requests_per_hour": 3000}
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["requests_per_hour"] == 200
    # Applies at once in this process: the next AI call is counted against 200 an hour.
    assert await limits.ai_rate_limit() == "200/hour"
    assert await limits.ai_translate_rate_limit() == "3000/hour"

    cleared = await client.put("/api/v1/ai/limits", json={})
    assert cleared.json()["requests_per_hour"] is None
    assert await limits.ai_rate_limit() == settings.ai_rate_limit


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_limit_outside_the_allowed_range_is_refused(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)

    for value in (0, -5, 100_001):
        response = await client.put("/api/v1/ai/limits", json={"requests_per_hour": value})
        assert response.status_code == 422, value


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_member_cannot_see_or_change_the_limits(
    client: AsyncClient, api_member_user: User, api_member_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_member_access_token)

    assert (await client.get("/api/v1/ai/limits")).status_code == 403
    assert (
        await client.put("/api/v1/ai/limits", json={"requests_per_hour": 5})
    ).status_code == 403


def test_a_default_rule_reads_as_calls_an_hour() -> None:
    assert limits.per_hour("60/hour") == 60
    assert limits.per_hour("2/minute") == 120
    assert limits.Limits(None, None).requests_rule == settings.ai_rate_limit
    assert limits.Limits(90, None).requests_rule == "90/hour"
