"""Read endpoints for page attachments imported from Confluence."""

from __future__ import annotations

import re
import uuid
from typing import Annotated, Literal
from urllib.parse import urljoin

import httpx
from fastapi import APIRouter, Depends, File, Request, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DbSession
from app.core.exceptions import (
    BadRequestError,
    NotFoundError,
    PayloadTooLargeError,
    ServiceUnavailableError,
    UnsupportedMediaTypeError,
)
from app.core.logging import get_logger
from app.models.attachment import PageAttachment
from app.models.page import WikiPage
from app.models.permission import Permission
from app.models.space import Space
from app.models.user import User
from app.modules.attachments.byte_ranges import UnsatisfiableRange, parse_byte_range
from app.modules.attachments.limits import limits_for_space
from app.modules.attachments.media_tracks import (
    extract_embedded_subtitle,
    probe_embedded_tracks,
    subtitle_extension,
    subtitle_file_to_vtt,
)
from app.modules.attachments.media_types import playable_media_type
from app.modules.attachments.onlyoffice import (
    editor_config,
    file_extension,
    internal_download_url,
    require_enabled,
    verify_callback_token,
    verify_ticket,
)
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
logger = get_logger(__name__)


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


class OfficeEditorConfigRead(BaseModel):
    """The signed ONLYOFFICE configuration consumed by DocsAPI.DocEditor."""

    config: dict[str, object]


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

    effective = limits_for_space(await SiteSettingsService(session).get_effective(), space)
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


async def _load_attachment_for_view(
    attachment_id: uuid.UUID, user: User, session: AsyncSession
) -> tuple[PageAttachment, WikiPage]:
    """Fetch an attachment after checking the caller may view its page."""
    attachment = await session.get(PageAttachment, attachment_id)
    if attachment is None:
        raise NotFoundError("Attachment not found.")
    page = await session.get(WikiPage, attachment.page_id)
    if page is None:
        raise NotFoundError("Attachment page not found.")
    space = await session.get(Space, page.space_id)
    if space is None:
        raise NotFoundError("Attachment space not found.")
    await SpaceService(session).permissions.require(space, user, Permission.view)
    await PageService(session).require_page_view(page, user)
    return attachment, page


@router.get(
    "/{attachment_id}", response_model=AttachmentMetadataRead, summary="Get attachment metadata"
)
async def get_attachment_metadata(
    attachment_id: uuid.UUID,
    _user: CurrentUser,
    session: DbSession,
) -> AttachmentMetadataRead:
    """Return file metadata (name, type, size, date) for the attachment details modal."""
    attachment, _ = await _load_attachment_for_view(attachment_id, _user, session)
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
    request: Request,
    _user: CurrentUser,
    session: DbSession,
    storage: StorageDep,
) -> Response:
    """Serve an attachment, honouring ranged requests.

    Audio and video players seek by requesting byte ranges. Answering every
    request with the full body leaves their timeline unscrubbable, so the
    range is resolved against the stored size and streamed as 206.
    """
    attachment, _ = await _load_attachment_for_view(attachment_id, _user, session)
    import urllib.parse

    media_type = playable_media_type(attachment.content_type, attachment.filename)
    inline = (
        media_type.startswith(("image/", "audio/", "video/"))
        or media_type == "application/pdf"
    )
    disposition = "inline" if inline else "attachment"
    filename = re.sub(r'[\r\n\\"]+', "", attachment.filename)
    ascii_filename = re.sub(r"[^\x20-\x7e]", "_", filename).replace('"', "")
    encoded_filename = urllib.parse.quote(filename, encoding="utf-8")
    content_disposition = (
        f"{disposition}; filename=\"{ascii_filename}\"; filename*=UTF-8''{encoded_filename}"
    )
    headers = {"Content-Disposition": content_disposition, "Accept-Ranges": "bytes"}
    requested = parse_byte_range(request.headers.get("range"), attachment.size_bytes)
    if isinstance(requested, UnsatisfiableRange):
        return Response(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            headers={**headers, "Content-Range": f"bytes */{attachment.size_bytes}"},
        )
    if requested is not None:
        total, chunks = await storage.get_range(
            attachment.object_key, requested.start, requested.end
        )
        end = min(requested.end, total - 1) if total else requested.end
        return StreamingResponse(
            chunks,
            status_code=status.HTTP_206_PARTIAL_CONTENT,
            media_type=media_type,
            headers={
                **headers,
                "Content-Range": f"bytes {requested.start}-{end}/{total or attachment.size_bytes}",
                "Content-Length": str(end - requested.start + 1),
            },
        )
    # A whole attachment can be hundreds of megabytes of video. Stream it out
    # of object storage instead of buffering the entire body in this process.
    size, body = await storage.get_stream(attachment.object_key)
    return StreamingResponse(
        body,
        media_type=media_type,
        headers={**headers, "Content-Length": str(size or attachment.size_bytes)},
    )


