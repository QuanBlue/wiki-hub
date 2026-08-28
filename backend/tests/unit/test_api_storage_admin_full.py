import mimetypes
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import Request

from app.api.v1.storage_admin import (
    storage_kind,
    storage_proxy_url,
    list_storage_objects,
    presign_download,
    read_storage_object,
    upload_storage_part,
    delete_storage_object,
)
from app.core.exceptions import NotFoundError
from app.models.attachment import PageAttachment
from app.models.import_job import ImportArchive
from app.models.user import User
from app.models.page import WikiPage
from app.models.space import Space


def test_storage_kind():
    assert storage_kind("attachments/1.txt") == "page_attachment"
    assert storage_kind("avatars/user.png") == "avatar"
    assert storage_kind("imports/confluence/a.zip") == "import_archive"
    assert storage_kind("imports/documents/job/item/a.docx") == "document_import"
    assert storage_kind("backups/imports/id/a.zip") == "backup_archive"
    assert storage_kind("backups/exports/id/a.zip") == "backup_export"
    assert storage_kind("other/path") == "other"


def test_storage_proxy_url():
    assert storage_proxy_url("a/b c") == "/api/v1/storage/object?key=a%2Fb%20c"
    assert (
        storage_proxy_url("k", download_as="f.png")
        == "/api/v1/storage/object?key=k&download_as=f.png"
    )
    assert storage_proxy_url("k", inline=True) == "/api/v1/storage/object?key=k&inline=true"


@pytest.mark.asyncio
async def test_list_storage_objects():
    session = AsyncMock()
    storage = AsyncMock()
    
    from datetime import datetime, UTC
    dt = datetime.now(UTC)
    
    m1 = Mock()
    m1.key = "attachments/1.txt"
    m1.size = 100
    m1.last_modified = dt
    m1.etag = "1"
    
    m2 = Mock()
    m2.key = "avatars/2.png"
    m2.size = 200
    m2.last_modified = dt
    m2.etag = "2"
    
    m3 = Mock()
    m3.key = "imports/confluence/3.zip"
    m3.size = 300
    m3.last_modified = dt
    m3.etag = "3"
    
    m4 = Mock()
    m4.key = "other/4.bin"
    m4.size = 400
    m4.last_modified = dt
    m4.etag = "4"
    
    storage.list_objects.return_value = [m1, m2, m3, m4]
    
    # 1. Attachment rows
    att_row = ("attachments/1.txt", "pid", "title", "sid", "space")
    m_res = Mock()
    m_res.all.return_value = [att_row]
    session.execute.return_value = m_res
    
    # 2. Avatar keys
    m_s = Mock()
    m_s.all.side_effect = [
        ["avatars/2.png"],
        ["imports/confluence/3.zip"]
    ]
    session.scalars.return_value = m_s
    
    res = await list_storage_objects(Mock(), storage, session)
    assert len(res) == 4
    assert res[0].kind == "page_attachment"
    assert res[0].page_id == "pid"
    assert res[1].kind == "avatar"
    assert res[2].kind == "import_archive"
    assert res[3].kind == "other"

@pytest.mark.asyncio
async def test_presign_download(monkeypatch):
    monkeypatch.setattr("app.api.v1.storage_admin.storage_proxy_url", Mock(return_value="url"))
    storage = AsyncMock()
    
    storage.exists.return_value = False
    with pytest.raises(NotFoundError):
        await presign_download(Mock(), storage, "file.txt", False)
        
    storage.exists.return_value = True
    res = await presign_download(Mock(), storage, "file.txt", False)
    assert res.url == "url"

@pytest.mark.asyncio
async def test_read_storage_object():
    storage = AsyncMock()
    storage.exists.return_value = False
    with pytest.raises(NotFoundError):
        await read_storage_object(Mock(), storage, "file.txt", None, False)
        
    storage.exists.return_value = True

    async def _chunks():
        yield b"da"
        yield b"ta"

    storage.get_stream.return_value = (4, _chunks())
    res = await read_storage_object(Mock(), storage, "file.txt", None, False)
    assert res.headers["content-length"] == "4"
    body = b"".join([chunk async for chunk in res.body_iterator])
    assert body == b"data"

@pytest.mark.asyncio
async def test_upload_storage_part():
    storage = AsyncMock()
    storage.upload_part.return_value = "etag123"
    request = AsyncMock()
    request.body.return_value = b"part"
    res = await upload_storage_part(request, Mock(), storage, "key", "uid", 1)
    assert res.status_code == 200

@pytest.mark.asyncio
async def test_delete_storage_object():
    storage = AsyncMock()
    session = AsyncMock()
    
    storage.exists.return_value = False
    with pytest.raises(NotFoundError):
        await delete_storage_object(Mock(), storage, session, "key")
        
    # Confluence archive row, backup restore archive row, attachment row.
    storage.exists.return_value = True
    session.scalar.side_effect = [Mock(), None, Mock()]
    res = await delete_storage_object(Mock(), storage, session, "key")
    assert res.archive_cleared is True
    assert res.attachment_deleted is True


@pytest.mark.asyncio
async def test_delete_storage_object_clears_backup_archive():
    """A deleted restore archive must not stay offered as ready to restore.

    Left alone the row keeps its "uploaded"/"scanned" status and its hash, so
    `/backup/archives/uploads/active` goes on advertising an archive whose
    bytes are gone and the restore only fails in the worker.
    """
    storage = AsyncMock()
    session = AsyncMock()
    storage.exists.return_value = True

    archive = Mock()
    archive.sha256 = "abc"
    archive.status = "scanned"
    archive.multipart_upload_id = "upload-1"
    session.scalar.side_effect = [None, archive, None]

    res = await delete_storage_object(
        Mock(), storage, session, "backups/imports/id/backup.zip"
    )
    assert res.archive_cleared is True
    assert res.attachment_deleted is False
    assert archive.status == "cancelled"
    assert archive.sha256 is None
    assert archive.multipart_upload_id is None
