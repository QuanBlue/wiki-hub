"""The knowledge graph for readers: a page's related pages, and maps of spaces.

Everything here is filtered by what the reader may see: a page they may not read
is never listed, and never shows up as a tie between two pages they may.
"""

from __future__ import annotations

import uuid
from collections import Counter, defaultdict
from collections.abc import Collection, Iterable, Sequence

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.page import WikiPage
from app.models.page_graph import PageLink
from app.models.space import Space, SpaceStatus
from app.models.user import User
from app.modules.graph.neighbors import related_pages
from app.modules.permissions.service import PermissionService
from app.modules.search.query import plain_text
from app.schemas.graph import (
    GraphEdge,
    GraphInsights,
    GraphNode,
    MapSpace,
    MentionedPage,
    PageRelatedRead,
    RelatedPage,
    SpaceGraphRead,
    SparseGroup,
)

#: Related pages listed under a page.
RELATED_LIMIT = 8
#: Pages drawn on a map at most; the best-connected are kept.
MAP_LIMIT = 500
#: Rounds of label propagation when grouping pages; it settles well before.
_COMMUNITY_ROUNDS = 20
#: Bridges and orphans listed at most.
_INSIGHTS_LIMIT = 20
#: A group this large whose pages tie to fewer than this share of each other is sparse.
_SPARSE_MIN_SIZE = 4
_SPARSE_DENSITY = 0.3
#: Characters of a page shown in the map's preview.
_EXCERPT_CHARS = 240


