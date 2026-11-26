"""Administrator statistics schemas."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel


class OverviewTotals(BaseModel):
    users: int
    new_users: int
    active_users: int
    spaces: int
    new_spaces: int = 0
    pages: int
    new_pages: int = 0
    edits: int
    views: int
    #: Average people active per day, over the days activity was tracked.
    daily_active_users: float
    #: Average time one active person spent in the app on a day, in seconds.
    active_seconds: int


class OverviewPreviousTotals(BaseModel):
    new_users: int = 0
    active_users: int = 0
    new_spaces: int = 0
    new_pages: int = 0
    edits: int = 0
    views: int = 0
    daily_active_users: float = 0.0
    active_seconds: int = 0


class OverviewDay(BaseModel):
    day: date
    edits: int
    views: int
    new_users: int
    active_users: int
    #: Average time each of that day's active people spent in the app, in seconds.
    active_seconds: int


class ActivityItem(BaseModel):
    id: uuid.UUID
    created_at: datetime
    actor_username: str
    action: str
    entity_type: str
    entity_label: str


class OverviewStats(BaseModel):
    range_days: int
    start_date: date
    end_date: date
    totals: OverviewTotals
    previous: OverviewPreviousTotals
    daily: list[OverviewDay]
    recent_activity: list[ActivityItem]
    #: First day a view was counted; earlier opens were never recorded.
    views_tracked_since: date | None
    #: First day activity was recorded; earlier days show no active people.
    activity_tracked_since: date | None


class AiTotals(BaseModel):
    tokens: int
    prompt_tokens: int
    completion_tokens: int
    calls: int
    users: int


class AiPreviousTotals(BaseModel):
    tokens: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    calls: int = 0
    users: int = 0


class AiDay(BaseModel):
    day: date
    tokens: int
    prompt_tokens: int = 0
    completion_tokens: int = 0
    calls: int


class AiUserUsage(BaseModel):
    user_id: uuid.UUID | None
    username: str
    full_name: str | None
    tokens: int
    calls: int


class AiFeatureUsage(BaseModel):
    feature: str
    tokens: int
    calls: int


class AiModelUsage(BaseModel):
    model: str
    tokens: int
    calls: int


class AiStats(BaseModel):
    range_days: int
    start_date: date
    end_date: date
    totals: AiTotals
    previous: AiPreviousTotals
    daily: list[AiDay]
    by_user: list[AiUserUsage]
    by_feature: list[AiFeatureUsage]
    by_model: list[AiModelUsage]
    #: First time usage was recorded; earlier requests were never counted.
    tracked_since: datetime | None


class TopContentItem(BaseModel):
    id: uuid.UUID
    title: str
    #: Page slug; ``None`` for a space.
    slug: str | None = None
    space_key: str
    space_name: str
    views: int
    stars: int
    #: ``None`` for spaces, which cannot be saved.
    saves: int | None = None
    #: Total active pages inside a space; ``None`` for pages.
    page_count: int | None = None


class TopContent(BaseModel):
    range_days: int
    start_date: date
    end_date: date
    sort: str
    items: list[TopContentItem]


class ContributorItem(BaseModel):
    user_id: uuid.UUID | None
    username: str
    full_name: str | None
    edits: int
    pages_created: int


class TopContributors(BaseModel):
    range_days: int
    start_date: date
    end_date: date
    items: list[ContributorItem]
