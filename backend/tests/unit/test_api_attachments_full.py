from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import UploadFile

from app.api.v1.attachments import _safe_filename, upload_attachment, get_attachment_metadata
from app.core.exceptions import BadRequestError, UnsupportedMediaTypeError, PayloadTooLargeError, NotFoundError
from app.models.attachment import PageAttachment
from app.models.page import WikiPage
from app.models.space import Space
from app.schemas.site_settings import SiteSettingsRead

def test_safe_filename():
    assert _safe_filename("hello.txt") == "hello.txt"
    with pytest.raises(BadRequestError):
        _safe_filename("")
    with pytest.raises(BadRequestError):
        _safe_filename(".")
    with pytest.raises(BadRequestError):
        _safe_filename("..")

@pytest.mark.asyncio
async def test_upload_attachment_empty_and_disallowed(monkeypatch):
    session = AsyncMock()
    user = Mock()
    page = Mock()
    storage = AsyncMock()

    class MockSiteSettingsService:
        def __init__(self, session): pass
        async def get_effective(self):
            m = Mock()
            m.allowed_attachment_types = ["png", "pdf"]
            m.max_upload_size_bytes = 1000
            m.max_upload_size_mb = 1
            return m
    monkeypatch.setattr("app.api.v1.attachments.SiteSettingsService", MockSiteSettingsService)

    class MockSpaceService:
        def __init__(self, session): pass
        async def get_by_key(self, k): return Mock(max_upload_size_mb=None)
    class MockPageService:
        def __init__(self, session): pass
        async def get_by_slug(self, s, slug): return Mock()
        async def require_page_editor(self, p, u): pass
    monkeypatch.setattr("app.api.v1.attachments.SpaceService", MockSpaceService)
    monkeypatch.setattr("app.api.v1.attachments.PageService", MockPageService)

    # test disallowed type
    file = AsyncMock()
    file.filename = "file.exe"
    file.content_type = "application/x-msdownload"
    with pytest.raises(UnsupportedMediaTypeError):
        await upload_attachment("TEST", "home", file, user, session, storage)
        
    # test empty file
    file = AsyncMock()
    file.filename = "file.png"
    file.content_type = "image/png"
    file.read.return_value = b""
    with pytest.raises(BadRequestError):
        await upload_attachment("TEST", "home", file, user, session, storage)
        
    # test payload too large
    file = AsyncMock()
    file.filename = "file.png"
    file.content_type = "image/png"
    file.read.return_value = b"x" * 1001
    with pytest.raises(PayloadTooLargeError):
        await upload_attachment("TEST", "home", file, user, session, storage)

@pytest.mark.asyncio
async def test_get_attachment_metadata(monkeypatch):
    session = AsyncMock()
    user = Mock()
    att_id = uuid.uuid4()
    
    # NotFound attachment
    session.get.return_value = None
    with pytest.raises(NotFoundError):
        await get_attachment_metadata(att_id, user, session)
        
    # NotFound page
    from datetime import datetime, UTC
    att = PageAttachment(id=att_id, page_id=uuid.uuid4(), filename="file.png", content_type="image/png", size_bytes=100, object_key="a/b/c", created_at=datetime.now(UTC))
    def get_side_effect(model, id, **_options):
        if model == PageAttachment: return att
        if model == WikiPage: return None
    session.get.side_effect = get_side_effect
    with pytest.raises(NotFoundError):
        await get_attachment_metadata(att_id, user, session)
        
    # NotFound space
    page = WikiPage(id=att.page_id, space_id=uuid.uuid4(), slug="home", title="Home")
    def get_side_effect2(model, id, **_options):
        if model == PageAttachment: return att
        if model == WikiPage: return page
        if model == Space: return None
    session.get.side_effect = get_side_effect2
    with pytest.raises(NotFoundError):
        await get_attachment_metadata(att_id, user, session)
        
    # Success
    space = Space(id=page.space_id, key="TEST", name="Test")
    def get_side_effect3(model, id, **_options):
        if model == PageAttachment: return att
        if model == WikiPage: return page
        if model == Space: return space
    session.get.side_effect = get_side_effect3
    
    class MockSpaceService:
        def __init__(self, s):
            self.permissions = AsyncMock()
            self.permissions.require = AsyncMock()
    class MockPageService:
        def __init__(self, s):
            self.require_page_view = AsyncMock()
            
    monkeypatch.setattr("app.api.v1.attachments.SpaceService", MockSpaceService)
    monkeypatch.setattr("app.api.v1.attachments.PageService", MockPageService)
    
    res = await get_attachment_metadata(att_id, user, session)
    assert res.filename == "file.png"


@pytest.mark.asyncio
async def test_a_trashed_pages_attachments_are_for_whoever_may_use_its_trash(monkeypatch):
    """The Trash preview draws the page's images; nobody else may see a deleted page's files."""
    from datetime import UTC, datetime

    from app.api.v1.attachments import _load_attachment_for_view

    att_id = uuid.uuid4()
    att = PageAttachment(
        id=att_id,
        page_id=uuid.uuid4(),
        filename="diagram.png",
        content_type="image/png",
        size_bytes=1,
        object_key="a/b/c",
        created_at=datetime.now(UTC),
    )
    page = WikiPage(id=att.page_id, space_id=uuid.uuid4(), slug="home", title="Home")
    page.deleted_at = datetime.now(UTC)
    space = Space(id=page.space_id, key="ENG", name="Engineering")
    seen = {}

    async def fake_get(model, ident, **options):
        seen[model.__name__] = options
        return {PageAttachment: att, WikiPage: page, Space: space}[model]

    session = AsyncMock()
    session.get.side_effect = fake_get

    class Permissions:
        require = AsyncMock()

    class Spaces:
        def __init__(self, _session):
            self.permissions = Permissions()

    pages = Mock()
    pages.require_page_view = AsyncMock()
    monkeypatch.setattr("app.api.v1.attachments.SpaceService", Spaces)
    monkeypatch.setattr("app.api.v1.attachments.PageService", lambda _session: pages)
    user = Mock()

    # It asks for the page even from the Trash.
    pages.can_trash = AsyncMock(return_value=True)
    loaded, loaded_page = await _load_attachment_for_view(att_id, user, session)
    assert (loaded, loaded_page) == (att, page)
    assert seen["WikiPage"] == {"execution_options": {"include_deleted": True}}
    pages.can_trash.assert_awaited_once_with(space, page, user)

    # Someone who may not use that Trash gets what a missing page gives.
    pages.can_trash = AsyncMock(return_value=False)
    with pytest.raises(NotFoundError):
        await _load_attachment_for_view(att_id, user, session)

    # A page that is not in the Trash is never asked about the Trash at all.
    page.deleted_at = None
    pages.can_trash = AsyncMock(return_value=False)
    assert (await _load_attachment_for_view(att_id, user, session))[1] is page
    pages.can_trash.assert_not_awaited()
