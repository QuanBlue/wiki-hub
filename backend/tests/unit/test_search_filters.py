"""Unit tests for search filter parsing and date parsing."""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

import app.modules.search.service as search_module
from app.models.page import WikiPage
from app.models.permission import Permission
from app.modules.search.filters import (
    SearchFilters,
    build_page_filter_clauses,
    parse_date_spec,
    parse_search_query,
)
from app.modules.search.query import Concept
from app.modules.search.service import SearchService


def test_build_page_filter_clauses() -> None:
    filters = SearchFilters(
        spaces=["ENG"],
        authors=["john"],
        labels=["runbook"],
        types=["pdf"],
        updated_after=datetime(2026, 1, 1, tzinfo=UTC),
        updated_before=datetime(2026, 12, 31, tzinfo=UTC),
    )
    clauses = build_page_filter_clauses(WikiPage, filters)
    assert len(clauses) == 6


@pytest.mark.asyncio
async def test_search_service_filter_only(monkeypatch: pytest.MonkeyPatch) -> None:
    visible_space = SimpleNamespace(id="s1", key="ENG", name="Engineering", description="Eng space")
    page_1 = SimpleNamespace(
        id="p1",
        title="Deploy runbook",
        slug="deploy-runbook",
        content="<p>Steps to deploy</p>",
        updated_at=datetime.now(UTC),
        space=visible_space,
    )
    first_res = Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=[visible_space]))))
    second_res = Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=[page_1]))))
    session = Mock(execute=AsyncMock(side_effect=[first_res, second_res]))
    permissions = SimpleNamespace(
        effective_permissions=AsyncMock(return_value=[Permission.view]),
        can_view_page=AsyncMock(return_value=True),
    )
    monkeypatch.setattr(search_module, "PermissionService", lambda _session: permissions)

    service = SearchService(session)
    result = await service.search("space:ENG", SimpleNamespace(id="u1"))
    assert result.query == "space:ENG"
    assert result.filters is not None
    assert result.filters["spaces"] == ["ENG"]
    assert len(result.spaces) == 1
    assert result.spaces[0].key == "ENG"
    assert len(result.pages) == 1
    assert result.pages[0].title == "Deploy runbook"


@pytest.mark.asyncio
async def test_search_service_uses_explicit_filters_and_raw_display_query() -> None:
    service = SearchService(Mock(execute=AsyncMock()))
    service._search_pages = AsyncMock(return_value=([], []))
    filters = SearchFilters(types=["pdf"])
    result = await service.search(
        "invoice", SimpleNamespace(id="viewer"), filters=filters,
        raw_query="invoice type:pdf",
    )
    assert result.query == "invoice type:pdf"
    assert result.filters is not None and result.filters["types"] == ["pdf"]
    assert result.spaces == []
    assert filters.viewer_id == "viewer"


@pytest.mark.asyncio
async def test_filter_only_pages_skips_hidden_pages_and_stops_at_limit() -> None:
    space = SimpleNamespace(key="ENG", name="Engineering")
    pages = [
        SimpleNamespace(id=f"p{n}", title=f"Page {n}", slug=f"page-{n}",
                        content="<p>Visible</p>", updated_at=datetime.now(UTC), space=space)
        for n in range(3)
    ]
    rows = Mock(scalars=Mock(return_value=Mock(all=Mock(return_value=pages))))
    service = SearchService(Mock(execute=AsyncMock(return_value=rows)))
    service._matching_files = AsyncMock(return_value={})
    permissions = SimpleNamespace(
        can_view_page=AsyncMock(side_effect=[False, True, True])
    )
    result = await service._filter_only_pages(
        SimpleNamespace(id="viewer"), 1, permissions, SearchFilters(), []
    )
    assert [page.title for page in result] == ["Page 1"]
    assert permissions.can_view_page.await_count == 2


@pytest.mark.asyncio
async def test_file_hits_apply_attachment_type_but_ignore_page_type() -> None:
    session = Mock()
    session.begin_nested = Mock(return_value=AsyncMock())
    session.execute = AsyncMock(return_value=Mock(all=Mock(return_value=[])))
    service = SearchService(session)
    service._idea_weights = AsyncMock(return_value=([1.0], 0.0))
    result = await service._file_hits(
        "invoice", [Concept(("invoice",))], 5,
        filters=SearchFilters(types=["page", "pdf"]),
    )
    assert result == {}
    session.execute.assert_awaited_once()


def test_parse_date_spec() -> None:
    # Month with >
    after, before = parse_date_spec(">2026-01")
    assert after == datetime(2026, 1, 1, 0, 0, 0, tzinfo=UTC)
    assert before is None

    # Month with >=
    after, before = parse_date_spec(">=2026-01")
    assert after == datetime(2026, 1, 1, 0, 0, 0, tzinfo=UTC)
    assert before is None

    # Month with <
    after, before = parse_date_spec("<2026-05")
    assert after is None
    assert before == datetime(2026, 5, 1, 0, 0, 0, tzinfo=UTC)

    # Month with <=
    after, before = parse_date_spec("<=2026-02")
    assert after is None
    # 2026 is not a leap year, Feb has 28 days
    assert before == datetime(2026, 2, 28, 23, 59, 59, 999999, tzinfo=UTC)

    # Exact month
    after, before = parse_date_spec("2026-03")
    assert after == datetime(2026, 3, 1, 0, 0, 0, tzinfo=UTC)
    assert before == datetime(2026, 3, 31, 23, 59, 59, 999999, tzinfo=UTC)

    # Specific date with >
    after, before = parse_date_spec(">2026-01-15")
    assert after == datetime(2026, 1, 15, 23, 59, 59, 999999, tzinfo=UTC)
    assert before is None

    # Specific date with >=
    after, before = parse_date_spec(">=2026-01-15")
    assert after == datetime(2026, 1, 15, 0, 0, 0, tzinfo=UTC)
    assert before is None

    # Specific date exact
    after, before = parse_date_spec("2026-01-15")
    assert after == datetime(2026, 1, 15, 0, 0, 0, tzinfo=UTC)
    assert before == datetime(2026, 1, 15, 23, 59, 59, 999999, tzinfo=UTC)