class GraphService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.permissions = PermissionService(session)

    async def related_for_page(self, page: WikiPage, user: User) -> PageRelatedRead:
        """Pages tied to ``page`` by links, mentions or likeness, that ``user`` may read.

        The page tree is left out: the reader already sees it beside the page.
        """
        neighbors = await related_pages(
            self.session, {page.id: 1.0}, limit=RELATED_LIMIT * 3, tree=False
        )
        pages: list[RelatedPage] = []
        for neighbor in neighbors:
            if not await self.permissions.can_view_page(neighbor.page, user):
                continue
            pages.append(
                RelatedPage(
                    id=neighbor.page.id,
                    title=neighbor.page.title,
                    slug=neighbor.page.slug,
                    space_key=neighbor.page.space.key,
                    space_name=neighbor.page.space.name,
                    via=neighbor.via,
                )
            )
            if len(pages) >= RELATED_LIMIT:
                break
        return PageRelatedRead(pages=pages, mentions=await self._mentions(page, user))

    async def _mentions(self, page: WikiPage, user: User) -> list[MentionedPage]:
        targets = (
            (
                await self.session.execute(
                    select(WikiPage)
                    .options(selectinload(WikiPage.space))
                    .join(PageLink, PageLink.target_page_id == WikiPage.id)
                    .join(Space, Space.id == WikiPage.space_id)
                    .where(
                        PageLink.source_page_id == page.id,
                        PageLink.kind == "mention",
                        Space.status == SpaceStatus.active,
                    )
                )
            )
            .scalars()
            .all()
        )
        return [
            MentionedPage(title=target.title, slug=target.slug, space_key=target.space.key)
            for target in targets
            if await self.permissions.can_view_page(target, user)
        ]

    async def _tied(self, page_ids: list[uuid.UUID]) -> set[uuid.UUID]:
        """Which of these pages have any tie at all, to a page in any space."""
        if not page_ids:
            return set()
        rows = await self.session.execute(
            select(PageLink.source_page_id, PageLink.target_page_id).where(
                or_(
                    PageLink.source_page_id.in_(page_ids),
                    PageLink.target_page_id.in_(page_ids),
                )
            )
        )
        tied: set[uuid.UUID] = set()
        for source, target in rows:
            tied.update((source, target))
        return tied

    async def space_map(
        self,
        space: Space,
        user: User,
        *,
        limit: int = MAP_LIMIT,
        kinds: Collection[str] | None = None,
    ) -> SpaceGraphRead:
        """Every page of ``space`` the reader may see, and the ties between them."""
        return await self.map_for([space], user, limit=limit, kinds=kinds)

    async def map_for(
        self,
        spaces: Sequence[Space],
        user: User,
        *,
        limit: int = MAP_LIMIT,
        kinds: Collection[str] | None = None,
    ) -> SpaceGraphRead:
        """Every page of these ``spaces`` the reader may see, and the ties between them.

        Ties between two of the spaces are drawn too: that is what a map of several
        spaces is for. The caller passes only spaces the reader may open; each page is
        still checked, so a restricted page never shows, not even as the end of a tie.

        ``kinds`` keeps only those kinds of tie in the answer. Groups and degrees are
        worked out from every tie either way, so the map's colours do not change.
        """
        space_by_id = {space.id: space for space in spaces}
        all_pages = (
            (
                await self.session.execute(
                    select(WikiPage).where(WikiPage.space_id.in_(list(space_by_id)))
                )
            )
            .scalars()
            .all()
            if space_by_id
            else []
        )
        visible = [page for page in all_pages if await self.permissions.can_view_page(page, user)]
        by_id = {page.id: page for page in visible}

        edges: list[GraphEdge] = []
        if by_id:
            ids = list(by_id)
            rows = await self.session.execute(
                select(
                    PageLink.source_page_id,
                    PageLink.target_page_id,
                    PageLink.kind,
                    PageLink.weight,
                ).where(PageLink.source_page_id.in_(ids), PageLink.target_page_id.in_(ids))
            )
            edges = [
                GraphEdge(source=source, target=target, kind=kind, weight=round(float(weight), 4))
                for source, target, kind, weight in rows
            ]
        edges = _merge_similar(edges)
        edges.extend(
            GraphEdge(source=page.parent_id, target=page.id, kind="tree", weight=1.0)
            for page in visible
            if page.parent_id in by_id
        )

        degree: Counter[uuid.UUID] = Counter()
        for edge in edges:
            degree[edge.source] += 1
            degree[edge.target] += 1
        total = len(visible)
        if total > limit:
            keep = set(sorted(by_id, key=lambda page_id: (-degree[page_id], str(page_id)))[:limit])
            by_id = {page_id: page for page_id, page in by_id.items() if page_id in keep}
            edges = [edge for edge in edges if edge.source in keep and edge.target in keep]
            degree = Counter()
            for edge in edges:
                degree[edge.source] += 1
                degree[edge.target] += 1

        communities = _communities(by_id, edges)
        nodes = [
            GraphNode(
                id=page.id,
                title=page.title,
                slug=page.slug,
                parent_id=page.parent_id if page.parent_id in by_id else None,
                branch_id=_branch(page, by_id),
                community=communities[page.id],
                degree=degree[page.id],
                excerpt=_excerpt(page.content),
                space_key=space_by_id[page.space_id].key,
                space_name=space_by_id[page.space_id].name,
            )
            for page in sorted(by_id.values(), key=lambda page: page.title.lower())
        ]
        on_map = Counter(page.space_id for page in by_id.values())
        return SpaceGraphRead(
            spaces=[
                MapSpace(key=space.key, name=space.name, pages=on_map[space.id])
                for space in sorted(spaces, key=lambda space: space.name.lower())
                if on_map[space.id]
            ],
            nodes=nodes,
            edges=[edge for edge in edges if kinds is None or edge.kind in kinds],
            total_pages=total,
            insights=_insights(by_id, edges, communities, await self._tied(list(by_id))),
        )


def _merge_similar(edges: list[GraphEdge]) -> list[GraphEdge]:
    """One ``similar`` edge per pair: A finding B and B finding A are one tie."""
    out: list[GraphEdge] = []
    seen: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for edge in edges:
        if edge.kind == "similar":
            pair = (min(edge.source, edge.target), max(edge.source, edge.target))
            if pair in seen:
                continue
            seen.add(pair)
        out.append(edge)
    return out


def _branch(page: WikiPage, by_id: dict[uuid.UUID, WikiPage]) -> uuid.UUID:
    """The top-level page above ``page`` among those on the map."""
    current = page
    seen = {page.id}
    while current.parent_id in by_id and current.parent_id not in seen:
        current = by_id[current.parent_id]
        seen.add(current.id)
    return current.id


