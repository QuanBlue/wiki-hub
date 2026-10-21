"""Which groups of pages on a space's map are held together by only a few ties."""

from __future__ import annotations

import uuid
from itertools import pairwise

from app.modules.graph.service import _sparse_groups
from app.schemas.graph import GraphEdge


def _ids(count: int) -> list[uuid.UUID]:
    return [uuid.UUID(int=i + 1) for i in range(count)]


def _edge(a: uuid.UUID, b: uuid.UUID, kind: str = "mention") -> GraphEdge:
    return GraphEdge(source=a, target=b, kind=kind, weight=1.0)


def test_a_long_chain_of_single_ties_is_sparse() -> None:
    pages = _ids(8)
    edges = [_edge(a, b) for a, b in pairwise(pages)]  # 7 of 28 pairs
    communities = dict.fromkeys(pages, 0)

    groups = _sparse_groups(edges, communities)

    assert [(group.community, group.size) for group in groups] == [(0, 8)]


def test_a_closely_tied_group_is_not_sparse() -> None:
    pages = _ids(4)
    edges = [_edge(a, b) for i, a in enumerate(pages) for b in pages[i + 1 :]]
    assert _sparse_groups(edges, dict.fromkeys(pages, 0)) == []


def test_small_groups_are_never_sparse() -> None:
    pages = _ids(3)
    edges = [_edge(pages[0], pages[1])]
    assert _sparse_groups(edges, dict.fromkeys(pages, 0)) == []


def test_ties_both_ways_and_ties_to_other_groups_count_once_or_not_at_all() -> None:
    pages = _ids(5)
    outsider = uuid.UUID(int=99)
    edges = [_edge(pages[0], pages[1]), _edge(pages[1], pages[0])]
    edges += [_edge(page, outsider) for page in pages]
    communities = dict.fromkeys(pages, 0) | {outsider: 1}

    groups = _sparse_groups(edges, communities)

    assert [(group.community, group.size) for group in groups] == [(0, 5)]
