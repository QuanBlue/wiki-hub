"""The knowledge graph as readers see it: a page's related pages, a space's map."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class RelatedPage(BaseModel):
    id: uuid.UUID
    title: str
    slug: str
    space_key: str
    space_name: str
    #: Why it is related, strongest first: ``link``, ``linked_from``, ``mention``,
    #: ``mentioned_by``, ``similar``.
    via: list[str]


class MentionedPage(BaseModel):
    """A page this page names by its title: the reader can link the words to it."""

    title: str
    slug: str
    space_key: str


class PageRelatedRead(BaseModel):
    pages: list[RelatedPage]
    mentions: list[MentionedPage]


class GraphNode(BaseModel):
    id: uuid.UUID
    title: str
    slug: str
    parent_id: uuid.UUID | None
    #: The top-level page of its branch of the page tree (itself, at the top).
    branch_id: uuid.UUID
    #: Pages that belong together by their ties, numbered largest group first.
    community: int
    #: Ties to other pages on the map, the page tree included.
    degree: int
    #: The start of the page's text, for a preview.
    excerpt: str
    space_key: str
    space_name: str


class GraphEdge(BaseModel):
    source: uuid.UUID
    target: uuid.UUID
    #: ``link``, ``mention``, ``similar`` or ``tree`` (``source`` is the parent).
    kind: str
    weight: float


class SparseGroup(BaseModel):
    community: int
    size: int


class GraphInsights(BaseModel):
    #: Pages tied to nothing but the page tree: no link, mention or similar page.
    orphans: list[uuid.UUID]
    #: Pages tying together groups that are otherwise apart, most groups first.
    bridges: list[uuid.UUID]
    #: Groups of several pages held together by only a few ties, largest first.
    sparse_groups: list[SparseGroup]


class MapSpace(BaseModel):
    """A space with pages on the map, and how many."""

    key: str
    name: str
    pages: int


class SpaceGraphRead(BaseModel):
    #: The spaces with pages on the map, by name.
    spaces: list[MapSpace]
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    #: Pages the reader may see in the space; more than ``nodes`` when capped.
    total_pages: int
    insights: GraphInsights


class HealthPage(BaseModel):
    """A page as the content health report lists it."""

    id: uuid.UUID
    title: str
    slug: str
    space_key: str
    space_name: str
    updated_at: datetime


class StalePage(BaseModel):
    page: HealthPage
    #: When someone last marked it still correct, if ever.
    reviewed_at: datetime | None = None
    #: Pages tied to it edited recently, after it: the most recent first.
    newer: list[HealthPage]
    newer_count: int


class BrokenLink(BaseModel):
    #: The page holding the link.
    page: HealthPage
    href: str
    target_space_key: str
    target_slug: str
    #: The page it pointed at, when there is one the reader may see.
    target_title: str | None = None
    #: ``missing`` (no such page: never was, or its address changed), ``trashed`` or
    #: ``archived_space``.
    reason: Literal["missing", "trashed", "archived_space"]


class DuplicateGroup(BaseModel):
    #: ``title`` (the same title but for a "(2)") or ``content`` (nearly the same text).
    kind: Literal["title", "content"]
    #: How alike, for ``content``.
    similarity: float | None = None
    #: The most recently edited first.
    pages: list[HealthPage]


class SpaceHealthRead(BaseModel):
    stale_days: int
    recent_days: int
    stale: list[StalePage]
    stale_total: int
    broken_links: list[BrokenLink]
    broken_total: int
    orphans: list[HealthPage]
    orphans_total: int
    duplicates: list[DuplicateGroup]
    duplicates_total: int
    #: Whether nearly identical content was looked for (semantic search is on).
    semantic: bool


class PageReviewRead(BaseModel):
    reviewed_at: datetime


class StaleCheckRequest(BaseModel):
    #: The language the answer is written in: the reader's.
    locale: Literal["en", "vi"] = "en"


class StaleCheckRead(BaseModel):
    #: Markdown: what in the page the newer pages contradict or replace, or that nothing does.
    result: str
    #: The newer pages it was compared with.
    compared: list[HealthPage]
    cached: bool = False
