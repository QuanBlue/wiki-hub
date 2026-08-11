"""Shared query-building helpers."""

from __future__ import annotations

from sqlalchemy import ColumnElement
from sqlalchemy.orm import InstrumentedAttribute

#: Backslash is the escape character we pass to ``ILIKE ... ESCAPE``.
_ESCAPE = "\\"


def like_escape(term: str) -> str:
    """Escape the LIKE wildcards in a user-supplied search term.

    Without this, searching for ``_`` or ``%`` matches every row - the user
    types one underscore and gets the whole table back, looking like a broken
    filter. The backslash itself must be escaped first, or escaping the
    wildcards would double-escape it.
    """
    return (
        term.replace(_ESCAPE, _ESCAPE * 2).replace("%", f"{_ESCAPE}%").replace("_", f"{_ESCAPE}_")
    )


def ilike_contains(column: InstrumentedAttribute[str], term: str) -> ColumnElement[bool]:
    """Case-insensitive "contains" match on a user-supplied term.

    Note this cannot use a plain btree index (the pattern is leading-wildcard).
    That is fine to roughly ten thousand rows; beyond that the upgrade is
    ``pg_trgm`` + a GIN index, which needs ``CREATE EXTENSION`` privileges that
    some managed PostgreSQL roles lack - hence not done pre-emptively.
    """
    return column.ilike(f"%{like_escape(term)}%", escape=_ESCAPE)
