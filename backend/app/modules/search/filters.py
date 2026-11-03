"""Fast search filter parsing and SQL filter construction.

Supports fast filtering prefixes directly in the search bar:
- `space:<key>` (e.g. `space:ENG` or `space:"Engineering"`)
- `author:<username>` / `creator:<user>` (e.g. `author:john` or `author:"John Doe"`)
- `label:<name>` / `tag:<name>` (e.g. `label:runbook`)
- `type:<ext>` (e.g. `type:pdf`, `type:docx`, `type:xlsx`, `type:png`, `type:page`)
- `updated:<spec>` (e.g. `updated:>2026-01`, `updated:>=2026-01-01`, `updated:2026-01`)
"""

from __future__ import annotations

import calendar
import re
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa

from app.models.attachment import PageAttachment
from app.models.space import Space
from app.models.user import User
from app.models.user_page_label import UserPageLabel
from app.repositories.filters import like_escape

_ESC = "\\"


def equals_ci(column: Any, value: str) -> sa.ColumnElement[bool]:
    """Case-insensitive equality; ``_`` and ``%`` in the value are literal."""
    return column.ilike(like_escape(value), escape=_ESC)


def space_clause(space_cls: Any, value: str) -> sa.ColumnElement[bool]:
    """``space:<x>``: the space key exactly, or the space name containing ``x``."""
    return sa.or_(
        equals_ci(space_cls.key, value),
        space_cls.name.ilike(f"%{like_escape(value)}%", escape=_ESC),
    )


def file_type_clause(
    filename_col: Any, content_type_col: Any | None, ext: str
) -> sa.ColumnElement[bool]:
    """``type:<ext>`` against a file row: by extension, else by the MIME subtype.

    The MIME match is anchored on the subtype (``image/png``), never a substring:
    ``type:doc`` must not match every ``...wordprocessingml.document`` file.
    """
    clause = filename_col.ilike(f"%.{like_escape(ext)}", escape=_ESC)
    if content_type_col is not None:
        clause = sa.or_(clause, content_type_col.ilike(f"%/{like_escape(ext)}", escape=_ESC))
    return clause


@dataclass
class SearchFilters:
    spaces: list[str] = field(default_factory=list)
    authors: list[str] = field(default_factory=list)
    labels: list[str] = field(default_factory=list)
    types: list[str] = field(default_factory=list)
    updated_after: datetime | None = None
    updated_before: datetime | None = None
    raw_tokens: dict[str, str] = field(default_factory=dict)
    #: Whose private labels ``label:`` may match. Set by the service, never by the query.
    viewer_id: uuid.UUID | None = None

    @property
    def is_empty(self) -> bool:
        return not (
            self.spaces
            or self.authors
            or self.labels
            or self.types
            or self.updated_after
            or self.updated_before
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "spaces": self.spaces,
            "authors": self.authors,
            "labels": self.labels,
            "types": self.types,
            "updated_after": self.updated_after.isoformat() if self.updated_after else None,
            "updated_before": self.updated_before.isoformat() if self.updated_before else None,
            "raw_tokens": self.raw_tokens,
        }


@dataclass
class ParsedSearchQuery:
    raw_query: str
    clean_query: str
    filters: SearchFilters


def parse_date_spec(val: str) -> tuple[datetime | None, datetime | None]:
    """Parse `updated:<spec>` into UTC `(after, before)` datetimes.

    An impossible date (month 13, 31 February, year 0) is "no filter", not an error.
    """
    try:
        return _parse_date_spec(val)
    except ValueError:
        return None, None


def _parse_date_spec(val: str) -> tuple[datetime | None, datetime | None]:
    val = val.strip()
    match = re.match(r"^([><]=?|=)?\s*(\d{4}(?:-\d{2}(?:-\d{2})?)?)$", val)
    if not match:
        return None, None

    op, date_str = match.groups()
    parts = [int(p) for p in date_str.split("-")]
    year = parts[0]
    month = parts[1] if len(parts) >= 2 else None
    day = parts[2] if len(parts) >= 3 else None

    if month is not None:
        _, last_day = calendar.monthrange(year, month)
    else:
        last_day = 31

    if op in (">=", ">"):
        if day is not None:
            if op == ">":
                dt = datetime(year, month, day, 23, 59, 59, 999999, tzinfo=UTC)
            else:
                dt = datetime(year, month, day, 0, 0, 0, tzinfo=UTC)
        elif month is not None:
            # e.g. updated:>2026-01: includes pages from 2026-01-01 onwards
            dt = datetime(year, month, 1, 0, 0, 0, tzinfo=UTC)
        else:
            # Year only: >2025 -> from 2026-01-01 if >, or >=2025 -> from 2025-01-01
            dt = datetime(year if op == ">=" else year + 1, 1, 1, 0, 0, 0, tzinfo=UTC)
        return dt, None

    if op in ("<=", "<"):
        if day is not None:
            if op == "<":
                dt = datetime(year, month, day, 0, 0, 0, tzinfo=UTC)
            else:
                dt = datetime(year, month, day, 23, 59, 59, 999999, tzinfo=UTC)
        elif month is not None:
            if op == "<":
                dt = datetime(year, month, 1, 0, 0, 0, tzinfo=UTC)
            else:
                dt = datetime(year, month, last_day, 23, 59, 59, 999999, tzinfo=UTC)
        else:
            if op == "<":
                dt = datetime(year, 1, 1, 0, 0, 0, tzinfo=UTC)
            else:
                dt = datetime(year, 12, 31, 23, 59, 59, 999999, tzinfo=UTC)
        return None, dt

    # Exact date, month, or year
    if day is not None:
        dt_start = datetime(year, month, day, 0, 0, 0, tzinfo=UTC)
        dt_end = datetime(year, month, day, 23, 59, 59, 999999, tzinfo=UTC)
    elif month is not None:
        dt_start = datetime(year, month, 1, 0, 0, 0, tzinfo=UTC)
        dt_end = datetime(year, month, last_day, 23, 59, 59, 999999, tzinfo=UTC)
    else:
        dt_start = datetime(year, 1, 1, 0, 0, 0, tzinfo=UTC)
        dt_end = datetime(year, 12, 31, 23, 59, 59, 999999, tzinfo=UTC)
    return dt_start, dt_end