def _communities(
    by_id: dict[uuid.UUID, WikiPage], edges: Iterable[GraphEdge]
) -> dict[uuid.UUID, int]:
    """Groups of pages that belong together, by weighted label propagation.

    Deterministic (pages in id order, ties to the smallest label), so the map's
    colours stay put between visits. Groups are numbered largest first.
    """
    weights: dict[uuid.UUID, dict[uuid.UUID, float]] = defaultdict(dict)
    for edge in edges:
        # The tree ties pages loosely; what they say ties them firmly.
        weight = 0.5 if edge.kind == "tree" else (edge.weight if edge.kind == "similar" else 1.0)
        for a, b in ((edge.source, edge.target), (edge.target, edge.source)):
            weights[a][b] = weights[a].get(b, 0.0) + weight
    label = {page_id: page_id for page_id in by_id}
    order = sorted(by_id, key=str)
    for _ in range(_COMMUNITY_ROUNDS):
        changed = False
        for page_id in order:
            tally: dict[uuid.UUID, float] = defaultdict(float)
            for other, weight in weights.get(page_id, {}).items():
                tally[label[other]] += weight
            if not tally:
                continue
            best = max(tally.values())
            choice = min((candidate for candidate, w in tally.items() if w == best), key=str)
            if choice != label[page_id]:
                label[page_id] = choice
                changed = True
        if not changed:
            break
    sizes = Counter(label.values())
    numbering = {
        group: index
        for index, (group, _) in enumerate(
            sorted(sizes.items(), key=lambda item: (-item[1], str(item[0])))
        )
    }
    return {page_id: numbering[group] for page_id, group in label.items()}


def _insights(
    by_id: dict[uuid.UUID, WikiPage],
    edges: list[GraphEdge],
    communities: dict[uuid.UUID, int],
    tied: set[uuid.UUID],
) -> GraphInsights:
    """``tied``: pages with any link, mention or similar page, in this space or not."""
    groups_near: dict[uuid.UUID, set[int]] = defaultdict(set)
    for edge in edges:
        if edge.kind == "tree":
            continue
        groups_near[edge.source].add(communities[edge.target])
        groups_near[edge.target].add(communities[edge.source])
    orphans = sorted(
        (page_id for page_id in by_id if page_id not in tied and by_id[page_id].content.strip()),
        key=lambda page_id: by_id[page_id].title.lower(),
    )
    bridges = sorted(
        (
            page_id
            for page_id, groups in groups_near.items()
            if len(groups - {communities[page_id]}) >= 2
        ),
        key=lambda page_id: (-len(groups_near[page_id]), by_id[page_id].title.lower()),
    )
    return GraphInsights(
        orphans=orphans[:_INSIGHTS_LIMIT],
        bridges=bridges[:_INSIGHTS_LIMIT],
        sparse_groups=_sparse_groups(edges, communities)[:_INSIGHTS_LIMIT],
    )


def _sparse_groups(edges: list[GraphEdge], communities: dict[uuid.UUID, int]) -> list[SparseGroup]:
    """Groups of at least ``_SPARSE_MIN_SIZE`` pages with few ties among them.

    A group's density is the share of its pairs of pages tied directly. A low one
    means the group hangs together through a chain of single ties: linking its pages
    to each other, or to a page that sums them up, makes it easier to follow.
    """
    sizes = Counter(communities.values())
    pairs: dict[int, set[tuple[uuid.UUID, uuid.UUID]]] = defaultdict(set)
    for edge in edges:
        group = communities[edge.source]
        if communities[edge.target] == group:
            pairs[group].add((min(edge.source, edge.target), max(edge.source, edge.target)))
    sparse = [
        SparseGroup(community=group, size=size)
        for group, size in sizes.items()
        if size >= _SPARSE_MIN_SIZE
        and len(pairs[group]) / (size * (size - 1) / 2) < _SPARSE_DENSITY
    ]
    return sorted(sparse, key=lambda item: (-item.size, item.community))


def _excerpt(content: str) -> str:
    text = plain_text(content)
    return text if len(text) <= _EXCERPT_CHARS else text[: _EXCERPT_CHARS - 1].rstrip() + "…"