@pytest.mark.parametrize(
    ("spec", "after", "before"),
    [
        (">2025", datetime(2026, 1, 1, tzinfo=UTC), None),
        (">=2025", datetime(2025, 1, 1, tzinfo=UTC), None),
        ("<2026-03-01", None, datetime(2026, 3, 1, tzinfo=UTC)),
        ("<=2026-03-01", None, datetime(2026, 3, 1, 23, 59, 59, 999999, tzinfo=UTC)),
        ("<2026", None, datetime(2026, 1, 1, tzinfo=UTC)),
        ("<=2026", None, datetime(2026, 12, 31, 23, 59, 59, 999999, tzinfo=UTC)),
        ("2026", datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 12, 31, 23, 59, 59, 999999, tzinfo=UTC)),
    ],
)
def test_parse_date_spec_year_and_day_boundaries(spec: str, after: datetime | None, before: datetime | None) -> None:
    assert parse_date_spec(spec) == (after, before)


def test_date_token_before_and_page_type_filter() -> None:
    parsed = parse_search_query("date:<2026-03 type:page")
    assert parsed.clean_query == ""
    assert parsed.filters.updated_before == datetime(2026, 3, 1, tzinfo=UTC)
    clauses = build_page_filter_clauses(WikiPage, parsed.filters)
    assert len(clauses) == 1


def test_private_label_filter_with_known_viewer() -> None:
    filters = SearchFilters(labels=["runbook"], viewer_id="u1")
    assert len(build_page_filter_clauses(WikiPage, filters)) == 1


def test_parse_search_query_all_filters() -> None:
    raw = "space:ENG author:alice label:runbook type:pdf updated:>2026-01 incident checklist"
    parsed = parse_search_query(raw)
    assert parsed.clean_query == "incident checklist"
    assert parsed.filters.spaces == ["ENG"]
    assert parsed.filters.authors == ["alice"]
    assert parsed.filters.labels == ["runbook"]
    assert parsed.filters.types == ["pdf"]
    assert parsed.filters.updated_after == datetime(2026, 1, 1, 0, 0, 0, tzinfo=UTC)


def test_parse_search_query_quotes_and_aliases() -> None:
    raw = 'space:"Engineering Docs" creator:"Bob Dylan" tag:"post-mortem" ext:.docx'
    parsed = parse_search_query(raw)
    assert parsed.clean_query == ""
    assert parsed.filters.spaces == ["Engineering Docs"]
    assert parsed.filters.authors == ["Bob Dylan"]
    assert parsed.filters.labels == ["post-mortem"]
    assert parsed.filters.types == ["docx"]


def test_parse_search_query_empty_or_plain() -> None:
    parsed = parse_search_query("plain query without filters")
    assert parsed.clean_query == "plain query without filters"
    assert parsed.filters.is_empty is True


@pytest.mark.asyncio
async def test_search_route_filter_only_does_not_search_the_raw_string() -> None:
    """``space:ENG`` alone must reach the service as filters + empty text, not as a keyword."""
    from app.api.v1.search import search as search_route

    service = SimpleNamespace(search=AsyncMock(return_value="ok"))
    out = await search_route(
        SimpleNamespace(id="u1"),  # type: ignore[arg-type]
        service,  # type: ignore[arg-type]
        q="space:ENG",
        limit=20,
        space=None,
        author=None,
        label=None,
        type=None,
        updated=None,
    )
    assert out == "ok"
    kwargs = service.search.await_args.kwargs
    assert kwargs["query"] == ""
    assert kwargs["filters"].spaces == ["ENG"]
    assert kwargs["raw_query"] == "space:ENG"


@pytest.mark.asyncio
async def test_search_route_merges_explicit_filter_parameters() -> None:
    from app.api.v1.search import search as search_route

    service = SimpleNamespace(search=AsyncMock(return_value="found"))
    result = await search_route(
        SimpleNamespace(id="u1"), service, q="incident", limit=10,
        space="ENG", author="alice", label="runbook", type=".PDF", updated="2026",
    )
    assert result == "found"
    kwargs = service.search.await_args.kwargs
    filters = kwargs["filters"]
    assert kwargs["query"] == "incident"
    assert filters.spaces == ["ENG"]
    assert filters.authors == ["alice"]
    assert filters.labels == ["runbook"]
    assert filters.types == ["pdf"]
    assert filters.updated_after == datetime(2026, 1, 1, tzinfo=UTC)
    assert filters.updated_before == datetime(2026, 12, 31, 23, 59, 59, 999999, tzinfo=UTC)

    await search_route(
        SimpleNamespace(id="u1"), service, q="", limit=20,
        space=None, author=None, label=None, type=".", updated=">2026",
    )
    assert service.search.await_args.kwargs["filters"].types == []


@pytest.mark.parametrize("bad", ["2026-13", "2026-02-30", "0000", ">2026-00", "abc", ""])
def test_parse_date_spec_impossible_dates_are_no_filter(bad: str) -> None:
    assert parse_date_spec(bad) == (None, None)


def test_unparseable_updated_token_stays_in_the_text() -> None:
    parsed = parse_search_query("updated:soon deploy")
    assert parsed.filters.is_empty
    assert parsed.clean_query == "updated:soon deploy"