class MediaTrackRead(BaseModel):
    """One selectable track for the video preview player."""

    #: Stable within a response; the player uses it to keep a selection.
    id: str
    kind: Literal["subtitle", "audio"]
    label: str
    language: str | None = None
    #: WebVTT URL for a subtitle. Audio tracks have none: a browser can only
    #: switch between the audio streams already inside the file it is playing.
    src: str | None = None
    is_default: bool = False


class MediaTracksRead(BaseModel):
    subtitles: list[MediaTrackRead]
    audio: list[MediaTrackRead]


def _filename_stem(filename: str) -> str:
    return filename.rsplit(".", 1)[0].lower() if "." in filename else filename.lower()


@router.get(
    "/{attachment_id}/media-tracks",
    response_model=MediaTracksRead,
    summary="List the subtitle and audio tracks available for a video",
)
async def list_media_tracks(
    attachment_id: uuid.UUID,
    user: CurrentUser,
    session: DbSession,
    storage: StorageDep,
) -> MediaTracksRead:
    """Everything the preview player can offer for this video.

    Two sources, because neither alone is enough: subtitle files uploaded next
    to the video on the same page, and the subtitle/audio streams muxed into
    the file itself, which no browser will surface on its own.
    """
    attachment, page = await _load_attachment_for_view(attachment_id, user, session)
    media_type = playable_media_type(attachment.content_type, attachment.filename)
    if not media_type.startswith(("video/", "audio/")):
        return MediaTracksRead(subtitles=[], audio=[])

    subtitles: list[MediaTrackRead] = []
    audio: list[MediaTrackRead] = []

    # Sibling files first: they cost one query, always work, and are usually
    # the ones a person deliberately uploaded for this video.
    siblings = (
        await session.execute(
            select(PageAttachment)
            .where(
                PageAttachment.page_id == page.id,
                PageAttachment.id != attachment.id,
            )
            .order_by(PageAttachment.filename)
        )
    ).scalars()
    stem = _filename_stem(attachment.filename)
    companions = [
        companion
        for companion in siblings
        if subtitle_extension(companion.filename) is not None
    ]
    # A file named after the video is the one meant for it, so it leads.
    companions.sort(key=lambda item: not _filename_stem(item.filename).startswith(stem))
    for companion in companions:
        subtitles.append(
            MediaTrackRead(
                id=f"attachment:{companion.id}",
                kind="subtitle",
                label=companion.filename,
                src=f"/api/v1/attachments/{companion.id}/subtitle-track",
            )
        )

    try:
        source = await storage.presigned_internal_url(attachment.object_key)
        embedded = await probe_embedded_tracks(source)
    except (ServiceUnavailableError, OSError):
        # A player with the sibling files is still worth showing, so a failed
        # probe degrades the response rather than the whole request.
        logger.warning("media_tracks_probe_failed", attachment_id=str(attachment_id))
        embedded = []

    for track in embedded:
        entry = MediaTrackRead(
            id=f"embedded:{track.stream_index}",
            kind=track.kind,
            label=track.label,
            language=track.language,
            is_default=track.is_default,
            src=(
                f"/api/v1/attachments/{attachment.id}"
                f"/subtitle-track?stream={track.stream_index}"
                if track.kind == "subtitle"
                else None
            ),
        )
        (subtitles if track.kind == "subtitle" else audio).append(entry)

    return MediaTracksRead(subtitles=subtitles, audio=audio)


