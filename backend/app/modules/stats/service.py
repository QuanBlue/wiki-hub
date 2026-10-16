"""Aggregate queries behind the administrator statistics page."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.models.page import PageLike, UserPagePin, WikiPage
from app.models.revision import PageRevision
from app.models.space import Space, SpaceFavorite, SpaceStatus
from app.models.stats import AiUsage, ContentViewDaily
from app.models.user import User
from app.models.user_session import UserSession
from app.schemas.stats import (
    ActivityItem,
    AiDay,
    AiFeatureUsage,
    AiStats,
    AiTotals,
    AiUserUsage,
    OverviewDay,
    OverviewStats,
    OverviewTotals,
    TopContent,
    TopContentItem,
)

RANGES = {"7d": 7, "30d": 30, "90d": 90}
PAGE_SORTS = ("views", "stars", "saves")
SPACE_SORTS = ("views", "stars")


def _window(days: int) -> tuple[datetime, date, list[date]]:
    """Start of the window (UTC midnight), its first day, and every day in it."""
    today = datetime.now(UTC).date()
    first = today - timedelta(days=days - 1)
    start = datetime(first.year, first.month, first.day, tzinfo=UTC)
    return start, first, [first + timedelta(days=i) for i in range(days)]


class StatsService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _scalar(self, stmt: Select) -> int:
        return int((await self.session.scalar(stmt)) or 0)

    async def _per_day(self, column, where, *, agg=None) -> dict[date, int]:
        """``count(*)`` (or ``agg``) per UTC day for rows matching ``where``."""
        day = func.date(func.timezone("UTC", column)).label("day")
        stmt = select(day, (agg if agg is not None else func.count()).label("n"))
        rows = await self.session.execute(stmt.where(where).group_by(day))
        return {row.day: int(row.n) for row in rows}

    # -- overview ----------------------------------------------------------
    async def overview(self, days: int) -> OverviewStats:
        start, first, all_days = _window(days)

        edits = await self._per_day(PageRevision.created_at, PageRevision.created_at >= start)
        new_users = await self._per_day(User.created_at, User.created_at >= start)
        view_rows = await self.session.execute(
            select(ContentViewDaily.day, func.sum(ContentViewDaily.views))
            .where(ContentViewDaily.entity_type == "page", ContentViewDaily.day >= first)
            .group_by(ContentViewDaily.day)
        )
        views = {row[0]: int(row[1]) for row in view_rows}

        totals = OverviewTotals(
            users=await self._scalar(select(func.count()).select_from(User)),
            new_users=sum(new_users.values()),
            active_users=await self._scalar(
                select(func.count(func.distinct(UserSession.user_id))).where(
                    UserSession.last_seen_at >= start
                )
            ),
            spaces=await self._scalar(
                select(func.count()).select_from(Space).where(Space.status == SpaceStatus.active)
            ),
            pages=await self._scalar(
                select(func.count())
                .select_from(WikiPage)
                .join(Space, Space.id == WikiPage.space_id)
                .where(Space.status == SpaceStatus.active)
            ),
            edits=sum(edits.values()),
            views=sum(views.values()),
        )
        recent = (
            await self.session.scalars(
                select(AuditLog).order_by(AuditLog.created_at.desc()).limit(12)
            )
        ).all()
        tracked_since = await self.session.scalar(select(func.min(ContentViewDaily.day)))
        return OverviewStats(
            range_days=days,
            totals=totals,
            daily=[
                OverviewDay(
                    day=d,
                    edits=edits.get(d, 0),
                    views=views.get(d, 0),
                    new_users=new_users.get(d, 0),
                )
                for d in all_days
            ],
            recent_activity=[
                ActivityItem(
                    id=row.id,
                    created_at=row.created_at,
                    actor_username=row.actor_username,
                    action=row.action,
                    entity_type=row.entity_type,
                    entity_label=row.entity_label,
                )
                for row in recent
            ],
            views_tracked_since=tracked_since,
        )

    # -- AI ------------------------------------------------------------------
    async def ai(self, days: int) -> AiStats:
        start, _first, all_days = _window(days)
        in_range = AiUsage.created_at >= start

        tokens = await self._per_day(
            AiUsage.created_at, in_range, agg=func.sum(AiUsage.total_tokens)
        )
        calls = await self._per_day(AiUsage.created_at, in_range)

        sums = (
            await self.session.execute(
                select(
                    func.coalesce(func.sum(AiUsage.prompt_tokens), 0),
                    func.coalesce(func.sum(AiUsage.completion_tokens), 0),
                    func.count(),
                    func.count(func.distinct(AiUsage.user_id)),
                ).where(in_range)
            )
        ).one()

        user_tokens = func.sum(AiUsage.total_tokens)
        by_user = await self.session.execute(
            select(
                AiUsage.user_id,
                func.coalesce(User.username, "").label("username"),
                User.full_name,
                user_tokens.label("tokens"),
                func.count().label("calls"),
            )
            .outerjoin(User, User.id == AiUsage.user_id)
            .where(in_range)
            .group_by(AiUsage.user_id, User.username, User.full_name)
            .order_by(user_tokens.desc())
            .limit(50)
        )
        feature_tokens = func.sum(AiUsage.total_tokens)
        by_feature = await self.session.execute(
            select(AiUsage.feature, feature_tokens.label("tokens"), func.count().label("calls"))
            .where(in_range)
            .group_by(AiUsage.feature)
            .order_by(feature_tokens.desc())
        )
        return AiStats(
            range_days=days,
            totals=AiTotals(
                tokens=int(sums[0]) + int(sums[1]),
                prompt_tokens=int(sums[0]),
                completion_tokens=int(sums[1]),
                calls=int(sums[2]),
                users=int(sums[3]),
            ),
            daily=[AiDay(day=d, tokens=tokens.get(d, 0), calls=calls.get(d, 0)) for d in all_days],
            by_user=[
                AiUserUsage(
                    user_id=row.user_id,
                    username=row.username,
                    full_name=row.full_name,
                    tokens=int(row.tokens),
                    calls=int(row.calls),
                )
                for row in by_user
            ],
            by_feature=[
                AiFeatureUsage(feature=row.feature, tokens=int(row.tokens), calls=int(row.calls))
                for row in by_feature
            ],
            tracked_since=await self.session.scalar(select(func.min(AiUsage.created_at))),
        )

    # -- top content -----------------------------------------------------------
    async def top_pages(self, days: int, sort: str, limit: int = 10) -> TopContent:
        _start, first, _days = _window(days)
        views = (
            select(
                ContentViewDaily.entity_id.label("id"),
                func.sum(ContentViewDaily.views).label("n"),
            )
            .where(ContentViewDaily.entity_type == "page", ContentViewDaily.day >= first)
            .group_by(ContentViewDaily.entity_id)
            .subquery()
        )
        stars = (
            select(PageLike.page_id.label("id"), func.count().label("n"))
            .group_by(PageLike.page_id)
            .subquery()
        )
        saves = (
            select(UserPagePin.page_id.label("id"), func.count().label("n"))
            .group_by(UserPagePin.page_id)
            .subquery()
        )
        v, s, p = (
            func.coalesce(views.c.n, 0),
            func.coalesce(stars.c.n, 0),
            func.coalesce(saves.c.n, 0),
        )
        metric = {"views": v, "stars": s, "saves": p}[sort]
        rows = await self.session.execute(
            select(WikiPage, Space, v.label("v"), s.label("s"), p.label("p"))
            .join(Space, Space.id == WikiPage.space_id)
            .outerjoin(views, views.c.id == WikiPage.id)
            .outerjoin(stars, stars.c.id == WikiPage.id)
            .outerjoin(saves, saves.c.id == WikiPage.id)
            .where(Space.status == SpaceStatus.active, metric > 0)
            .order_by(metric.desc(), WikiPage.title)
            .limit(limit)
        )
        return TopContent(
            range_days=days,
            sort=sort,
            items=[
                TopContentItem(
                    id=page.id,
                    title=page.title,
                    slug=page.slug,
                    space_key=space.key,
                    space_name=space.name,
                    views=int(nv),
                    stars=int(ns),
                    saves=int(np_),
                )
                for page, space, nv, ns, np_ in rows
            ],
        )

    async def top_spaces(self, days: int, sort: str, limit: int = 10) -> TopContent:
        _start, first, _days = _window(days)
        views = (
            select(
                ContentViewDaily.entity_id.label("id"),
                func.sum(ContentViewDaily.views).label("n"),
            )
            .where(ContentViewDaily.entity_type == "space", ContentViewDaily.day >= first)
            .group_by(ContentViewDaily.entity_id)
            .subquery()
        )
        stars = (
            select(SpaceFavorite.space_id.label("id"), func.count().label("n"))
            .group_by(SpaceFavorite.space_id)
            .subquery()
        )
        v, s = func.coalesce(views.c.n, 0), func.coalesce(stars.c.n, 0)
        metric = {"views": v, "stars": s}[sort]
        rows = await self.session.execute(
            select(Space, v.label("v"), s.label("s"))
            .outerjoin(views, views.c.id == Space.id)
            .outerjoin(stars, stars.c.id == Space.id)
            .where(Space.status == SpaceStatus.active, metric > 0)
            .order_by(metric.desc(), Space.name)
            .limit(limit)
        )
        return TopContent(
            range_days=days,
            sort=sort,
            items=[
                TopContentItem(
                    id=space.id,
                    title=space.name,
                    space_key=space.key,
                    space_name=space.name,
                    views=int(nv),
                    stars=int(ns),
                )
                for space, nv, ns in rows
            ],
        )
