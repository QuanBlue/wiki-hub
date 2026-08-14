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
from app.services.storage import ObjectStorage, S3ObjectStorage, StoredObject

router = APIRouter(prefix="/storage", tags=["storage"])


# ---------------------------------------------------------------------------
# Dependency
# ---------------------------------------------------------------------------

def get_storage() -> ObjectStorage:
    return S3ObjectStorage()


StorageDep = Annotated[ObjectStorage, Depends(get_storage)]


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class StorageObjectRead(BaseModel):
    key: str
    size: int
    etag: str | None
    last_modified: str | None

    @classmethod
    def from_stored(cls, obj: StoredObject) -> "StorageObjectRead":
        return cls(
            key=obj.key,
            size=obj.size,
            etag=obj.etag,
            last_modified=obj.last_modified.isoformat() if obj.last_modified else None,
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
    prefix: str = Query(default="", description="Optional key prefix to filter"),
) -> list[StorageObjectRead]:
    """Return every object stored in the configured S3 bucket.

    The frontend builds a virtual folder tree from the flat key list by
    splitting on ``/`` separators. This keeps the API simple and avoids the
    complexity of server-side hierarchy navigation.
    """
    objects = await storage.list_objects(prefix=prefix)
    return [StorageObjectRead.from_stored(o) for o in objects]


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
    archive = await session.scalar(
        select(ImportArchive).where(ImportArchive.object_key == key)
    )
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
