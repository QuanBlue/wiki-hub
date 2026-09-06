"""One place that decides how a page attachment is validated, named and stored.

Two callers reach this module, and they must not drift apart: the interactive
editor upload (``api/v1/attachments.py``) and the document importer, which
attaches every image it pulls out of a Word or PDF file. The gates below - the
SVG rejection, the workspace extension allowlist, the size ceiling - are
security decisions, and a second hand-written copy of them in the worker is
exactly how one of the two ends up weaker than the other.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    BadRequestError,
    PayloadTooLargeError,
    UnsupportedMediaTypeError,
)
from app.models.attachment import PageAttachment
from app.models.page import WikiPage
from app.schemas.site_settings import EffectiveSettings
from app.services.storage import ObjectStorage


def safe_attachment_filename(filename: str | None) -> str:
    """The basename only, never a path.

    Splitting on both ``/`` and ``\\`` explicitly is what stops
    ``../../etc/passwd`` from reaching an object key - the key is built by
    interpolation, so a separator surviving this function would let an
    attachment be written outside its page prefix. ``Path(...).name`` alone
    is not enough for that: it only recognises the *host* OS's own
    separator, and this always runs as ``PosixPath`` in production (a Linux
    container), under which a backslash is an ordinary filename character,
    not a separator - a Windows-style path survived here untouched.
    """
    raw = (filename or "").strip()
    name = re.split(r"[\\/]+", raw)[-1].strip()
    if not name or name in {".", ".."}:
        raise BadRequestError("The attachment must have a filename.")
    return name[:255]


def attachment_extension_allowed(filename: str, allowed_extensions: list[str]) -> bool:
    extension = Path(filename).suffix.lower().lstrip(".")
    return "*" in allowed_extensions or (bool(extension) and extension in allowed_extensions)


def reject_svg(filename: str, content_type: str) -> None:
    """SVG is active content when displayed inline; never accept it as an attachment.

    Checked by content type *and* by extension because either one alone is
    attacker-controlled, and this rejection outranks the workspace allowlist -
    an operator who allows ``svg`` still does not get script execution.
    """
    if content_type.lower() == "image/svg+xml" or filename.lower().endswith(".svg"):
        raise UnsupportedMediaTypeError("SVG files cannot be uploaded as page attachments.")


def build_object_key(page_id: uuid.UUID, attachment_id: uuid.UUID, filename: str) -> str:
    return f"attachments/{page_id}/{attachment_id}/{filename}"


def prepare_attachment(
    *,
    page: WikiPage,
    filename: str | None,
    data: bytes,
    content_type: str,
    effective: EffectiveSettings,
) -> PageAttachment:
    """Validate and build the row, without touching the session or storage.

    Split out from :func:`store_attachment` so a batch caller can add every row
    and flush once before writing any blob - see the leak-ordering note there.
    """
    safe_name = safe_attachment_filename(filename)
    normalized_type = (content_type or "application/octet-stream").lower()
    reject_svg(safe_name, normalized_type)

    if not attachment_extension_allowed(safe_name, effective.allowed_attachment_types):
        raise UnsupportedMediaTypeError("This file type is not allowed by workspace settings.")
    if not data:
        raise BadRequestError("The attachment is empty.")
    if len(data) > effective.max_upload_size_bytes:
        raise PayloadTooLargeError(
            f"Attachments must be {effective.max_upload_size_mb} MB or smaller."
        )

    attachment_id = uuid.uuid4()
    return PageAttachment(
        id=attachment_id,
        page_id=page.id,
        filename=safe_name,
        content_type=normalized_type,
        object_key=build_object_key(page.id, attachment_id, safe_name),
        size_bytes=len(data),
    )


def attachment_content_url(attachment: PageAttachment) -> str:
    """The authenticated URL embedded in page content."""
    return f"/api/v1/attachments/{attachment.id}/content"


async def store_attachment(
    session: AsyncSession,
    storage: ObjectStorage,
    *,
    page: WikiPage,
    filename: str | None,
    data: bytes,
    content_type: str,
    effective: EffectiveSettings,
) -> PageAttachment:
    """Validate, persist the row, and write the blob."""
    attachment = prepare_attachment(
        page=page,
        filename=filename,
        data=data,
        content_type=content_type,
        effective=effective,
    )
    session.add(attachment)
    await storage.put(attachment.object_key, data, content_type=attachment.content_type)
    await session.flush()
    return attachment
