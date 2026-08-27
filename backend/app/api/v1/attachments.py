"""Read endpoints for page attachments imported from Confluence."""

from __future__ import annotations

import re
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Response, UploadFile, status
from pydantic import BaseModel

from app.api.deps import CurrentUser, DbSession
from app.core.exceptions import (
    BadRequestError,
    NotFoundError,
    PayloadTooLargeError,
    UnsupportedMediaTypeError,
)
from app.models.attachment import PageAttachment
from app.models.page import WikiPage
from app.models.permission import Permission
from app.models.space import Space
from app.modules.attachments.store import (
    attachment_content_url,
    attachment_extension_allowed,
    reject_svg,
    safe_attachment_filename,
    store_attachment,
)
from app.modules.pages.service import PageService
from app.modules.spaces.service import SpaceService
from app.services.site_settings import SiteSettingsService
from app.services.storage import ObjectStorage, S3ObjectStorage

router = APIRouter(prefix="/attachments", tags=["attachments"])
upload_router = APIRouter(tags=["attachments"])


def get_storage() -> ObjectStorage:
    return S3ObjectStorage()


StorageDep = Annotated[ObjectStorage, Depends(get_storage)]


class AttachmentUploadRead(BaseModel):
    id: uuid.UUID
    filename: str
    content_type: str
    content_url: str


class AttachmentMetadataRead(BaseModel):
    id: uuid.UUID
    page_id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int
    created_at: str


# Kept as module-level names: the validation itself lives in
# `app.modules.attachments.store` so the document importer applies exactly the
# same gates, but these aliases keep this module's existing callers and tests
# importing from where they always have.
_safe_filename = safe_attachment_filename
_allowed_attachment = attachment_extension_allowed


@upload_router.post(
    "/spaces/{key}/pages/{slug}/attachments",
    response_model=AttachmentUploadRead,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a page attachment",
)
async def upload_attachment(
    key: str,
    slug: str,
    file: Annotated[UploadFile, File(description="A file to insert into the page")],
    user: CurrentUser,
    session: DbSession,
    storage: StorageDep,
) -> AttachmentUploadRead:
    """Store an editor upload and return the authenticated URL to embed in page content."""
    space = await SpaceService(session).get_by_key(key)
    page = await PageService(session).get_by_slug(space, slug)
    await PageService(session).require_page_editor(page, user)

    filename = safe_attachment_filename(file.filename)
    content_type = (file.content_type or "application/octet-stream").lower()
    reject_svg(filename, content_type)

    effective = await SiteSettingsService(session).get_effective()
    # Rejected before a single byte is read: there is no reason to pull 50 MB
    # off the wire for a file type this workspace will not keep.
    if not attachment_extension_allowed(filename, effective.allowed_attachment_types):
        raise UnsupportedMediaTypeError("This file type is not allowed by workspace settings.")
    # One byte over the ceiling is enough to know it is over the ceiling.
    data = await file.read(effective.max_upload_size_bytes + 1)

    attachment = await store_attachment(
        session,
        storage,
        page=page,
        filename=filename,
        data=data,
        content_type=content_type,
        effective=effective,
    )
    return AttachmentUploadRead(
        id=attachment.id,
        filename=attachment.filename,
        content_type=attachment.content_type,
        content_url=attachment_content_url(attachment),
    )


@router.get("/{attachment_id}", response_model=AttachmentMetadataRead, summary="Get attachment metadata")
async def get_attachment_metadata(
    attachment_id: uuid.UUID,
    _user: CurrentUser,
    session: DbSession,
) -> AttachmentMetadataRead:
    """Return file metadata (name, type, size, date) for the attachment details modal."""
    attachment = await session.get(PageAttachment, attachment_id)
    if attachment is None:
        raise NotFoundError("Attachment not found.")
    page = await session.get(WikiPage, attachment.page_id)
    if page is None:
        raise NotFoundError("Attachment page not found.")
    space = await session.get(Space, page.space_id)
    if space is None:
        raise NotFoundError("Attachment space not found.")
    await SpaceService(session).permissions.require(space, _user, Permission.view)
    await PageService(session).require_page_view(page, _user)
    return AttachmentMetadataRead(
        id=attachment.id,
        page_id=attachment.page_id,
        filename=attachment.filename,
        content_type=attachment.content_type,
        size_bytes=attachment.size_bytes,
        created_at=attachment.created_at.isoformat(),
    )


@router.get("/{attachment_id}/content", response_class=Response, summary="Read a page attachment")
async def read_attachment(
    attachment_id: uuid.UUID,
    _user: CurrentUser,
    session: DbSession,
    storage: StorageDep,
) -> Response:
    attachment = await session.get(PageAttachment, attachment_id)
    if attachment is None:
        raise NotFoundError("Attachment not found.")
    page = await session.get(WikiPage, attachment.page_id)
    if page is None:
        raise NotFoundError("Attachment page not found.")
    space = await session.get(Space, page.space_id)
    if space is None:
        raise NotFoundError("Attachment space not found.")
    await SpaceService(session).permissions.require(space, _user, Permission.view)
    await PageService(session).require_page_view(page, _user)
    import urllib.parse

    inline = (
        attachment.content_type.startswith("image/") or attachment.content_type == "application/pdf"
    )
    disposition = "inline" if inline else "attachment"
    filename = re.sub(r'[\r\n\\"]+', "", attachment.filename)
    ascii_filename = re.sub(r"[^\x20-\x7e]", "_", filename).replace('"', "")
    encoded_filename = urllib.parse.quote(filename, encoding="utf-8")
    content_disposition = (
        f"{disposition}; filename=\"{ascii_filename}\"; filename*=UTF-8''{encoded_filename}"
    )
    return Response(
        content=await storage.get(attachment.object_key),
        media_type=attachment.content_type,
        headers={"Content-Disposition": content_disposition},
    )


@router.put("/{attachment_id}/content", response_model=AttachmentMetadataRead, summary="Replace a page attachment")
async def replace_attachment(
    attachment_id: uuid.UUID,
    file: Annotated[UploadFile, File(description="The edited attachment content")],
    user: CurrentUser,
    session: DbSession,
    storage: StorageDep,
) -> AttachmentMetadataRead:
    """Replace an attachment blob while keeping its page link and identity."""
    attachment = await session.get(PageAttachment, attachment_id)
    if attachment is None:
        raise NotFoundError("Attachment not found.")
    page = await session.get(WikiPage, attachment.page_id)
    if page is None:
        raise NotFoundError("Attachment page not found.")
    await PageService(session).require_page_editor(page, user)

    effective = await SiteSettingsService(session).get_effective()
    data = await file.read(effective.max_upload_size_bytes + 1)
    if not data:
        raise BadRequestError("The attachment is empty.")
    if len(data) > effective.max_upload_size_bytes:
        raise PayloadTooLargeError(
            f"Attachments must be {effective.max_upload_size_mb} MB or smaller."
        )

    await storage.put(attachment.object_key, data, content_type=attachment.content_type)
    attachment.size_bytes = len(data)
    await session.flush()
    return AttachmentMetadataRead(
        id=attachment.id,
        page_id=attachment.page_id,
        filename=attachment.filename,
        content_type=attachment.content_type,
        size_bytes=attachment.size_bytes,
        created_at=attachment.created_at.isoformat(),
    )
