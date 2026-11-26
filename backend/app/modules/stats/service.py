"""Aggregate queries behind the administrator statistics page."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.models.page import PageLike, UserPagePin, WikiPage
from app.models.revision import PageRevision
from app.models.space import Space, SpaceFavorite, SpaceStatus
from app.models.stats import AiUsage, ContentViewDaily, UserActivityDaily
from app.models.user import User
from app.models.user_session import UserSession
from app.schemas.stats import (
    ActivityItem,
    AiDay,
    AiFeatureUsage,
    AiModelUsage,
    AiPreviousTotals,
    AiStats,
    AiTotals,
    AiUserUsage,
    ContributorItem,
    OverviewDay,
    OverviewPreviousTotals,
    OverviewStats,
    OverviewTotals,
    TopContent,
    TopContentItem,
    TopContributors,
)

RANGES = {"7d": 7, "30d": 30, "90d": 90}
MAX_CUSTOM_DAYS = 365
PAGE_SORTS = ("views", "stars", "saves")
SPACE_SORTS = ("views", "stars")


@dataclass(frozen=True)
class StatsWindow:
    days: int
    first: date
    last: date
    start: datetime
    end_exclusive: datetime
    all_days: list[date]
    prev_first: date
    prev_last: date
    prev_start: datetime
    prev_end_exclusive: datetime
    prev_days: list[date]


def resolve_window(
    days: int,
    start_date: date | None = None,
    end_date: date | None = None,
) -> StatsWindow:
    """Build the current and immediately preceding equal-length UTC windows."""
    today = datetime.now(UTC).date()
    if start_date is not None or end_date is not None:
        last = end_date or today
        first = start_date or (last - timedelta(days=days - 1))
        if first > last:
            raise ValueError("start_date must be on or before end_date")
        span = (last - first).days + 1
        if span > MAX_CUSTOM_DAYS:
            raise ValueError(f"Date range cannot exceed {MAX_CUSTOM_DAYS} days")
    else:
        last = today
        first = last - timedelta(days=days - 1)
        span = days

    start = datetime(first.year, first.month, first.day, tzinfo=UTC)
    end_exclusive = datetime(last.year, last.month, last.day, tzinfo=UTC) + timedelta(days=1)
    all_days = [first + timedelta(days=i) for i in range(span)]

    prev_last = first - timedelta(days=1)
    prev_first = prev_last - timedelta(days=span - 1)
    prev_start = datetime(prev_first.year, prev_first.month, prev_first.day, tzinfo=UTC)
    prev_end_exclusive = start
    prev_days = [prev_first + timedelta(days=i) for i in range(span)]

    return StatsWindow(
        days=span,
        first=first,
        last=last,
        start=start,
        end_exclusive=end_exclusive,
        all_days=all_days,
        prev_first=prev_first,
        prev_last=prev_last,
        prev_start=prev_start,
        prev_end_exclusive=prev_end_exclusive,
        prev_days=prev_days,
    )


class StatsService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _scalar(self, stmt: Select) -> int:
        return int((await self.session.scalar(stmt)) or 0)

    async def _per_day(self, column, *where, agg=None) -> dict[date, int]:
        """``count(*)`` (or ``agg``) per UTC day for rows matching ``where``."""
        day = func.date(func.timezone("UTC", column)).label("day")
        stmt = select(day, (agg if agg is not None else func.count()).label("n"))
        rows = await self.session.execute(stmt.where(*where).group_by(day))
        return {row.day: int(row.n) for row in rows}

    # -- overview ----------------------------------------------------------
    async def overview(
        self,
        days: int = 30,
        *,
        window: StatsWindow | None = None,
    ) -> OverviewStats:
        w = window or resolve_window(days)

        edits = await self._per_day(
            PageRevision.created_at,
            PageRevision.created_at >= w.start,
            PageRevision.created_at < w.end_exclusive,
        )
        new_users = await self._per_day(
            User.created_at,
            User.created_at >= w.start,
            User.created_at < w.end_exclusive,
        )
        view_rows = await self.session.execute(
            select(ContentViewDaily.day, func.sum(ContentViewDaily.views))
            .where(
                ContentViewDaily.entity_type == "page",
                ContentViewDaily.day >= w.first,
                ContentViewDaily.day <= w.last,
            )
            .group_by(ContentViewDaily.day)
        )
        views = {row[0]: int(row[1]) for row in view_rows}

        activity_rows = await self.session.execute(
            select(
                UserActivityDaily.day,
                func.count(),
                func.sum(UserActivityDaily.active_seconds),
            )
            .where(UserActivityDaily.day >= w.first, UserActivityDaily.day <= w.last)
            .group_by(UserActivityDaily.day)
        )
        active = {row[0]: (int(row[1]), int(row[2])) for row in activity_rows}
        activity_since = await self.session.scalar(select(func.min(UserActivityDaily.day)))

        tracked_days = sum(1 for d in w.all_days if activity_since and d >= activity_since)
        person_days = sum(people for people, _seconds in active.values())
        active_time = sum(seconds for _people, seconds in active.values())

        new_spaces_count = await self._scalar(
            select(func.count())
            .select_from(Space)
            .where(
                Space.status == SpaceStatus.active,
                Space.created_at >= w.start,
                Space.created_at < w.end_exclusive,
            )
        )
        new_pages_count = await self._scalar(
            select(func.count())
            .select_from(WikiPage)
            .join(Space, Space.id == WikiPage.space_id)
            .where(
                Space.status == SpaceStatus.active,
                WikiPage.created_at >= w.start,
                WikiPage.created_at < w.end_exclusive,
            )
        )

        # Previous equal-length window for period-over-period deltas
        prev_edits = await self._scalar(
            select(func.count())
            .select_from(PageRevision)
            .where(
                PageRevision.created_at >= w.prev_start,
                PageRevision.created_at < w.prev_end_exclusive,
            )
        )
        prev_new_users = await self._scalar(
            select(func.count())
            .select_from(User)
            .where(User.created_at >= w.prev_start, User.created_at < w.prev_end_exclusive)
        )
        prev_views = await self._scalar(
            select(func.coalesce(func.sum(ContentViewDaily.views), 0)).where(
                ContentViewDaily.entity_type == "page",
                ContentViewDaily.day >= w.prev_first,
                ContentViewDaily.day <= w.prev_last,
            )
        )
        prev_active_users = await self._scalar(
            select(func.count(func.distinct(UserSession.user_id))).where(
                UserSession.last_seen_at >= w.prev_start,
                UserSession.last_seen_at < w.prev_end_exclusive,
            )
        )
        prev_activity = (
            await self.session.execute(
                select(
                    func.count(),
                    func.coalesce(func.sum(UserActivityDaily.active_seconds), 0),
                ).where(
                    UserActivityDaily.day >= w.prev_first,
                    UserActivityDaily.day <= w.prev_last,
                )
            )
        ).one()
        prev_person_days = int(prev_activity[0] or 0)
        prev_active_time = int(prev_activity[1] or 0)
        prev_tracked_days = sum(1 for d in w.prev_days if activity_since and d >= activity_since)

        prev_new_spaces = await self._scalar(
            select(func.count())
            .select_from(Space)
            .where(
                Space.status == SpaceStatus.active,
                Space.created_at >= w.prev_start,
                Space.created_at < w.prev_end_exclusive,
            )
        )
        prev_new_pages = await self._scalar(
            select(func.count())
            .select_from(WikiPage)
            .join(Space, Space.id == WikiPage.space_id)
            .where(
                Space.status == SpaceStatus.active,
                WikiPage.created_at >= w.prev_start,
                WikiPage.created_at < w.prev_end_exclusive,
            )
        )

        totals = OverviewTotals(
            users=await self._scalar(select(func.count()).select_from(User)),
            new_users=sum(new_users.values()),
            active_users=await self._scalar(
                select(func.count(func.distinct(UserSession.user_id))).where(
                    UserSession.last_seen_at >= w.start,
                    UserSession.last_seen_at < w.end_exclusive,
                )
            ),
            spaces=await self._scalar(
                select(func.count()).select_from(Space).where(Space.status == SpaceStatus.active)
            ),
            new_spaces=new_spaces_count,
            pages=await self._scalar(
                select(func.count())
                .select_from(WikiPage)
                .join(Space, Space.id == WikiPage.space_id)
                .where(Space.status == SpaceStatus.active)
            ),
            new_pages=new_pages_count,
            edits=sum(edits.values()),
            views=sum(views.values()),
            daily_active_users=round(person_days / tracked_days, 1) if tracked_days else 0,
            active_seconds=active_time // person_days if person_days else 0,
        )
        previous = OverviewPreviousTotals(
            new_users=prev_new_users,
            active_users=prev_active_users,
            new_spaces=prev_new_spaces,
            new_pages=prev_new_pages,
            edits=prev_edits,
            views=prev_views,
            daily_active_users=(
                round(prev_person_days / prev_tracked_days, 1) if prev_tracked_days else 0.0
            ),
            active_seconds=prev_active_time // prev_person_days if prev_person_days else 0,
        )
        recent = (
            await self.session.scalars(
                select(AuditLog).order_by(AuditLog.created_at.desc()).limit(25)
            )
        ).all()
        tracked_since = await self.session.scalar(select(func.min(ContentViewDaily.day)))
        return OverviewStats(
            range_days=w.days,
            start_date=w.first,
            end_date=w.last,
            totals=totals,
            previous=previous,
            daily=[
                OverviewDay(
                    day=d,
                    edits=edits.get(d, 0),
                    views=views.get(d, 0),
                    new_users=new_users.get(d, 0),
                    active_users=active.get(d, (0, 0))[0],
                    active_seconds=active[d][1] // active[d][0] if d in active else 0,
                )
                for d in w.all_days
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
            activity_tracked_since=activity_since,
        )

    # -- AI ------------------------------------------------------------------
    async def ai(
        self,
        days: int = 30,
        *,
        window: StatsWindow | None = None,
    ) -> AiStats:
        w = window or resolve_window(days)
        in_range = (AiUsage.created_at >= w.start, AiUsage.created_at < w.end_exclusive)
        prev_range = (
            AiUsage.created_at >= w.prev_start,
            AiUsage.created_at < w.prev_end_exclusive,
        )

        day_col = func.date(func.timezone("UTC", AiUsage.created_at)).label("day")
        daily_rows = await self.session.execute(
            select(
                day_col,
                func.coalesce(func.sum(AiUsage.total_tokens), 0).label("tokens"),
                func.coalesce(func.sum(AiUsage.prompt_tokens), 0).label("prompt_tokens"),
                func.coalesce(func.sum(AiUsage.completion_tokens), 0).label("completion_tokens"),
                func.count().label("calls"),
            )
            .where(*in_range)
            .group_by(day_col)
        )
        by_day = {
            row.day: (
                int(row.tokens),
                int(row.prompt_tokens),
                int(row.completion_tokens),
                int(row.calls),
            )
            for row in daily_rows
        }

        sums = (
            await self.session.execute(
                select(
                    func.coalesce(func.sum(AiUsage.prompt_tokens), 0),
                    func.coalesce(func.sum(AiUsage.completion_tokens), 0),
                    func.count(),
                    func.count(func.distinct(AiUsage.user_id)),
                ).where(*in_range)
            )
        ).one()

        prev_sums = (
            await self.session.execute(
                select(
                    func.coalesce(func.sum(AiUsage.prompt_tokens), 0),
                    func.coalesce(func.sum(AiUsage.completion_tokens), 0),
                    func.count(),
                    func.count(func.distinct(AiUsage.user_id)),
                ).where(*prev_range)
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
            .where(*in_range)
            .group_by(AiUsage.user_id, User.username, User.full_name)
            .order_by(user_tokens.desc())
            .limit(50)
        )
        feature_tokens = func.sum(AiUsage.total_tokens)
        by_feature = await self.session.execute(
            select(AiUsage.feature, feature_tokens.label("tokens"), func.count().label("calls"))
            .where(*in_range)
            .group_by(AiUsage.feature)
            .order_by(feature_tokens.desc())
        )
        model_tokens = func.sum(AiUsage.total_tokens)
        by_model = await self.session.execute(
            select(AiUsage.model, model_tokens.label("tokens"), func.count().label("calls"))
            .where(*in_range)
            .group_by(AiUsage.model)
            .order_by(model_tokens.desc())
        )
        return AiStats(
            range_days=w.days,
            start_date=w.first,
            end_date=w.last,
            totals=AiTotals(
                tokens=int(sums[0]) + int(sums[1]),
                prompt_tokens=int(sums[0]),
                completion_tokens=int(sums[1]),
                calls=int(sums[2]),
                users=int(sums[3]),
            ),
            previous=AiPreviousTotals(
                tokens=int(prev_sums[0]) + int(prev_sums[1]),
                prompt_tokens=int(prev_sums[0]),
                completion_tokens=int(prev_sums[1]),
                calls=int(prev_sums[2]),
                users=int(prev_sums[3]),
            ),
            daily=[
                AiDay(
                    day=d,
                    tokens=by_day.get(d, (0, 0, 0, 0))[0],
                    prompt_tokens=by_day.get(d, (0, 0, 0, 0))[1],
                    completion_tokens=by_day.get(d, (0, 0, 0, 0))[2],
                    calls=by_day.get(d, (0, 0, 0, 0))[3],
                )
                for d in w.all_days
            ],
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
            by_model=[
                AiModelUsage(
                    model=row.model or "unknown",
                    tokens=int(row.tokens),
                    calls=int(row.calls),
                )
                for row in by_model
            ],
            tracked_since=await self.session.scalar(select(func.min(AiUsage.created_at))),
        )

    # -- top content -----------------------------------------------------------
    async def top_pages(
        self,
        days: int = 30,
        sort: str = "views",
        limit: int = 15,
        *,
        window: StatsWindow | None = None,
    ) -> TopContent:
        w = window or resolve_window(days)
        views = (
            select(
                ContentViewDaily.entity_id.label("id"),
                func.sum(ContentViewDaily.views).label("n"),
            )
            .where(
                ContentViewDaily.entity_type == "page",
                ContentViewDaily.day >= w.first,
                ContentViewDaily.day <= w.last,
            )
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
            range_days=w.days,
            start_date=w.first,
            end_date=w.last,
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

    async def top_spaces(
        self,
        days: int = 30,
        sort: str = "views",
        limit: int = 15,
        *,
        window: StatsWindow | None = None,
    ) -> TopContent:
        w = window or resolve_window(days)
        views = (
            select(
                ContentViewDaily.entity_id.label("id"),
                func.sum(ContentViewDaily.views).label("n"),
            )
            .where(
                ContentViewDaily.entity_type == "space",
                ContentViewDaily.day >= w.first,
                ContentViewDaily.day <= w.last,
            )
            .group_by(ContentViewDaily.entity_id)
            .subquery()
        )
        stars = (
            select(SpaceFavorite.space_id.label("id"), func.count().label("n"))
            .group_by(SpaceFavorite.space_id)
            .subquery()
        )
        page_counts = (
            select(WikiPage.space_id.label("id"), func.count().label("n"))
            .group_by(WikiPage.space_id)
            .subquery()
        )
        v, s, pc = (
            func.coalesce(views.c.n, 0),
            func.coalesce(stars.c.n, 0),
            func.coalesce(page_counts.c.n, 0),
        )
        metric = {"views": v, "stars": s}[sort]
        rows = await self.session.execute(
            select(Space, v.label("v"), s.label("s"), pc.label("pc"))
            .outerjoin(views, views.c.id == Space.id)
            .outerjoin(stars, stars.c.id == Space.id)
            .outerjoin(page_counts, page_counts.c.id == Space.id)
            .where(Space.status == SpaceStatus.active, metric > 0)
            .order_by(metric.desc(), Space.name)
            .limit(limit)
        )
        return TopContent(
            range_days=w.days,
            start_date=w.first,
            end_date=w.last,
            sort=sort,
            items=[
                TopContentItem(
                    id=space.id,
                    title=space.name,
                    space_key=space.key,
                    space_name=space.name,
                    views=int(nv),
                    stars=int(ns),
                    page_count=int(npc),
                )
                for space, nv, ns, npc in rows
            ],
        )

    async def top_contributors(
        self,
        days: int = 30,
        limit: int = 10,
        *,
        window: StatsWindow | None = None,
    ) -> TopContributors:
        w = window or resolve_window(days)
        edits_rows = await self.session.execute(
            select(
                PageRevision.created_by_id.label("user_id"),
                func.count().label("edits"),
            )
            .where(
                PageRevision.created_by_id.is_not(None),
                PageRevision.created_at >= w.start,
                PageRevision.created_at < w.end_exclusive,
            )
            .group_by(PageRevision.created_by_id)
        )
        edits_by_user = {row.user_id: int(row.edits) for row in edits_rows}

        pages_rows = await self.session.execute(
            select(
                WikiPage.created_by_id.label("user_id"),
                func.count().label("pages_created"),
            )
            .join(Space, Space.id == WikiPage.space_id)
            .where(
                Space.status == SpaceStatus.active,
                WikiPage.created_by_id.is_not(None),
                WikiPage.created_at >= w.start,
                WikiPage.created_at < w.end_exclusive,
            )
            .group_by(WikiPage.created_by_id)
        )
        pages_by_user = {row.user_id: int(row.pages_created) for row in pages_rows}

        all_user_ids = set(edits_by_user) | set(pages_by_user)
        if not all_user_ids:
            return TopContributors(
                range_days=w.days,
                start_date=w.first,
                end_date=w.last,
                items=[],
            )

        users = (
            await self.session.scalars(select(User).where(User.id.in_(all_user_ids)))
        ).all()
        user_map = {u.id: u for u in users}

        combined = [
            ContributorItem(
                user_id=uid,
                username=user_map[uid].username if uid in user_map else "",
                full_name=user_map[uid].full_name if uid in user_map else None,
                edits=edits_by_user.get(uid, 0),
                pages_created=pages_by_user.get(uid, 0),
            )
            for uid in all_user_ids
        ]
        combined.sort(key=lambda item: (-(item.edits + item.pages_created), -item.edits, item.username))
        return TopContributors(
            range_days=w.days,
            start_date=w.first,
            end_date=w.last,
            items=combined[:limit],
        )
