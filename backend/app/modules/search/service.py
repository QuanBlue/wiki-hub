"""Full-text search service across spaces and pages."""

from __future__ import annotations

import html
import re
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.page import WikiPage
from app.models.space import Space, SpaceStatus
from app.repositories.filters import ilike_contains


@dataclass(slots=True)
class SearchResultPage:
    id: uuid.UUID
    title: str
    slug: str
    space_key: str
    space_name: str
    snippet: str
    updated_at: datetime | None


@dataclass(slots=True)
class SearchResultSpace:
    id: uuid.UUID
    key: str
    name: str
    description: str


@dataclass(slots=True)
class SearchResults:
    query: str
    pages: list[SearchResultPage]
    spaces: list[SearchResultSpace]


def extract_snippet(content: str, query: str, max_len: int = 140) -> str:
    """Extract a clean plain-text snippet centered around query term."""
    if not content:
        return ""
    
    # Strip HTML tags & unescape entities
    plain = re.sub(r"<[^>]+>", " ", content)
    plain = html.unescape(plain)
    plain = re.sub(r"\s+", " ", plain).strip()
    
    if not plain:
        return ""

    if not query:
        return plain[:max_len] + ("..." if len(plain) > max_len else "")

    idx = plain.lower().find(query.lower())
    if idx == -1:
        return plain[:max_len] + ("..." if len(plain) > max_len else "")

    start = max(0, idx - 40)
    end = min(len(plain), idx + len(query) + 80)
    
    snippet = plain[start:end]
    if start > 0:
        snippet = "..." + snippet
    if end < len(plain):
        snippet = snippet + "..."

    return snippet


class SearchService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def search(self, query: str, limit: int = 20) -> SearchResults:
        query_trimmed = query.strip()
        if not query_trimmed:
            return SearchResults(query="", pages=[], spaces=[])

        # 1. Search spaces
        spaces_stmt = (
            select(Space)
            .where(
                Space.status == SpaceStatus.active,
                (
                    ilike_contains(Space.name, query_trimmed)
                    | ilike_contains(Space.key, query_trimmed)
                    | ilike_contains(Space.description, query_trimmed)
                ),
            )
            .limit(limit)
        )
        spaces_result = await self.session.execute(spaces_stmt)
        matched_spaces = list(spaces_result.scalars().all())

        space_results = [
            SearchResultSpace(
                id=s.id,
                key=s.key,
                name=s.name,
                description=s.description or "",
            )
            for s in matched_spaces
        ]

        # 2. Search pages
        pages_stmt = (
            select(WikiPage)
            .options(selectinload(WikiPage.space))
            .join(Space, WikiPage.space_id == Space.id)
            .where(
                Space.status == SpaceStatus.active,
                (
                    ilike_contains(WikiPage.title, query_trimmed)
                    | ilike_contains(WikiPage.content, query_trimmed)
                ),
            )
            .limit(limit)
        )
        pages_result = await self.session.execute(pages_stmt)
        matched_pages = list(pages_result.scalars().all())

        page_results = [
            SearchResultPage(
                id=p.id,
                title=p.title,
                slug=p.slug,
                space_key=p.space.key,
                space_name=p.space.name,
                snippet=extract_snippet(p.content, query_trimmed),
                updated_at=p.updated_at,
            )
            for p in matched_pages
        ]

        return SearchResults(
            query=query_trimmed,
            pages=page_results,
            spaces=space_results,
        )
