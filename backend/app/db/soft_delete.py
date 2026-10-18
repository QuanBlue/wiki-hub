"""Pages in the Trash are left out of every ORM query, unless it asks for them.

A deleted page keeps its row (and with it its revisions, comments and attachments) until
it is purged, so it can be restored whole. Rather than add ``deleted_at IS NULL`` to every
query that touches pages - and miss one - this adds it once, to every SELECT the ORM
runs, joins and relationship loads included. The few places that need the Trash (the
Trash itself, restoring, purging, slug uniqueness) opt out with
``.execution_options(include_deleted=True)``; work that must see every page, like a
backup, sets ``session.info["include_deleted"] = True`` for its whole session.
"""

from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.orm import ORMExecuteState, Session, with_loader_criteria

from app.models.page import WikiPage

INCLUDE_DELETED = {"include_deleted": True}


def include_trash(session: object) -> None:
    """Let every query on this session see pages in the Trash too."""
    info = getattr(session, "info", None)
    # Only a real session has a dict here; test doubles stand in with a Mock.
    if isinstance(info, dict):
        info["include_deleted"] = True


@event.listens_for(Session, "do_orm_execute")
def _hide_trashed_pages(state: ORMExecuteState) -> None:
    if (
        state.is_select
        and not state.is_column_load
        and not state.is_relationship_load
        and not state.execution_options.get("include_deleted", False)
        and not state.session.info.get("include_deleted", False)
    ):
        state.statement = state.statement.options(
            with_loader_criteria(
                WikiPage,
                lambda cls: cls.deleted_at.is_(None),
                include_aliases=True,
            )
        )
