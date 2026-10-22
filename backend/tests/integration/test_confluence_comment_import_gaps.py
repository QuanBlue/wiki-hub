"""Bringing comments and likes over from Confluence where the archive is untidy: a comment
with nothing in it, a file that was not imported, a like of nothing or twice."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.comment import CommentLike, PageComment
from app.models.page import PageLike
from app.modules.import_export import service as import_service
from app.modules.import_export.confluence import (
    ConfluenceComment,
    ConfluenceLike,
    ConfluenceSpaceList,
)
from app.schemas.page import PageCreate
from tests.integration.test_comments import _user
from tests.integration.test_hybrid_semantic_search import _wiki

pytestmark = pytest.mark.integration

WHEN = datetime(2021, 3, 10, tzinfo=UTC)


async def test_untidy_comments_and_likes_are_kept_where_they_can_be(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, space, pages = await _wiki(session)
    fan = await _user(session)
    page = await pages.create(space, PageCreate(title="Guide", content="<p>x</p>"), owner)
    monkeypatch.setattr(import_service, "log", AsyncMock())
    monkeypatch.setattr(import_service, "_beat", AsyncMock(return_value=0.0))
    names = {"k-fan": fan.username}
    service = SimpleNamespace(
        _resolve_or_create_user=AsyncMock(
            side_effect=lambda name: fan.id if name == fan.username else owner.id
        )
    )
    file_id = uuid.uuid4()
    body = (
        '<p>See <ac:image><ri:attachment ri:filename="shot.png" /></ac:image> and '
        '<ac:image><ri:attachment ri:filename="missing.png" /></ac:image></p>'
    )

    def comment(source_id: str, parent: str | None = None) -> ConfluenceComment:
        return ConfluenceComment(source_id, "p1", parent, "k-fan", WHEN, WHEN)

    job = SimpleNamespace(counters={})
    scanned = ConfluenceSpaceList([], [], [], user_keys=names)
    await import_service._import_comments_and_likes(
        session,
        service,  # type: ignore[arg-type]
        job,  # type: ignore[arg-type]
        scanned,
        {"p1": page},
        [comment("c1"), comment("c2"), comment("c3", parent="c1")],
        # c2 says nothing at all: it is left out. c1 names one file that came over and one that did not.
        {"c1": body, "c3": "<p>a reply</p>"},
        [
            ConfluenceLike("p1", "k-fan", WHEN),
            ConfluenceLike("p1", "k-fan", WHEN),  # the same person twice
            ConfluenceLike("p1", None, WHEN),  # nobody
            ConfluenceLike("c1", "k-fan", WHEN),  # a like of a comment, with its date
            ConfluenceLike("c1", "k-fan", None),  # and one without
            ConfluenceLike("gone", "k-fan", WHEN),  # of something that was not imported
        ],
        {("p1", "shot.png"): f"/api/v1/attachments/{file_id}/content"},
    )

    comments = (await session.execute(select(PageComment))).scalars().all()
    assert sorted(c.body.split()[0] for c in comments) == ["See", "a"]
    assert f"attachment:{file_id}" in next(c.body for c in comments if c.body.startswith("See"))
    assert job.counters == {"comments_imported": 2, "likes_imported": 2}
    assert await session.scalar(select(func.count()).select_from(PageLike)) == 1
    assert await session.scalar(select(func.count()).select_from(CommentLike)) == 1