@router.get(
    "/{attachment_id}/subtitle-track",
    response_class=Response,
    summary="Read a subtitle track as WebVTT",
)
async def read_subtitle_track(
    attachment_id: uuid.UUID,
    user: CurrentUser,
    session: DbSession,
    storage: StorageDep,
    stream: int | None = None,
) -> Response:
    """Serve one subtitle track in the only format `<track>` accepts.

    With ``stream``, that is a subtitle stream inside this media file. Without
    it, this attachment is itself a subtitle file being converted for the
    player.
    """
    attachment, _ = await _load_attachment_for_view(attachment_id, user, session)

    if stream is None:
        data = await storage.get(attachment.object_key)
        body = subtitle_file_to_vtt(data, attachment.filename)
    else:
        if stream < 0:
            raise BadRequestError("The subtitle track is invalid.")
        source = await storage.presigned_internal_url(attachment.object_key)
        body = await extract_embedded_subtitle(source, stream)

    return Response(
        content=body,
        media_type="text/vtt; charset=utf-8",
        # Tracks are re-fetched every time the player is opened; the file only
        # changes when the attachment itself is replaced.
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.get(
    "/{attachment_id}/office/config",
    response_model=OfficeEditorConfigRead,
    summary="Create an ONLYOFFICE editor configuration for an attachment",
)
async def get_office_editor_config(
    attachment_id: uuid.UUID,
    user: CurrentUser,
    session: DbSession,
) -> OfficeEditorConfigRead:
    """Give an editor a signed, least-privilege configuration.

    The document server cannot use a browser's httpOnly session cookie, so the
    generated configuration carries short-lived signed URLs for its download
    and callback operations. The human caller is still checked as a page
    editor before any of those capabilities are minted.
    """
    require_enabled()
    attachment = await session.get(PageAttachment, attachment_id)
    if attachment is None:
        raise NotFoundError("Attachment not found.")
    page = await session.get(WikiPage, attachment.page_id)
    if page is None:
        raise NotFoundError("Attachment page not found.")
    await PageService(session).require_page_editor(page, user)
    file_extension(attachment.filename)
    return OfficeEditorConfigRead(config=editor_config(attachment=attachment, user=user))


@router.get(
    "/{attachment_id}/office/content",
    response_class=Response,
    summary="Read an attachment for ONLYOFFICE",
)
async def read_attachment_for_office(
    attachment_id: uuid.UUID,
    token: str,
    session: DbSession,
    storage: StorageDep,
) -> Response:
    """Document-server-only content route authenticated by a signed capability."""
    require_enabled()
    verify_ticket(token, attachment_id=attachment_id, purpose="content")
    attachment = await session.get(PageAttachment, attachment_id)
    if attachment is None:
        raise NotFoundError("Attachment not found.")
    file_extension(attachment.filename)
    return Response(
        content=await storage.get(attachment.object_key),
        media_type=attachment.content_type,
        headers={"Content-Disposition": f'attachment; filename="{attachment.filename}"'},
    )


@router.post(
    "/{attachment_id}/office/callback",
    summary="Persist an ONLYOFFICE-edited attachment",
)
async def save_attachment_from_office(
    attachment_id: uuid.UUID,
    token: str,
    request: Request,
    session: DbSession,
    storage: StorageDep,
) -> dict[str, int]:
    """Accept compiled document versions posted by ONLYOFFICE Docs.

    ONLYOFFICE reports a completed file with status 2 (last editor closed) or
    6 (a force save). Any other status is only an editor lifecycle signal, so
    it is acknowledged without replacing storage.
    """
    require_enabled()
    verify_ticket(token, attachment_id=attachment_id, purpose="callback")
    try:
        payload = await request.json()
    except ValueError:
        logger.warning(
            "onlyoffice_callback_rejected",
            attachment_id=str(attachment_id),
            reason="invalid_json",
        )
        return {"error": 1}
    if not isinstance(payload, dict):
        logger.warning(
            "onlyoffice_callback_rejected",
            attachment_id=str(attachment_id),
            reason="invalid_payload",
        )
        return {"error": 1}
    verify_callback_token(payload)

    callback_status = payload.get("status")
    if callback_status not in {2, 6}:
        logger.info(
            "onlyoffice_callback_acknowledged",
            attachment_id=str(attachment_id),
            callback_status=callback_status,
        )
        return {"error": 0}
    raw_download_url = payload.get("url")
    download_url = (
        internal_download_url(raw_download_url) if isinstance(raw_download_url, str) else None
    )
    if download_url is None:
        logger.warning(
            "onlyoffice_callback_rejected",
            attachment_id=str(attachment_id),
            callback_status=callback_status,
            reason="unusable_download_url",
        )
        return {"error": 1}

    attachment = await session.get(PageAttachment, attachment_id)
    if attachment is None:
        logger.warning(
            "onlyoffice_callback_rejected",
            attachment_id=str(attachment_id),
            reason="missing_attachment",
        )
        return {"error": 1}
    file_extension(attachment.filename)

    try:
        # Document Server may redirect its generated cache URL. Every hop is
        # re-pinned to the configured internal Document Server, so a redirect
        # cannot turn this callback into an SSRF primitive.
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
            for _ in range(3):
                response = await client.get(download_url, follow_redirects=False)
                if not response.is_redirect:
                    response.raise_for_status()
                    data = response.content
                    break
                location = response.headers.get("location")
                if not location:
                    logger.warning(
                        "onlyoffice_callback_rejected",
                        attachment_id=str(attachment_id),
                        reason="redirect_without_location",
                    )
                    return {"error": 1}
                redirected = internal_download_url(urljoin(str(response.url), location))
                if redirected is None:
                    logger.warning(
                        "onlyoffice_callback_rejected",
                        attachment_id=str(attachment_id),
                        reason="untrusted_redirect",
                    )
                    return {"error": 1}
                download_url = redirected
            else:
                logger.warning(
                    "onlyoffice_callback_rejected",
                    attachment_id=str(attachment_id),
                    reason="too_many_redirects",
                )
                return {"error": 1}
    except httpx.HTTPError:
        logger.warning(
            "onlyoffice_callback_rejected",
            attachment_id=str(attachment_id),
            reason="document_server_download_failed",
        )
        return {"error": 1}

    if not data:
        logger.warning(
            "onlyoffice_callback_rejected",
            attachment_id=str(attachment_id),
            reason="empty_document",
        )
        return {"error": 1}
    page = await session.get(WikiPage, attachment.page_id)
    effective = limits_for_space(
        await SiteSettingsService(session).get_effective(),
        await session.get(Space, page.space_id) if page else None,
    )
    if len(data) > effective.max_upload_size_bytes:
        logger.warning(
            "onlyoffice_callback_rejected",
            attachment_id=str(attachment_id),
            reason="document_too_large",
        )
        return {"error": 1}

    await storage.put(attachment.object_key, data, content_type=attachment.content_type)
    attachment.size_bytes = len(data)
    attachment.office_revision += 1
    await session.flush()
    logger.info(
        "onlyoffice_document_saved",
        attachment_id=str(attachment_id),
        size_bytes=len(data),
        office_revision=attachment.office_revision,
    )
    return {"error": 0}


@router.put(
    "/{attachment_id}/content",
    response_model=AttachmentMetadataRead,
    summary="Replace a page attachment",
)
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

    effective = limits_for_space(
        await SiteSettingsService(session).get_effective(),
        await session.get(Space, page.space_id),
    )
    data = await file.read(effective.max_upload_size_bytes + 1)
    if not data:
        raise BadRequestError("The attachment is empty.")
    if len(data) > effective.max_upload_size_bytes:
        raise PayloadTooLargeError(
            f"Attachments must be {effective.max_upload_size_mb} MB or smaller."
        )

    await storage.put(attachment.object_key, data, content_type=attachment.content_type)
    attachment.size_bytes = len(data)
    attachment.office_revision += 1
    await session.flush()
    return AttachmentMetadataRead(
        id=attachment.id,
        page_id=attachment.page_id,
        filename=attachment.filename,
        content_type=attachment.content_type,
        size_bytes=attachment.size_bytes,
        created_at=attachment.created_at.isoformat(),
    )