_FILTER_PATTERN = re.compile(
    r'(?:^|\s)(space|author|creator|label|tag|type|file|ext|updated|date):(?:"([^"]*)"|\'([^\']*)\'|([^\s]+))',
    re.IGNORECASE,
)


def parse_search_query(raw_query: str) -> ParsedSearchQuery:
    """Extract filter directives and clean text from raw query string."""
    filters = SearchFilters()
    matches = list(_FILTER_PATTERN.finditer(raw_query))
    if not matches:
        return ParsedSearchQuery(
            raw_query=raw_query, clean_query=raw_query.strip(), filters=filters
        )

    kept: set[tuple[int, int]] = set()
    for match in matches:
        key = match.group(1).lower()
        val = (
            match.group(2)
            if match.group(2) is not None
            else (match.group(3) if match.group(3) is not None else match.group(4))
        )
        # The pattern always captures one of the three value groups.
        assert val is not None
        val = val.strip()
        if key in ("updated", "date") and parse_date_spec(val) == (None, None):
            # Not a date we understand: leave it in the text rather than silently drop it.
            continue
        kept.add(match.span())
        filters.raw_tokens[key] = val

        if key == "space":
            filters.spaces.append(val)
        elif key in ("author", "creator"):
            filters.authors.append(val)
        elif key in ("label", "tag"):
            filters.labels.append(val)
        elif key in ("type", "file", "ext"):
            cleaned_ext = val.lower().lstrip(".")
            if cleaned_ext:
                filters.types.append(cleaned_ext)
        elif key in ("updated", "date"):
            after, before = parse_date_spec(val)
            if after:
                filters.updated_after = after
            if before:
                filters.updated_before = before

    # Remove the recognised tokens from the text
    clean = _FILTER_PATTERN.sub(lambda m: " " if m.span() in kept else m.group(0), raw_query)
    clean = re.sub(r"\s+", " ", clean).strip()

    return ParsedSearchQuery(raw_query=raw_query, clean_query=clean, filters=filters)


def build_page_filter_clauses(
    page_cls: Any,
    filters: SearchFilters,
    *,
    space_cls: Any = Space,
    user_cls: Any = User,
    include_types: bool = True,
) -> list[sa.ColumnElement[bool]]:
    """Generate SQLAlchemy WHERE clauses for WikiPage filtering."""
    clauses: list[sa.ColumnElement[bool]] = []

    # 1. Space
    for sp in filters.spaces:
        clauses.append(space_clause(space_cls, sp))

    # 2. Author / Creator
    for auth in filters.authors:
        # Match creator username, creator full name, or Confluence-imported author labels
        clauses.append(
            sa.or_(
                equals_ci(page_cls.created_by_label, auth),
                equals_ci(page_cls.updated_by_label, auth),
                page_cls.created_by.has(equals_ci(user_cls.username, auth)),
                page_cls.created_by.has(
                    user_cls.full_name.ilike(f"%{like_escape(auth)}%", escape=_ESC)
                ),
            )
        )

    # 3. Label. Labels are private to the member who set them, so only the searcher's own count.
    for lbl in filters.labels:
        if filters.viewer_id is None:
            clauses.append(sa.false())
            continue
        clauses.append(
            page_cls.id.in_(
                sa.select(UserPageLabel.page_id).where(
                    UserPageLabel.user_id == filters.viewer_id,
                    equals_ci(UserPageLabel.name, lbl),
                )
            )
        )

    # 4. Attachment type
    for ext in filters.types if include_types else []:
        if ext == "page":
            continue
        clauses.append(
            page_cls.id.in_(
                sa.select(PageAttachment.page_id).where(
                    file_type_clause(PageAttachment.filename, PageAttachment.content_type, ext)
                )
            )
        )

    # 5. Date ranges
    if filters.updated_after is not None:
        clauses.append(page_cls.updated_at >= filters.updated_after)
    if filters.updated_before is not None:
        clauses.append(page_cls.updated_at <= filters.updated_before)

    return clauses
