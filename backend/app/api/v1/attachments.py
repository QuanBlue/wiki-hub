"""Read endpoints for page attachments imported from Confluence."""

from __future__ import annotations

import re
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response

from app.api.deps import CurrentUser, DbSession
from app.core.exceptions import NotFoundError
from app.models.attachment import PageAttachment
from app.models.page import WikiPage
from app.models.permission import Permission
from app.models.space import Space
from app.modules.pages.service import PageService
from app.modules.spaces.service import SpaceService
from app.services.storage import ObjectStorage, S3ObjectStorage

router = APIRouter(prefix="/attachments", tags=["attachments"])


def get_storage() -> ObjectStorage:
    return S3ObjectStorage()


StorageDep = Annotated[ObjectStorage, Depends(get_storage)]


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
    inline = (
        attachment.content_type.startswith("image/") or attachment.content_type == "application/pdf"
    )
    disposition = "inline" if inline else "attachment"
    filename = re.sub(r"[\r\n\\\"]", "", attachment.filename)
    return Response(
        content=await storage.get(attachment.object_key),
        media_type=attachment.content_type,
        headers={"Content-Disposition": f'{disposition}; filename="{filename}"'},
    )
