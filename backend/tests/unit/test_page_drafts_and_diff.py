from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.api.v1 import pages as pages_api
from app.api.v1 import revisions as revisions_api
from app.core.exceptions import NotFoundError
from app.modules.pages.service import PageService
from app.repositories.draft import PageDraftRepository
from app.schemas.draft import PageDraftUpsert
from app.schemas.page import PageUpdate
from app.schemas.revision import PageRevisionRead


def _revision(version: int, content: str, content_format: str = "html") -> PageRevisionRead:
    now = datetime.now(UTC)
    return PageRevisionRead(
        id=uuid.uuid4(),
        page_id=uuid.uuid4(),
        version=version,
        title=f"Title {version}",
        content=content,
        content_format=content_format,
        created_at=now,
        change_summary=None,
        created_by_username=None,
        created_by_full_name="System",
    )


def _service() -> PageService:
    service = PageService(Mock())
    service.require_page_editor = AsyncMock()
    return service


@pytest.mark.asyncio
async def test_draft_lifecycle_and_conflict_flag() -> None:
    service = _service()
    page_id, user_id = uuid.uuid4(), uuid.uuid4()
    page = SimpleNamespace(id=page_id, updated_at=datetime(2026, 1, 2, tzinfo=UTC))
    user = SimpleNamespace(id=user_id)
    service.drafts.get = AsyncMock(return_value=None)
    service.drafts.add = Mock(
        side_effect=lambda draft: (
            setattr(draft, "id", uuid.uuid4()),
            setattr(draft, "updated_at", page.updated_at),
            draft,
        )[-1]
    )
    service.session.flush = AsyncMock()

    payload = PageDraftUpsert(
        content="<p>Draft</p>",
        content_format="html",
        edit_mode="html",
        base_updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    saved = await service.save_draft(page, user, payload)
    assert saved.content == payload.content
    assert saved.is_conflict is True
    service.drafts.get.assert_awaited_once_with(page_id, user_id)

    draft = SimpleNamespace(
        id=uuid.uuid4(), page_id=page_id, content="x", content_format="markdown",
        edit_mode="markdown", base_updated_at=page.updated_at, updated_at=page.updated_at,
    )
    service.drafts.get = AsyncMock(return_value=draft)
    loaded = await service.get_draft(page, user)
    assert loaded is not None and loaded.is_conflict is False

    service.drafts.delete = AsyncMock()
    await service.discard_draft(page, user)
    service.drafts.delete.assert_awaited_once_with(draft)


@pytest.mark.asyncio
async def test_draft_missing_returns_none_and_discard_is_noop() -> None:
    service = _service()
    page = SimpleNamespace(id=uuid.uuid4(), updated_at=datetime.now(UTC))
    user = SimpleNamespace(id=uuid.uuid4())
    service.drafts.get = AsyncMock(return_value=None)
    service.drafts.delete = AsyncMock()

    assert await service.get_draft(page, user) is None
    await service.discard_draft(page, user)
    service.drafts.delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_calculate_diff_covers_html_plain_and_all_line_operations() -> None:
    service = _service()
    page = SimpleNamespace(id=uuid.uuid4())
    service.list_revisions = AsyncMock(return_value=[
        _revision(2, "same\nnew line\nadded", "markdown"),
        _revision(1, "same\nold line\nremoved", "markdown"),
    ])
    diff = await service.calculate_diff(page)
    assert {line.operation for line in diff.lines} == {"equal", "replace"}
    assert any(segment.operation == "delete" for line in diff.lines for segment in line.old_segments)
    assert any(segment.operation == "add" for line in diff.lines for segment in line.new_segments)

    service.list_revisions = AsyncMock(return_value=[
        _revision(2, "<p>same</p><p>new</p>", "html"),
        _revision(1, "<p>same</p><p>old</p>", "html"),
    ])
    html_diff = await service.calculate_diff(page, from_version=1, to_version=2)
    assert html_diff.lines[0].operation == "equal"
    assert html_diff.lines[1].operation == "replace"

    service.list_revisions = AsyncMock(return_value=[
        _revision(2, "<span>text only</span>", "html"),
        _revision(1, "<span>text</span>", "html"),
    ])
    fallback = await service.calculate_diff(page, from_version=1, to_version=2)
    assert fallback.lines


@pytest.mark.asyncio
async def test_calculate_diff_falls_back_to_available_revisions_and_rejects_empty() -> None:
    service = _service()
    page = SimpleNamespace(id=uuid.uuid4())
    service.list_revisions = AsyncMock(return_value=[])
    with pytest.raises(NotFoundError, match="No revisions available"):
        await service.calculate_diff(page)

    service.list_revisions = AsyncMock(return_value=[_revision(1, "one", "markdown")])
    result = await service.calculate_diff(page, from_version=99, to_version=98)
    assert result.from_version == 1 and result.to_version == 1


@pytest.mark.asyncio
async def test_calculate_diff_covers_nested_html_and_unbalanced_operations() -> None:
    service = _service()
    page = SimpleNamespace(id=uuid.uuid4())

    async def calculate(old: str, new: str, content_format: str = "markdown"):
        service.list_revisions = AsyncMock(return_value=[
            _revision(2, new, content_format),
            _revision(1, old, content_format),
        ])
        return await service.calculate_diff(page, from_version=1, to_version=2)

    deleted = await calculate("keep\nremoved", "keep")
    assert any(line.operation == "delete" for line in deleted.lines)

    inserted = await calculate("keep", "keep\nadded")
    assert any(line.operation == "add" for line in inserted.lines)

    more_old = await calculate("a\nold extra", "b")
    assert any(line.operation == "delete" for line in more_old.lines)

    more_new = await calculate("a", "b\nnew extra")
    assert any(line.operation == "add" for line in more_new.lines)

    char_insert = await calculate("cat", "cats")
    assert any(segment.operation == "add" for line in char_insert.lines for segment in line.new_segments)

    nested = await calculate(
        "<div><p>one</p><p>two</p></div>",
        "<div><p>one</p><p>three</p></div>",
        "html",
    )
    assert any(line.operation == "replace" for line in nested.lines)


@pytest.mark.asyncio
async def test_update_removes_existing_draft_after_snapshot() -> None:
    service = _service()
    page = SimpleNamespace(
        id=uuid.uuid4(), slug="old", title="Old", content="old", content_format="html",
        updated_by_id=None,
    )
    space = SimpleNamespace(key="ENG")
    user = SimpleNamespace(id=uuid.uuid4(), username="editor")
    draft = SimpleNamespace()
    service.session.flush = AsyncMock()
    service.session.refresh = AsyncMock()
    service.snapshot_revision = AsyncMock()
    service.drafts.get = AsyncMock(return_value=draft)
    service.drafts.delete = AsyncMock()

    updated = await service.update(space, page, PageUpdate(content="new"), user)
    assert updated.content == "new"
    service.snapshot_revision.assert_awaited_once_with(page, user, "Updated content")
    service.drafts.delete.assert_awaited_once_with(draft)


@pytest.mark.asyncio
async def test_draft_repository_and_api_wrappers_delegate() -> None:
    page = SimpleNamespace(id=uuid.uuid4())
    user = SimpleNamespace(id=uuid.uuid4())
    space = SimpleNamespace()
    draft_service = Mock(
        get_draft=AsyncMock(return_value=None),
        save_draft=AsyncMock(return_value="saved"),
        discard_draft=AsyncMock(),
        get_by_slug=AsyncMock(return_value=page),
    )
    space_service = Mock(get_by_key=AsyncMock(return_value=space))

    assert await pages_api.get_page_draft("ENG", "home", user, draft_service, space_service) is None
    assert await pages_api.save_page_draft("ENG", "home", Mock(), user, draft_service, space_service) == "saved"
    assert await pages_api.delete_page_draft("ENG", "home", user, draft_service, space_service) is None
    draft_service.get_draft.assert_awaited_once_with(page, user)
    draft_service.save_draft.assert_awaited_once()
    draft_service.discard_draft.assert_awaited_once_with(page, user)

    session = Mock()
    result = Mock(scalar_one_or_none=Mock(return_value="draft"))
    session.execute = AsyncMock(return_value=result)
    session.delete = AsyncMock()
    repository = PageDraftRepository(session)
    assert await repository.get(page.id, user.id) == "draft"
    draft = SimpleNamespace()
    assert repository.add(draft) is draft
    await repository.delete(draft)
    session.add.assert_called_once_with(draft)
    session.delete.assert_awaited_once_with(draft)


@pytest.mark.asyncio
async def test_revision_api_wrappers_authorize_and_delegate() -> None:
    user = SimpleNamespace(id=uuid.uuid4())
    space = SimpleNamespace(id=uuid.uuid4())
    page = SimpleNamespace(id=uuid.uuid4())
    revisions = [_revision(1, "content")]
    diff = SimpleNamespace(from_version=1, to_version=2)
    restored = SimpleNamespace(id=page.id)
    page_service = Mock(
        get_by_slug=AsyncMock(return_value=page),
        require_page_view=AsyncMock(),
        list_revisions=AsyncMock(return_value=revisions),
        calculate_diff=AsyncMock(return_value=diff),
        get_revision=AsyncMock(return_value=revisions[0]),
        restore_revision=AsyncMock(return_value=restored),
        to_read_for_user=AsyncMock(return_value="page-read"),
    )
    space_service = Mock(
        get_by_key=AsyncMock(return_value=space),
        require_view=AsyncMock(),
    )

    assert await revisions_api.list_revisions("ENG", "home", user, page_service, space_service) == revisions
    assert await revisions_api.get_revision_diff(
        "ENG", "home", user, page_service, space_service, from_version=1, to_version=2
    ) == diff
    assert await revisions_api.get_revision("ENG", "home", 1, user, page_service, space_service) == revisions[0]
    assert await revisions_api.restore_revision("ENG", "home", 1, user, page_service, space_service) == "page-read"
    assert revisions_api.get_page_service(Mock())
    assert revisions_api.get_space_service(Mock())
    assert space_service.require_view.await_count == 3
    assert page_service.require_page_view.await_count == 3
