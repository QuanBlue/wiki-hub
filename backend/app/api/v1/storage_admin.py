"""Admin storage management endpoints.

Provides a read / delete interface over the S3 bucket so administrators can
inspect, download, and clean up stored objects without leaving the WikiHub UI.
Deleting an object also removes the associated database record so that the same
file can be re-uploaded without a hash conflict.
"""

from __future__ import annotations

from typing import Annotated
from urllib.parse import unquote

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import CurrentSuperuser, DbSession
from app.core.exceptions import NotFoundError
from app.models.attachment import PageAttachment
from app.models.import_job import ImportArchive
from app.models.page import WikiPage
from app.models.space import Space
from app.models.user import User
from app.services.storage import ObjectStorage, S3ObjectStorage, StoredObject

router = APIRouter(prefix="/storage", tags=["storage"])


# ---------------------------------------------------------------------------
# Dependency
# ---------------------------------------------------------------------------


def get_storage() -> ObjectStorage:
    return S3ObjectStorage()


StorageDep = Annotated[ObjectStorage, Depends(get_storage)]


def storage_kind(key: str) -> str:
    if key.startswith("attachments/"):
        return "page_attachment"
    if key.startswith("avatars/"):
        return "avatar"
    if key.startswith("confluence-imports/"):
        return "import_archive"
    return "other"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class StorageObjectRead(BaseModel):
    key: str
    size: int
    etag: str | None
    last_modified: str | None
    kind: str
    space_id: str | None = None
    space_name: str | None = None
    page_id: str | None = None
    page_title: str | None = None

    @classmethod
    def from_stored(
        cls,
        obj: StoredObject,
        *,
        kind: str = "other",
        space_id: str | None = None,
        space_name: str | None = None,
        page_id: str | None = None,
        page_title: str | None = None,
    ) -> StorageObjectRead:
        return cls(
            key=obj.key,
            size=obj.size,
            etag=obj.etag,
            last_modified=obj.last_modified.isoformat() if obj.last_modified else None,
            kind=kind,
            space_id=space_id,
            space_name=space_name,
            page_id=page_id,
            page_title=page_title,
        )


class PresignedUrlRead(BaseModel):
    url: str
    key: str


class DeleteResult(BaseModel):
    key: str
    archive_cleared: bool
    attachment_deleted: bool


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[StorageObjectRead], summary="List all S3 objects")
async def list_storage_objects(
    _admin: CurrentSuperuser,
    storage: StorageDep,
    session: DbSession = None,  # type: ignore[assignment]
    prefix: str = Query(default="", description="Optional key prefix to filter"),
) -> list[StorageObjectRead]:
    """Return every object stored in the configured S3 bucket.

    The frontend builds a virtual folder tree from the flat key list by
    splitting on ``/`` separators. This keeps the API simple and avoids the
    complexity of server-side hierarchy navigation.
    """
    objects = await storage.list_objects(prefix=prefix)
    if session is None:
        return [StorageObjectRead.from_stored(obj, kind=storage_kind(obj.key)) for obj in objects]

    attachment_rows = (
        await session.execute(
            select(
                PageAttachment.object_key,
                WikiPage.id,
                WikiPage.title,
                Space.id,
                Space.name,
            )
            .join(WikiPage, PageAttachment.page_id == WikiPage.id)
            .join(Space, WikiPage.space_id == Space.id)
        )
    ).all()
    attachments = {
        object_key: {
            "page_id": str(page_id),
            "page_title": page_title,
            "space_id": str(space_id),
            "space_name": space_name,
        }
        for object_key, page_id, page_title, space_id, space_name in attachment_rows
    }
    avatar_keys = set(
        (
            await session.scalars(
                select(User.avatar_object_key).where(User.avatar_object_key.is_not(None))
            )
        ).all()
    )
    archive_keys = set((await session.scalars(select(ImportArchive.object_key))).all())

    result: list[StorageObjectRead] = []
    for obj in objects:
        attachment = attachments.get(obj.key)
        if attachment is not None:
            result.append(
                StorageObjectRead.from_stored(
                    obj,
                    kind="page_attachment",
                    **attachment,
                )
            )
        elif obj.key in avatar_keys:
            result.append(StorageObjectRead.from_stored(obj, kind="avatar"))
        elif obj.key in archive_keys:
            result.append(StorageObjectRead.from_stored(obj, kind="import_archive"))
        else:
            result.append(StorageObjectRead.from_stored(obj, kind=storage_kind(obj.key)))
    return result


@router.get(
    "/presign",
    response_model=PresignedUrlRead,
    summary="Get a presigned download URL for an object",
)
async def presign_download(
    _admin: CurrentSuperuser,
    storage: StorageDep,
    key: str = Query(..., description="The S3 object key to presign"),
    inline: bool = Query(
        default=False,
        description="Return an inline URL for browser previews instead of a download URL",
    ),
) -> PresignedUrlRead:
    """Generate a short-lived presigned URL so the browser can download the
    file directly from S3 without routing the bytes through the API server."""
    # Derive a friendly filename for Content-Disposition
    filename = None if inline else unquote(key.rsplit("/", 1)[-1])
    url = await storage.presigned_url(key, download_as=filename)
    return PresignedUrlRead(url=url, key=key)


@router.delete("", response_model=DeleteResult, summary="Delete an S3 object")
async def delete_storage_object(
    _admin: CurrentSuperuser,
    storage: StorageDep,
    session: DbSession,
    key: str = Query(..., description="The S3 object key to delete"),
) -> DeleteResult:
    """Delete an object from S3 and clean up any database references.

    * If the key matches a **Confluence import archive**, its ``sha256`` hash
      is cleared and its status set to ``"cancelled"`` so the same archive can
      be re-uploaded without a duplicate-detection conflict.

    * If the key matches a **page attachment**, the ``page_attachments`` row is
      deleted. The page will display a broken media placeholder, which is the
      expected behaviour when the underlying file has been removed.
    """
    # Verify the object exists before touching the database.
    if not await storage.exists(key):
        raise NotFoundError(f"Object '{key}' was not found in storage.")

    # Delete from S3 first so a partial failure never leaves an orphaned record.
    await storage.delete(key)

    archive_cleared = False
    attachment_deleted = False

    # --- Confluence import archive ------------------------------------------
    archive = await session.scalar(select(ImportArchive).where(ImportArchive.object_key == key))
    if archive is not None:
        archive.sha256 = None
        archive.status = "cancelled"
        await session.flush()
        archive_cleared = True

    # --- Page attachment ----------------------------------------------------
    attachment = await session.scalar(
        select(PageAttachment).where(PageAttachment.object_key == key)
    )
    if attachment is not None:
        await session.delete(attachment)
        await session.flush()
        attachment_deleted = True

    return DeleteResult(
        key=key,
        archive_cleared=archive_cleared,
        attachment_deleted=attachment_deleted,
    )
