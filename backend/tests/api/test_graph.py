"""The knowledge graph endpoints: a page's related pages, a space's page map."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

from app.db.session import get_session_factory
from app.models.user import User
from app.modules.graph.builder import build_text_edges

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


async def _space_with_pages(client: AsyncClient) -> str:
    key = f"G{uuid.uuid4().hex[:7].upper()}"
    response = await client.post("/api/v1/spaces", json={"key": key, "name": "Graph space"})
    assert response.status_code == 201, response.text
    for title, content in (
        ("Leave policy", "<p>Fill in the leave request form.</p>"),
        ("Leave request form", "<p>Signed by your manager.</p>"),
    ):
        created = await client.post(
            f"/api/v1/spaces/{key}/pages", json={"title": title, "content": content}
        )
        assert created.status_code == 201, created.text
    async with get_session_factory()() as session:
        await build_text_edges(session)
    return key


async def test_related_pages_of_a_page(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    key = await _space_with_pages(client)

    response = await client.get(f"/api/v1/spaces/{key}/pages/leave-policy/related")

    assert response.status_code == 200, response.text
    body = response.json()
    assert [(page["title"], page["via"]) for page in body["pages"]] == [
        ("Leave request form", ["mention"])
    ]
    assert body["mentions"] == [
        {"title": "Leave request form", "slug": "leave-request-form", "space_key": key}
    ]


async def test_related_pages_of_a_missing_page_is_404(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    key = await _space_with_pages(client)

    response = await client.get(f"/api/v1/spaces/{key}/pages/no-such-page/related")

    assert response.status_code == 404


async def test_space_map(client: AsyncClient, api_user: User, api_access_token: str) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    key = await _space_with_pages(client)

    response = await client.get(f"/api/v1/spaces/{key}/graph")

    assert response.status_code == 200, response.text
    body = response.json()
    titles = {node["title"] for node in body["nodes"]}
    assert {"Leave policy", "Leave request form"} <= titles
    assert any(edge["kind"] == "mention" for edge in body["edges"])
    assert body["total_pages"] == len(body["nodes"])
    assert set(body["insights"]) == {"orphans", "bridges", "sparse_groups"}
    assert all("excerpt" in node for node in body["nodes"])


async def test_space_map_keeps_only_the_kinds_asked_for(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    key = await _space_with_pages(client)

    only_tree = await client.get(f"/api/v1/spaces/{key}/graph", params={"kinds": "tree"})
    bad = await client.get(f"/api/v1/spaces/{key}/graph", params={"kinds": "tree,nonsense"})

    assert only_tree.status_code == 200
    assert {edge["kind"] for edge in only_tree.json()["edges"]} <= {"tree"}
    assert bad.status_code == 422


async def test_a_space_with_no_pages_has_an_empty_map(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    key = f"E{uuid.uuid4().hex[:7].upper()}"
    assert (
        await client.post("/api/v1/spaces", json={"key": key, "name": "Empty"})
    ).status_code == 201
    pages = (await client.get(f"/api/v1/spaces/{key}/pages")).json()
    for page in pages:
        await client.delete(f"/api/v1/spaces/{key}/pages/{page['slug']}")

    body = (await client.get(f"/api/v1/spaces/{key}/graph")).json()

    assert body["nodes"] == [] and body["edges"] == [] and body["total_pages"] == 0
    assert body["insights"] == {"orphans": [], "bridges": [], "sparse_groups": []}
    assert body["spaces"] == []


async def test_the_map_of_every_space_draws_ties_between_spaces(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    first = await _space_with_pages(client)
    second = f"G{uuid.uuid4().hex[:7].upper()}"
    assert (
        await client.post("/api/v1/spaces", json={"key": second, "name": "Second"})
    ).status_code == 201
    # A title no other space has: one shared across spaces names neither page.
    unique = f"Holiday calendar {uuid.uuid4().hex[:6]}"
    assert (
        await client.post(
            f"/api/v1/spaces/{first}/pages", json={"title": unique, "content": "<p>x</p>"}
        )
    ).status_code == 201
    assert (
        await client.post(
            f"/api/v1/spaces/{second}/pages",
            json={"title": "Payroll", "content": f"<p>See the {unique}.</p>"},
        )
    ).status_code == 201
    async with get_session_factory()() as session:
        await build_text_edges(session)

    response = await client.get("/api/v1/graph", params={"spaces": f"{first},{second}"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert {space["key"] for space in body["spaces"]} == {first, second}
    by_id = {node["id"]: node for node in body["nodes"]}
    assert any(
        edge["kind"] == "mention"
        and by_id[edge["source"]]["space_key"] == second
        and by_id[edge["target"]]["space_key"] == first
        for edge in body["edges"]
    )
    only_first = (await client.get("/api/v1/graph", params={"spaces": first})).json()
    assert {node["space_key"] for node in only_first["nodes"]} == {first}


async def test_the_map_of_every_space_checks_its_parameters(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    client.cookies.set("wikihub_access", api_access_token)
    assert (await client.get("/api/v1/graph", params={"kinds": "nonsense"})).status_code == 422
    unknown = await client.get("/api/v1/graph", params={"spaces": "NO-SUCH-SPACE"})
    assert unknown.status_code == 200
    assert unknown.json()["nodes"] == []


async def test_graph_endpoints_need_a_session(client: AsyncClient) -> None:
    client.cookies.clear()
    assert (await client.get("/api/v1/spaces/ANY/graph")).status_code == 401
    assert (await client.get("/api/v1/graph")).status_code == 401
