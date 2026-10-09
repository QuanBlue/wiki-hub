"""People pickers for a page: who could be @mentioned on it or have it shared with them."""

from __future__ import annotations

import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.page import WikiPage
from app.models.user import User
from app.modules.permissions.service import PermissionService
from app.schemas.comment import MentionCandidate

PICKER_SIZE = 8


async def people_for_page(
    session: AsyncSession,
    permissions: PermissionService,
    page: WikiPage,
    query: str,
    *,
    exclude: uuid.UUID | None = None,
) -> list[MentionCandidate]:
    """Active accounts matching ``query``, for a picker on ``page``.

    People who can see the page come first; anyone who cannot (a restricted
    space or page) only fills the slots left over, flagged ``can_view=False``
    so the picker can show them disabled rather than leave the author
    wondering why a colleague is missing.
    """
    statement = select(User).where(User.is_active.is_(True)).order_by(User.username)
    if exclude is not None:
        statement = statement.where(User.id != exclude)
    term = query.strip().lstrip("@")
    if term:
        # Escape LIKE's wildcards rather than dropping them: usernames such as
        # ``ops_bot`` must still be found by their full name.
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        like = f"%{escaped}%"
        statement = statement.where(
            or_(
                User.username.ilike(like, escape="\\"),
                User.full_name.ilike(like, escape="\\"),
            )
        )
    allowed: list[MentionCandidate] = []
    denied: list[MentionCandidate] = []
    for candidate in await session.scalars(statement.limit(60)):
        can_view = await permissions.can_view_page(page, candidate)
        (allowed if can_view else denied).append(
            MentionCandidate(
                username=candidate.username,
                full_name=candidate.full_name,
                avatar_url=candidate.avatar_url,
                can_view=can_view,
            )
        )
        if len(allowed) >= PICKER_SIZE:
            break
    return (allowed + denied)[:PICKER_SIZE]
