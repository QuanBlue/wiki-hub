"""Paginated response envelope.

Policy: **every new collection endpoint returns** :class:`Page`. A bare JSON
array cannot carry a total, so a client has no way to render "showing 1-50 of
312" or decide whether a next page exists.

``GET /api/v1/spaces`` predates this and still returns a bare array; it will be
migrated when a spaces listing needs a total. Do not add new bare-array
endpoints.
"""

from __future__ import annotations

from pydantic import BaseModel


class Page[T](BaseModel):
    items: list[T]
    #: Total matching rows *after* filtering, not the size of the table.
    total: int
    limit: int
    offset: int

    @property
    def has_more(self) -> bool:
        return self.offset + len(self.items) < self.total

    @classmethod
    def of(cls, items: list[T], total: int, *, limit: int, offset: int) -> Page[T]:
        return cls(items=items, total=total, limit=limit, offset=offset)
