"""Reading the knowledge graph: the pages next to some others.

Edges count in both directions, and the page tree counts as edges too (a page's
parent, children and siblings), so a wiki where nobody links anything still has a
graph. Each neighbour is scored by how strongly, and to how many of the given
pages, it is tied.

Nothing here checks who may read a page: the caller filters by permission.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.page import WikiPage
from app.models.page_graph import PageLink
from app.models.space import Space, SpaceStatus
from app.modules.graph.extract import copy_key

#: How much each tie is worth. A link an author made is the surest sign two
#: pages belong together; a sibling in the tree, the weakest.
WEIGHTS: dict[str, float] = {
    "link": 3.0,
    "mention": 2.0,
    "similar": 1.5,
    "parent": 1.0,
    "child": 1.0,
    "sibling": 0.5,
}
#: Siblings of one page considered at most: a long flat list says little.
MAX_SIBLINGS = 20
#: What a tie is called, seen from the given page: the edge's kind when it leaves
#: that page, this when it arrives at it ("it links here").
INCOMING = {"link": "linked_from", "mention": "mentioned_by", "similar": "similar"}


@dataclass
class Neighbor:
    page: WikiPage
    score: float = 0.0
    #: The ties that brought it in, strongest first: ``link`` / ``linked_from``,
    #: ``mention`` / ``mentioned_by``, ``similar``, ``parent``, ``child``, ``sibling``.
    via: list[str] = field(default_factory=list)


async def related_pages(
    session: AsyncSession,
    seeds: Mapping[uuid.UUID, float],
    *,
    limit: int,
    tree: bool = True,
) -> list[Neighbor]:
    """Live pages tied to the ``seeds``, best first, one of any set of copies.

    ``seeds`` maps each given page to how much it matters (e.g. its search rank);
    a neighbour scores the sum of ``tie weight x seed weight`` over every tie.
    The seeds themselves are never returned. ``tree=False`` leaves the page tree out,
    for a reader who already sees it beside the page.
    """
    if not seeds or limit <= 0:
        return []
    seed_ids = list(seeds)
    scores: dict[uuid.UUID, float] = {}
    vias: dict[uuid.UUID, dict[str, float]] = {}

    def add(
        neighbor: uuid.UUID | None,
        seed: uuid.UUID,
        kind: str,
        strength: float = 1.0,
        label: str | None = None,
    ) -> None:
        if neighbor is None or neighbor in seeds:
            return
        gain = WEIGHTS[kind] * strength * seeds[seed]
        scores[neighbor] = scores.get(neighbor, 0.0) + gain
        per_kind = vias.setdefault(neighbor, {})
        label = label or kind
        per_kind[label] = per_kind.get(label, 0.0) + gain

    edges = await session.execute(
        select(
            PageLink.source_page_id, PageLink.target_page_id, PageLink.kind, PageLink.weight
        ).where(
            sa.or_(
                PageLink.source_page_id.in_(seed_ids),
                PageLink.target_page_id.in_(seed_ids),
            )
        )
    )
    # Likeness goes both ways, and each page of a pair may have found the other:
    # one similar tie per pair, at its strongest.
    similar: dict[tuple[uuid.UUID, uuid.UUID], float] = {}
    for source, target, kind, weight in edges:
        if kind == "similar":
            for seed, other in ((source, target), (target, source)):
                if seed in seeds:
                    pair = (seed, other)
                    similar[pair] = max(similar.get(pair, 0.0), float(weight))
            continue
        if source in seeds:
            add(target, source, kind)
        if target in seeds:
            add(source, target, kind, label=INCOMING[kind])
    for (seed, other), weight in similar.items():
        add(other, seed, "similar", weight)

    if tree:
        await _add_tree(session, seed_ids, add)
    return await _ranked(session, seed_ids, scores, vias, limit)


async def _add_tree(
    session: AsyncSession, seed_ids: list[uuid.UUID], add: Callable[..., None]
) -> None:
    """Ties through the page tree: each seed's parent, children and siblings."""
    parents: dict[uuid.UUID, uuid.UUID | None] = dict(
        (
            await session.execute(
                select(WikiPage.id, WikiPage.parent_id).where(WikiPage.id.in_(seed_ids))
            )
        )
        .tuples()
        .all()
    )
    for page_id, parent in parents.items():
        add(parent, page_id, "parent")
    children = await session.execute(
        select(WikiPage.id, WikiPage.parent_id).where(WikiPage.parent_id.in_(seed_ids))
    )
    for child, parent in children:
        add(child, parent, "child")
    by_parent: dict[uuid.UUID, list[uuid.UUID]] = {}
    for page_id, parent in parents.items():
        # Top-level pages are not siblings in any useful sense: that is the whole space.
        if parent is not None:
            by_parent.setdefault(parent, []).append(page_id)
    if by_parent:
        siblings = await session.execute(
            select(WikiPage.id, WikiPage.parent_id).where(WikiPage.parent_id.in_(list(by_parent)))
        )
        counted: dict[uuid.UUID, int] = {}
        for sibling, parent in siblings:
            if counted.get(parent, 0) >= MAX_SIBLINGS:
                continue
            counted[parent] = counted.get(parent, 0) + 1
            for seed in by_parent[parent]:
                add(sibling, seed, "sibling")


async def _ranked(
    session: AsyncSession,
    seed_ids: list[uuid.UUID],
    scores: dict[uuid.UUID, float],
    vias: dict[uuid.UUID, dict[str, float]],
    limit: int,
) -> list[Neighbor]:
    if not scores:
        return []
    # Live pages only: the ORM leaves out the Trash, the join leaves out archived spaces.
    ranked = sorted(scores, key=lambda page_id: -scores[page_id])
    candidates = ranked[: limit * 6]
    pages = {
        page.id: page
        for page in (
            await session.execute(
                select(WikiPage)
                .options(selectinload(WikiPage.space))
                .join(Space, Space.id == WikiPage.space_id)
                .where(WikiPage.id.in_(candidates), Space.status == SpaceStatus.active)
            )
        )
        .scalars()
        .all()
    }
    # A copy of a page already in hand (a seed, or a better neighbour) adds nothing.
    seen = {
        copy_key(title)
        for title in await session.scalars(select(WikiPage.title).where(WikiPage.id.in_(seed_ids)))
    }
    result: list[Neighbor] = []
    for page_id in candidates:
        page = pages.get(page_id)
        if page is None or copy_key(page.title) in seen:
            continue
        seen.add(copy_key(page.title))
        kinds = vias[page_id]
        result.append(
            Neighbor(
                page=page,
                score=scores[page_id],
                via=sorted(kinds, key=lambda kind: -kinds[kind]),
            )
        )
        if len(result) >= limit:
            break
    return result
