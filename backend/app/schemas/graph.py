"""The knowledge graph as readers see it: a page's related pages, a space's map."""

from __future__ import annotations

import uuid

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
