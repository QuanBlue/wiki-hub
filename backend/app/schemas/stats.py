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
    pages: int
    edits: int
    views: int


class OverviewDay(BaseModel):
    day: date
    edits: int
    views: int
    new_users: int


class ActivityItem(BaseModel):
    id: uuid.UUID
    created_at: datetime
    actor_username: str
    action: str
    entity_type: str
    entity_label: str


class OverviewStats(BaseModel):
    range_days: int
    totals: OverviewTotals
    daily: list[OverviewDay]
    recent_activity: list[ActivityItem]
    #: First day a view was counted; earlier opens were never recorded.
    views_tracked_since: date | None


class AiTotals(BaseModel):
    tokens: int
    prompt_tokens: int
    completion_tokens: int
    calls: int
    users: int


class AiDay(BaseModel):
    day: date
    tokens: int
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


class AiStats(BaseModel):
    range_days: int
    totals: AiTotals
    daily: list[AiDay]
    by_user: list[AiUserUsage]
    by_feature: list[AiFeatureUsage]
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


class TopContent(BaseModel):
    range_days: int
    sort: str
    items: list[TopContentItem]
