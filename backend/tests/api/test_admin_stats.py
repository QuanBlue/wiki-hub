import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from app.db.session import get_session_factory
from app.models.stats import AiUsage, UserActivityDaily
from app.models.user import User
from app.modules.stats.recorder import record_ai_usage, record_view

BASE = "/api/v1/admin/statistics"


@pytest.mark.integration
@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["overview", "ai", "top-pages", "top-spaces"])
async def test_statistics_require_an_administrator(
    client: AsyncClient, api_member_user: User, api_member_access_token: str, path: str
) -> None:
    client.cookies.set("wikihub_access", api_member_access_token)
    assert (await client.get(f"{BASE}/{path}")).status_code == 403


@pytest.mark.integration
@pytest.mark.asyncio
async def test_overview_is_zero_filled_for_the_whole_range(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    response = await client.get(f"{BASE}/overview", params={"range": "7d"})
    assert response.status_code == 200
    body = response.json()
    assert body["range_days"] == 7
    assert len(body["daily"]) == 7
    assert body["totals"]["users"] >= 1
    assert isinstance(body["recent_activity"], list)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_rejects_an_unknown_range(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    assert (await client.get(f"{BASE}/overview", params={"range": "1y"})).status_code == 422


@pytest.mark.integration
@pytest.mark.asyncio
async def test_ai_usage_is_attributed_to_a_user_and_feature(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    await record_ai_usage(
        user_id=api_user.id,
        feature="summarize",
        model="m",
        prompt_tokens=120,
        completion_tokens=30,
    )
    client.cookies.set("wikihub_access", api_access_token)
    body = (await client.get(f"{BASE}/ai", params={"range": "7d"})).json()
    mine = next(row for row in body["by_user"] if row["user_id"] == str(api_user.id))
    assert mine["tokens"] == 150 and mine["calls"] == 1
    assert any(row["feature"] == "summarize" for row in body["by_feature"])
    assert body["totals"]["tokens"] >= 150
    assert sum(day["tokens"] for day in body["daily"]) >= 150
    async with get_session_factory()() as session:
        await session.execute(AiUsage.__table__.delete().where(AiUsage.user_id == api_user.id))
        await session.commit()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_a_viewed_space_ranks_in_top_spaces(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    key = f"ST{uuid.uuid4().hex[:6]}".upper()
    created = await client.post("/api/v1/spaces", json={"key": key, "name": f"Stats {key}"})
    assert created.status_code in (200, 201), created.text
    space_id = uuid.UUID(created.json()["id"])
    try:
        await record_view("space", space_id)
        await record_view("space", space_id)
        items = (await client.get(f"{BASE}/top-spaces", params={"sort": "views"})).json()["items"]
        row = next(item for item in items if item["space_key"] == key)
        assert row["views"] == 2 and row["saves"] is None
        # saves are not offered for spaces
        assert (await client.get(f"{BASE}/top-spaces", params={"sort": "saves"})).status_code == 422
    finally:
        await client.delete(f"/api/v1/spaces/{key}")


@pytest.mark.integration
@pytest.mark.asyncio
@pytest.mark.parametrize("sort", ["views", "stars", "saves"])
async def test_a_viewed_page_ranks_in_top_pages(
    client: AsyncClient, api_user: User, api_access_token: str, sort: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    key = f"TP{uuid.uuid4().hex[:6]}".upper()
    created = await client.post("/api/v1/spaces", json={"key": key, "name": f"Pages {key}"})
    assert created.status_code in (200, 201), created.text
    try:
        page = await client.post(f"/api/v1/spaces/{key}/pages", json={"title": "Ranked page"})
        assert page.status_code in (200, 201), page.text
        page_id = uuid.UUID(page.json()["id"])
        await record_view("page", page_id)
        await record_view("page", page_id)
        slug = page.json()["slug"]
        assert (await client.put(f"/api/v1/spaces/{key}/pages/{slug}/like")).status_code == 200
        pin = await client.post(f"/api/v1/users/me/pins/{page_id}")
        assert pin.status_code == 204, pin.text
        body = (await client.get(f"{BASE}/top-pages", params={"sort": sort})).json()
        assert body["sort"] == sort
        row = next(item for item in body["items"] if item["id"] == str(page_id))
        assert row["space_key"] == key
        assert (row["views"], row["stars"], row["saves"]) == (2, 1, 1)
    finally:
        await client.delete(f"/api/v1/spaces/{key}")


@pytest.mark.integration
@pytest.mark.asyncio
async def test_heartbeats_count_an_active_person_and_their_time(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    today = datetime.now(UTC).date()
    try:
        assert (await client.post("/api/v1/users/me/activity")).status_code == 204
        # Pretend the first heartbeat was 45 seconds ago and the one before that
        # earlier still: each heartbeat credits the time since the last, at most
        # one heartbeat interval.
        async with get_session_factory()() as session:
            row = await session.get(UserActivityDaily, (api_user.id, today))
            assert row is not None and row.active_seconds == 0
            row.last_active_at = datetime.now(UTC) - timedelta(seconds=45)
            await session.commit()
        assert (await client.post("/api/v1/users/me/activity")).status_code == 204
        async with get_session_factory()() as session:
            row = await session.get(UserActivityDaily, (api_user.id, today))
            row.last_active_at = datetime.now(UTC) - timedelta(minutes=20)
            await session.commit()
        assert (await client.post("/api/v1/users/me/activity")).status_code == 204
        async with get_session_factory()() as session:
            row = await session.get(UserActivityDaily, (api_user.id, today))
            assert 45 + 60 <= row.active_seconds <= 45 + 60 + 1

        body = (await client.get(f"{BASE}/overview", params={"range": "7d"})).json()
        day = next(item for item in body["daily"] if item["day"] == today.isoformat())
        assert day["active_users"] >= 1 and day["active_seconds"] > 0
        assert body["totals"]["daily_active_users"] > 0
        assert body["totals"]["active_seconds"] > 0
        assert body["activity_tracked_since"] <= today.isoformat()
    finally:
        async with get_session_factory()() as session:
            await session.execute(
                UserActivityDaily.__table__.delete().where(UserActivityDaily.user_id == api_user.id)
            )
            await session.commit()
