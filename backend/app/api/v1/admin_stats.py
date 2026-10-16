"""Administrator statistics: read-only aggregates over usage."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from app.api.deps import CurrentSuperuser, DbSession
from app.modules.stats.service import RANGES, StatsService
from app.schemas.stats import AiStats, OverviewStats, TopContent

router = APIRouter(prefix="/admin/statistics", tags=["admin-statistics"])


def get_stats_service(session: DbSession) -> StatsService:
    return StatsService(session)


StatsServiceDep = Annotated[StatsService, Depends(get_stats_service)]
RangeParam = Annotated[Literal["7d", "30d", "90d"], Query(alias="range")]


@router.get("/overview", response_model=OverviewStats, summary="Users, edits, views and activity")
async def overview(
    _admin: CurrentSuperuser, service: StatsServiceDep, range_: RangeParam = "30d"
) -> OverviewStats:
    return await service.overview(RANGES[range_])


@router.get("/ai", response_model=AiStats, summary="AI token usage")
async def ai_usage(
    _admin: CurrentSuperuser, service: StatsServiceDep, range_: RangeParam = "30d"
) -> AiStats:
    return await service.ai(RANGES[range_])


@router.get("/top-pages", response_model=TopContent, summary="Most viewed, starred or saved pages")
async def top_pages(
    _admin: CurrentSuperuser,
    service: StatsServiceDep,
    range_: RangeParam = "30d",
    sort: Literal["views", "stars", "saves"] = "views",
) -> TopContent:
    return await service.top_pages(RANGES[range_], sort)


@router.get("/top-spaces", response_model=TopContent, summary="Most viewed or starred spaces")
async def top_spaces(
    _admin: CurrentSuperuser,
    service: StatsServiceDep,
    range_: RangeParam = "30d",
    sort: Literal["views", "stars"] = "views",
) -> TopContent:
    return await service.top_spaces(RANGES[range_], sort)
