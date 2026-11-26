"""Administrator statistics: read-only aggregates over usage."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import CurrentSuperuser, DbSession
from app.modules.stats.service import RANGES, StatsService, StatsWindow, resolve_window
from app.schemas.stats import AiStats, OverviewStats, TopContent, TopContributors

router = APIRouter(prefix="/admin/statistics", tags=["admin-statistics"])


def get_stats_service(session: DbSession) -> StatsService:
    return StatsService(session)


StatsServiceDep = Annotated[StatsService, Depends(get_stats_service)]
RangeParam = Annotated[Literal["7d", "30d", "90d"], Query(alias="range")]
StartParam = Annotated[date | None, Query(alias="start")]
EndParam = Annotated[date | None, Query(alias="end")]


def _build_window(range_: str, start: date | None, end: date | None) -> StatsWindow:
    try:
        return resolve_window(RANGES[range_], start_date=start, end_date=end)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/overview", response_model=OverviewStats, summary="Users, edits, views and activity")
async def overview(
    _admin: CurrentSuperuser,
    service: StatsServiceDep,
    range_: RangeParam = "30d",
    start: StartParam = None,
    end: EndParam = None,
) -> OverviewStats:
    return await service.overview(window=_build_window(range_, start, end))


@router.get("/ai", response_model=AiStats, summary="AI token usage")
async def ai_usage(
    _admin: CurrentSuperuser,
    service: StatsServiceDep,
    range_: RangeParam = "30d",
    start: StartParam = None,
    end: EndParam = None,
) -> AiStats:
    return await service.ai(window=_build_window(range_, start, end))


@router.get("/top-pages", response_model=TopContent, summary="Most viewed, starred or saved pages")
async def top_pages(
    _admin: CurrentSuperuser,
    service: StatsServiceDep,
    range_: RangeParam = "30d",
    start: StartParam = None,
    end: EndParam = None,
    sort: Literal["views", "stars", "saves"] = "views",
) -> TopContent:
    return await service.top_pages(sort=sort, window=_build_window(range_, start, end))


@router.get("/top-spaces", response_model=TopContent, summary="Most viewed or starred spaces")
async def top_spaces(
    _admin: CurrentSuperuser,
    service: StatsServiceDep,
    range_: RangeParam = "30d",
    start: StartParam = None,
    end: EndParam = None,
    sort: Literal["views", "stars"] = "views",
) -> TopContent:
    return await service.top_spaces(sort=sort, window=_build_window(range_, start, end))


@router.get(
    "/top-contributors",
    response_model=TopContributors,
    summary="Most active page editors and authors",
)
async def top_contributors(
    _admin: CurrentSuperuser,
    service: StatsServiceDep,
    range_: RangeParam = "30d",
    start: StartParam = None,
    end: EndParam = None,
) -> TopContributors:
    return await service.top_contributors(window=_build_window(range_, start, end))
