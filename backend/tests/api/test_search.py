"""Tests for search endpoints and search service."""

from httpx import AsyncClient

from app.modules.search.service import extract_snippet


def test_extract_snippet_basic() -> None:
    content = "<p>This is a test paragraph for <strong>search indexing</strong> in WikiHub.</p>"
    snippet = extract_snippet(content, "search")
    assert "search indexing" in snippet
    assert "<p>" not in snippet


def test_extract_snippet_empty_or_no_match() -> None:
    assert extract_snippet("", "search") == ""
    content = "Just plain text without match."
    snippet = extract_snippet(content, "nonexistent")
    assert snippet == "Just plain text without match."


async def test_search_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/api/v1/search?q=test")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"
