"""The content health report and unanswered questions over HTTP: who may see them, and the
actions on them."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select

from app.core import rate_limit
from app.db.session import get_session_factory
from app.models.ai_question import AiQuestionGap
from app.models.user import User
from app.modules.ai.question_gaps import group_key

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


@pytest.fixture(autouse=True)
def _no_rate_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    """The Redis client outlives one test's event loop; the limit itself is tested elsewhere."""

    async def allow(key: str, rule: str) -> None:
        return None

    monkeypatch.setattr(rate_limit, "enforce", allow)


async def _space(client: AsyncClient) -> str:
    key = f"H{uuid.uuid4().hex[:7].upper()}"
    response = await client.post("/api/v1/spaces", json={"key": key, "name": "Health space"})
    assert response.status_code == 201, response.text
    created = await client.post(
        f"/api/v1/spaces/{key}/pages",
        json={
            "title": "Hub",
            "content": f'<p><a href="/spaces/{key}/pages/never-was">gone</a></p>',
        },
    )
    assert created.status_code == 201, created.text
    return key


async def test_a_space_administrator_reads_the_health_report(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    key = await _space(client)

    response = await client.get(f"/api/v1/spaces/{key}/health")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["stale_days"] == 180 and body["recent_days"] == 90
    assert [(link["target_slug"], link["reason"]) for link in body["broken_links"]] == [
        ("never-was", "missing")
    ]
    assert body["broken_total"] == 1
    assert {"stale", "orphans", "duplicates", "semantic"} <= set(body)

    chosen = await client.get(f"/api/v1/spaces/{key}/health?stale_days=365&recent_days=30")
    assert chosen.json()["stale_days"] == 365
    assert (await client.get(f"/api/v1/spaces/{key}/health?stale_days=5")).status_code == 422


async def test_marking_a_page_still_correct(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    key = await _space(client)

    response = await client.post(f"/api/v1/spaces/{key}/pages/hub/review")

    assert response.status_code == 200, response.text
    assert response.json()["reviewed_at"]
    missing = await client.post(f"/api/v1/spaces/{key}/pages/no-such-page/review")
    assert missing.status_code == 404


async def test_a_member_cannot_read_a_space_health_report(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    api_member_user: User,
    api_member_access_token: str,
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    key = await _space(client)

    client.cookies.set("wikihub_access", api_member_access_token)
    assert (await client.get(f"/api/v1/spaces/{key}/health")).status_code == 403
    assert (await client.post(f"/api/v1/spaces/{key}/pages/hub/review")).status_code == 403
    assert (
        await client.post(f"/api/v1/spaces/{key}/pages/hub/stale-check", json={"locale": "en"})
    ).status_code in (403, 503)


async def test_an_unhelpful_answer_is_noted_and_an_administrator_resolves_it(
    client: AsyncClient,
    api_user: User,
    api_access_token: str,
    api_member_user: User,
    api_member_access_token: str,
) -> None:
    question = f"Which printer is on floor {uuid.uuid4().hex[:6]}?"
    key = group_key(question)
    try:
        client.cookies.set("wikihub_access", api_member_access_token)
        sent = await client.post(
            "/api/v1/ai/feedback",
            json={"surface": "chat", "question": question, "answer": "The red one."},
        )
        assert sent.status_code == 204, sent.text
        # A member cannot see what others asked.
        assert (await client.get("/api/v1/ai/questions")).status_code == 403
        assert (
            await client.post(
                f"/api/v1/ai/questions/{key}/resolve", json={"resolution": "dismissed"}
            )
        ).status_code == 403

        client.cookies.set("wikihub_access", api_access_token)
        listed = await client.get("/api/v1/ai/questions")
        assert listed.status_code == 200, listed.text
        body = listed.json()
        assert body["retention_days"] == 90 and isinstance(body["recording"], bool)
        [entry] = [item for item in body["items"] if item["key"] == key]
        assert entry["reasons"] == ["disliked"]
        assert entry["answer_excerpt"] == "The red one."
        assert [asker["id"] for asker in entry["askers"]] == [str(api_member_user.id)]

        dismissed = await client.post(
            f"/api/v1/ai/questions/{key}/resolve", json={"resolution": "dismissed"}
        )
        assert dismissed.status_code == 204, dismissed.text
        again = await client.post(
            f"/api/v1/ai/questions/{key}/resolve", json={"resolution": "dismissed"}
        )
        assert again.status_code == 404
        resolved = (await client.get("/api/v1/ai/questions?status=resolved")).json()["items"]
        assert any(item["key"] == key and item["resolution"] == "dismissed" for item in resolved)

        assert (await client.post(f"/api/v1/ai/questions/{key}/reopen")).status_code == 204
        assert (await client.delete(f"/api/v1/ai/questions/{key}")).status_code == 204
        assert (await client.delete(f"/api/v1/ai/questions/{key}")).status_code == 404
        # Not a key at all.
        assert (await client.delete("/api/v1/ai/questions/not-a-key")).status_code == 422
    finally:
        async with get_session_factory()() as session:
            await session.execute(delete(AiQuestionGap).where(AiQuestionGap.group_key == key))
            await session.commit()


async def test_marking_a_question_answered_with_a_page(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    space = await _space(client)
    question = f"Where is the hub {uuid.uuid4().hex[:6]}?"
    key = group_key(question)
    try:
        await client.post("/api/v1/ai/feedback", json={"surface": "search", "question": question})

        bad_page = await client.post(
            f"/api/v1/ai/questions/{key}/resolve",
            json={"resolution": "answered", "space_key": space, "slug": "no-such-page"},
        )
        assert bad_page.status_code == 404

        done = await client.post(
            f"/api/v1/ai/questions/{key}/resolve",
            json={"resolution": "answered", "space_key": space, "slug": "hub"},
        )
        assert done.status_code == 204, done.text
        resolved = (await client.get("/api/v1/ai/questions?status=resolved")).json()["items"]
        [entry] = [item for item in resolved if item["key"] == key]
        assert entry["answer_page"]["slug"] == "hub"
    finally:
        async with get_session_factory()() as session:
            await session.execute(delete(AiQuestionGap).where(AiQuestionGap.group_key == key))
            await session.commit()


async def test_turning_recording_off_stops_new_notes(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    question = f"Off the record {uuid.uuid4().hex[:6]}"
    try:
        off = await client.put("/api/v1/ai/questions/recording", json={"enabled": False})
        assert off.status_code == 200 and off.json() == {"enabled": False}
        assert (await client.get("/api/v1/ai/questions")).json()["recording"] is False

        await client.post("/api/v1/ai/feedback", json={"surface": "chat", "question": question})

        async with get_session_factory()() as session:
            rows = await session.scalars(
                select(AiQuestionGap).where(AiQuestionGap.question == question)
            )
            assert list(rows) == []
    finally:
        on = await client.put("/api/v1/ai/questions/recording", json={"enabled": True})
        assert on.json() == {"enabled": True}


async def test_feedback_is_validated(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)

    assert (
        await client.post("/api/v1/ai/feedback", json={"surface": "email", "question": "x"})
    ).status_code == 422
    assert (
        await client.post("/api/v1/ai/feedback", json={"surface": "chat", "question": ""})
    ).status_code == 422
    client.cookies.clear()
    assert (
        await client.post("/api/v1/ai/feedback", json={"surface": "chat", "question": "x"})
    ).status_code == 401
