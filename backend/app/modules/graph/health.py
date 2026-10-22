"""A space's content health: what an administrator should look at to keep it in shape.

Four lists, worked out when asked for (nothing is stored but the "still correct" marks):

* **stale** - pages not edited for a long while although pages tied to them (links,
  mentions, likeness, parent or child) were edited recently, after them: what they say may
  have been overtaken. A page marked still correct (``page_reviews``) counts from then.
* **broken links** - links to a page that is not there: a slug that never existed or was
  renamed, a page in the Trash, a page of an archived space.
* **orphans** - pages no other page links to or names: found only through the page tree.
  Top-level pages are the tree's way in, so they are left out, and so are empty pages.
* **duplicates** - pages that are copies of each other: the same title but for a "(2)", or,
  with semantic search, nearly the same content.

No model is called. Every page listed is one the reader may see.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from app.core.logging import get_logger
from app.db.soft_delete import INCLUDE_DELETED
from app.models.page import WikiPage
from app.models.page_graph import PageLink
from app.models.page_review import PageReview
from app.models.space import Space, SpaceStatus
from app.models.user import User
from app.modules.ai.config import load_config
from app.modules.graph.extract import copy_key, internal_links
from app.modules.permissions.service import PermissionService
from app.modules.search.indexer import semantic_tables_exist
from app.schemas.graph import (
    BrokenLink,
    DuplicateGroup,
    HealthPage,
    SpaceHealthRead,
    StalePage,
)

logger = get_logger(__name__)

#: Days without an edit before a page may be out of date, and how recent a neighbour's
#: edit must be to say so. The report's own defaults; the reader can choose others.
STALE_DAYS = 180
RECENT_DAYS = 90
#: Two pages at least this alike (cosine, mean of their passages) say the same thing.
DUPLICATE_THRESHOLD = 0.92
#: Pages listed per kind at most; the totals say how many there are.
LIST_LIMIT = 200
#: Newer neighbours shown with a stale page.
NEWER_SHOWN = 3
#: Ids per ``IN (...)``: well inside the database driver's parameter limit.
_CHUNK = 5000


def _chunks(ids: Sequence[uuid.UUID]) -> Iterable[list[uuid.UUID]]:
    for start in range(0, len(ids), _CHUNK):
        yield list(ids[start : start + _CHUNK])


def health_page(page: WikiPage) -> HealthPage:
    return HealthPage(
        id=page.id,
        title=page.title,
        slug=page.slug,
        space_key=page.space.key,
        space_name=page.space.name,
        updated_at=page.updated_at,
    )


@dataclass
class _Newer:
    page: WikiPage
    via: str


class ContentHealthService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.permissions = PermissionService(session)

    async def _visible(self, pages: Iterable[WikiPage], user: User) -> list[WikiPage]:
        return [page for page in pages if await self.permissions.can_view_page(page, user)]

    async def report(
        self,
        space: Space,
        user: User,
        *,
        stale_days: int = STALE_DAYS,
        recent_days: int = RECENT_DAYS,
    ) -> SpaceHealthRead:
        all_pages = (
            (
                await self.session.execute(
                    select(WikiPage)
                    .options(selectinload(WikiPage.space))
                    .where(WikiPage.space_id == space.id)
                )
            )
            .scalars()
            .all()
        )
        pages = await self._visible(all_pages, user)
        stale = await self._stale(pages, user, stale_days=stale_days, recent_days=recent_days)
        broken = await self._broken_links(pages, user)
        orphans = await self._orphans(pages)
        duplicates, semantic = await self._duplicates(space, pages, user)
        return SpaceHealthRead(
            stale_days=stale_days,
            recent_days=recent_days,
            stale=stale[:LIST_LIMIT],
            stale_total=len(stale),
            broken_links=broken[:LIST_LIMIT],
            broken_total=len(broken),
            orphans=[health_page(page) for page in orphans[:LIST_LIMIT]],
            orphans_total=len(orphans),
            duplicates=duplicates[:LIST_LIMIT],
            duplicates_total=len(duplicates),
            semantic=semantic,
        )

    # -- stale ---------------------------------------------------------------------------

    async def _reviews(self, ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, datetime]:
        reviewed: dict[uuid.UUID, datetime] = {}
        for chunk in _chunks(ids):
            rows = await self.session.execute(
                select(PageReview.page_id, PageReview.reviewed_at).where(
                    PageReview.page_id.in_(chunk)
                )
            )
            reviewed.update(dict(rows.tuples().all()))
        return reviewed

    async def _neighbours(self, pages: Sequence[WikiPage]) -> dict[uuid.UUID, list[_Newer]]:
        """Every live page tied to each of ``pages``: by an edge either way, parent or child."""
        ids = [page.id for page in pages]
        ties: dict[uuid.UUID, dict[uuid.UUID, str]] = defaultdict(dict)
        for chunk in _chunks(ids):
            rows = await self.session.execute(
                select(PageLink.source_page_id, PageLink.target_page_id, PageLink.kind).where(
                    or_(PageLink.source_page_id.in_(chunk), PageLink.target_page_id.in_(chunk))
                )
            )
            wanted = set(chunk)
            for source, target, kind in rows:
                if source in wanted:
                    ties[source].setdefault(target, kind)
                if target in wanted:
                    ties[target].setdefault(source, kind)
            children = await self.session.execute(
                select(WikiPage.parent_id, WikiPage.id).where(WikiPage.parent_id.in_(chunk))
            )
            for parent, child in children:
                ties[parent].setdefault(child, "child")
        for page in pages:
            if page.parent_id is not None:
                ties[page.id].setdefault(page.parent_id, "parent")

        other_ids = list({other for tied in ties.values() for other in tied})
        others: dict[uuid.UUID, WikiPage] = {}
        for chunk in _chunks(other_ids):
            rows = await self.session.execute(
                select(WikiPage)
                .options(selectinload(WikiPage.space))
                .join(Space, Space.id == WikiPage.space_id)
                .where(WikiPage.id.in_(chunk), Space.status == SpaceStatus.active)
            )
            others.update({page.id: page for page in rows.scalars()})
        return {
            page_id: [_Newer(others[other], via) for other, via in tied.items() if other in others]
            for page_id, tied in ties.items()
        }

    async def newer_neighbours(
        self, page: WikiPage, user: User, *, limit: int = NEWER_SHOWN
    ) -> list[WikiPage]:
        """Pages tied to ``page`` edited after it, most recent first, that ``user`` may read."""
        tied = (await self._neighbours([page])).get(page.id, [])
        newer = sorted(
            (n.page for n in tied if n.page.updated_at > page.updated_at),
            key=lambda other: other.updated_at,
            reverse=True,
        )
        return (await self._visible(newer, user))[:limit]

    async def _stale(
        self, pages: Sequence[WikiPage], user: User, *, stale_days: int, recent_days: int
    ) -> list[StalePage]:
        now = datetime.now(UTC)
        old_before = now - timedelta(days=stale_days)
        recent_since = now - timedelta(days=recent_days)
        reviewed = await self._reviews([page.id for page in pages])
        candidates = [
            page
            for page in pages
            if page.content.strip()
            and max(page.updated_at, reviewed.get(page.id, page.updated_at)) < old_before
        ]
        if not candidates:
            return []
        neighbours = await self._neighbours(candidates)
        out: list[StalePage] = []
        for page in candidates:
            newer = sorted(
                (
                    n.page
                    for n in neighbours.get(page.id, [])
                    if n.page.updated_at >= recent_since and n.page.updated_at > page.updated_at
                ),
                key=lambda other: other.updated_at,
                reverse=True,
            )
            newer = await self._visible(newer, user)
            if not newer:
                continue
            out.append(
                StalePage(
                    page=health_page(page),
                    reviewed_at=reviewed.get(page.id),
                    newer=[health_page(other) for other in newer[:NEWER_SHOWN]],
                    newer_count=len(newer),
                )
            )
        # The most overtaken first, then the longest untouched.
        out.sort(key=lambda item: (-item.newer_count, item.page.updated_at))
        return out

    async def mark_reviewed(self, page: WikiPage, user: User) -> datetime:
        now = datetime.now(UTC)
        await self.session.execute(
            insert(PageReview)
            .values(page_id=page.id, reviewed_at=now, reviewed_by_id=user.id)
            .on_conflict_do_update(
                index_elements=[PageReview.page_id],
                set_={"reviewed_at": now, "reviewed_by_id": user.id},
            )
        )
        await self.session.commit()
        return now

    # -- broken links --------------------------------------------------------------------

    async def _broken_links(self, pages: Sequence[WikiPage], user: User) -> list[BrokenLink]:
        links = {page.id: internal_links(page.content) for page in pages}
        wanted = {link for found in links.values() for link in found}
        if not wanted:
            return []
        keys = {key.upper() for key, _ in wanted}
        spaces = {
            space.key.upper(): space
            for space in (
                await self.session.execute(select(Space).where(func.upper(Space.key).in_(keys)))
            ).scalars()
        }
        targets: dict[tuple[str, str], WikiPage] = {}
        by_space: dict[uuid.UUID, set[str]] = defaultdict(set)
        for key, slug in wanted:
            space = spaces.get(key.upper())
            if space is not None:
                by_space[space.id].add(slug)
        for space_id, slugs in by_space.items():
            rows = await self.session.execute(
                select(WikiPage)
                .options(selectinload(WikiPage.space))
                .where(WikiPage.space_id == space_id, WikiPage.slug.in_(list(slugs)))
                .execution_options(**INCLUDE_DELETED)
            )
            for target in rows.scalars():
                targets[(target.space.key.upper(), target.slug)] = target

        out: list[BrokenLink] = []
        for page in pages:
            for key, slug in links[page.id]:
                space = spaces.get(key.upper())
                target = targets.get((key.upper(), slug))
                if space is None or target is None:
                    reason = "missing"
                elif target.deleted_at is not None:
                    reason = "trashed"
                elif space.status != SpaceStatus.active:
                    reason = "archived_space"
                else:
                    continue
                title = None
                if target is not None and await self.permissions.can_view_page(target, user):
                    title = target.title
                out.append(
                    BrokenLink(
                        page=health_page(page),
                        href=f"/spaces/{key}/pages/{slug}",
                        target_space_key=key,
                        target_slug=slug,
                        target_title=title,
                        reason=reason,
                    )
                )
        out.sort(key=lambda item: (item.page.title.lower(), item.href))
        return out

    # -- orphans -------------------------------------------------------------------------

    async def _orphans(self, pages: Sequence[WikiPage]) -> list[WikiPage]:
        candidates = [page for page in pages if page.parent_id is not None and page.content.strip()]
        reached: set[uuid.UUID] = set()
        for chunk in _chunks([page.id for page in candidates]):
            source = aliased(WikiPage)
            rows = await self.session.scalars(
                select(PageLink.target_page_id)
                .join(source, source.id == PageLink.source_page_id)
                .join(Space, Space.id == source.space_id)
                .where(
                    PageLink.target_page_id.in_(chunk),
                    PageLink.kind.in_(("link", "mention")),
                    source.deleted_at.is_(None),
                    Space.status == SpaceStatus.active,
                )
            )
            reached.update(rows)
        orphans = [page for page in candidates if page.id not in reached]
        orphans.sort(key=lambda page: page.updated_at, reverse=True)
        return orphans

    # -- duplicates ----------------------------------------------------------------------

    async def _duplicates(
        self, space: Space, pages: Sequence[WikiPage], user: User
    ) -> tuple[list[DuplicateGroup], bool]:
        groups: list[DuplicateGroup] = []
        by_key: dict[tuple[str, ...], list[WikiPage]] = defaultdict(list)
        for page in pages:
            key = copy_key(page.title)
            if key:
                by_key[key].append(page)
        titled: set[frozenset[uuid.UUID]] = set()
        for same in by_key.values():
            if len(same) < 2:
                continue
            same.sort(key=lambda page: page.updated_at, reverse=True)
            groups.append(DuplicateGroup(kind="title", pages=[health_page(page) for page in same]))
            ids = [page.id for page in same]
            titled.update(frozenset((a, b)) for a in ids for b in ids if a != b)

        semantic = False
        config = await load_config(self.session)
        if config.embeddings_ready and await semantic_tables_exist(self.session):
            semantic = True
            pairs = await self._similar_pairs(space, config.embedding_model)
            if pairs is None:
                semantic = False
            else:
                content_groups = await self._content_groups(pairs, titled, user)
                groups.extend(content_groups)
        groups.sort(key=lambda group: (group.kind != "title", -(group.similarity or 1.0)))
        return groups, semantic

    async def _similar_pairs(
        self, space: Space, model: str
    ) -> list[tuple[uuid.UUID, uuid.UUID, float]] | None:
        try:
            rows = (
                await self.session.execute(
                    text(
                        # Each live page's mean vector, then each of this space's pages' nearest.
                        "WITH live AS MATERIALIZED ("
                        "  SELECT c.page_id, avg(c.embedding) AS v FROM page_chunks c "
                        # An empty page (a new space's home page) is like every other one.
                        "  JOIN pages p ON p.id = c.page_id AND p.deleted_at IS NULL "
                        "    AND length(trim(p.content)) > 0 "
                        "  JOIN spaces sp ON sp.id = p.space_id AND sp.status = 'active' "
                        "  JOIN page_search_state st "
                        "    ON st.page_id = c.page_id AND st.model = :model "
                        "  WHERE c.attachment_id IS NULL "
                        "  GROUP BY c.page_id"
                        ") "
                        "SELECT s.page_id, n.page_id, n.similarity FROM live s "
                        "JOIN pages sp ON sp.id = s.page_id AND sp.space_id = :space "
                        "CROSS JOIN LATERAL ("
                        "  SELECT o.page_id, 1 - (s.v <=> o.v) AS similarity FROM live o "
                        "  WHERE o.page_id <> s.page_id ORDER BY s.v <=> o.v LIMIT 3"
                        ") n WHERE n.similarity >= :threshold"
                    ),
                    {"space": space.id, "model": model, "threshold": DUPLICATE_THRESHOLD},
                )
            ).all()
        except SQLAlchemyError:
            await self.session.rollback()
            logger.warning("content_health_similar_unavailable", exc_info=True)
            return None
        seen: dict[frozenset[uuid.UUID], float] = {}
        for a, b, similarity in rows:
            pair = frozenset((a, b))
            seen[pair] = max(seen.get(pair, 0.0), float(similarity))
        return [(*sorted(pair, key=str), similarity) for pair, similarity in seen.items()]

    async def _content_groups(
        self,
        pairs: list[tuple[uuid.UUID, uuid.UUID, float]],
        titled: set[frozenset[uuid.UUID]],
        user: User,
    ) -> list[DuplicateGroup]:
        pairs = [pair for pair in pairs if frozenset(pair[:2]) not in titled]
        ids = list({page_id for a, b, _ in pairs for page_id in (a, b)})
        by_id: dict[uuid.UUID, WikiPage] = {}
        for chunk in _chunks(ids):
            rows = await self.session.execute(
                select(WikiPage).options(selectinload(WikiPage.space)).where(WikiPage.id.in_(chunk))
            )
            by_id.update({page.id: page for page in rows.scalars()})
        out: list[DuplicateGroup] = []
        for a, b, similarity in pairs:
            first, second = by_id.get(a), by_id.get(b)
            if first is None or second is None:  # pragma: no cover - purged a moment ago
                continue
            if not (
                await self.permissions.can_view_page(first, user)
                and await self.permissions.can_view_page(second, user)
            ):
                continue
            ordered = sorted((first, second), key=lambda page: page.updated_at, reverse=True)
            out.append(
                DuplicateGroup(
                    kind="content",
                    similarity=round(min(similarity, 1.0), 4),
                    pages=[health_page(page) for page in ordered],
                )
            )
        return out
