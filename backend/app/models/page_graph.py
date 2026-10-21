"""How pages relate to each other: the knowledge graph behind "related pages".

An edge is never written into a page. It is worked out from what the page already
says (see ``app.modules.graph``) and kept here, so the answer pipeline can bring in
pages next to the ones a search found, and the graph view can draw them.

``kind`` is one of:

* ``link``    - the page links to the other one;
* ``mention`` - the page names the other one by its title;
* ``similar`` - the two pages say much the same thing, by their embeddings.

Edges are read in both directions: a page linked *from* another is as related to
it as the one it links *to*. The page tree (parent, children, siblings) is not
stored - ``pages.parent_id`` already says it.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

EDGE_KINDS = ("link", "mention", "similar")


class PageLink(Base):
    __tablename__ = "page_links"
    __table_args__ = (
        CheckConstraint("source_page_id <> target_page_id", name="not_self"),
        CheckConstraint("kind IN ('link', 'mention', 'similar')", name="kind"),
        Index("ix_page_links_target_page_id", "target_page_id"),
    )

    source_page_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("pages.id", ondelete="CASCADE"), primary_key=True
    )
    target_page_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("pages.id", ondelete="CASCADE"), primary_key=True
    )
    kind: Mapped[str] = mapped_column(String(16), primary_key=True)
    #: ``similar``: how alike the two pages are (0-1). ``link`` / ``mention``: 1.
    weight: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class PageGraphState(Base):
    """What a page's edges were last worked out from.

    The graph builder *polls* for pages whose state no longer matches, like the
    search indexer, instead of hooking every code path that writes a page.
    """

    __tablename__ = "page_graph_state"

    page_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("pages.id", ondelete="CASCADE"), primary_key=True
    )
    #: ``pages.updated_at`` when its ``link`` and ``mention`` edges were worked out.
    source_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    #: The title then, so a new or renamed title is noticed: other pages may name it.
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    #: ``page_search_state.indexed_at`` when its ``similar`` edges were worked out.
    similar_indexed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
