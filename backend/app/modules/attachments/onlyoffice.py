"""Signed ONLYOFFICE configuration and short-lived attachment capabilities."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from urllib.parse import urlencode, urlsplit, urlunsplit

import jwt

from app.core.config import settings
from app.core.exceptions import AuthenticationError, ServiceUnavailableError
from app.models.attachment import PageAttachment
from app.models.user import User

_TICKET_TYPE = "onlyoffice_attachment"
_VALID_EXTENSIONS = {"docx", "xlsx", "pptx"}
_DOCUMENT_TYPES = {"docx": "word", "xlsx": "cell", "pptx": "slide"}

#: Read-only preview, keyed by an arbitrary storage object rather than a
#: `PageAttachment` row - the admin Object Storage browser can list
#: avatars, import archives and other objects with nothing in the database
#: to check an editor permission against, so this path never offers editing
#: and never registers a callback to save anything back.
_PREVIEW_TICKET_TYPE = "onlyoffice_storage_preview"  # noqa: S105 - a JWT claim value, not a credential
#: `csv` is deliberately absent - the existing plain-text preview already
#: handles it, and routing it through ONLYOFFICE instead here without also
#: changing the frontend's classification would leave the two disagreeing
#: about what kind of preview a `.csv` gets.
_PREVIEW_DOCUMENT_TYPES = {
    "docx": "word", "doc": "word", "odt": "word", "rtf": "word",
    "xlsx": "cell", "xls": "cell", "ods": "cell",
    "pptx": "slide", "ppt": "slide", "odp": "slide",
    "pdf": "pdf",
}


def is_enabled() -> bool:
    return settings.onlyoffice_enabled


def require_enabled() -> None:
    if not settings.onlyoffice_enabled:
        raise ServiceUnavailableError("The workspace document editor is not configured.")


def file_extension(filename: str) -> str:
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in _VALID_EXTENSIONS:
        raise ServiceUnavailableError(
            "This attachment type cannot be edited in the document editor."
        )
    return extension


def _ticket(
    attachment: PageAttachment,
    *,
    purpose: Literal["content", "callback"],
) -> str:
    now = datetime.now(UTC)
    payload = {
        "typ": _TICKET_TYPE,
        "aid": str(attachment.id),
        "purpose": purpose,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=settings.onlyoffice_token_ttl_seconds)).timestamp()),
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def verify_ticket(
    token: str,
    *,
    attachment_id: uuid.UUID,
    purpose: Literal["content", "callback"],
) -> None:
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "aid", "purpose", "jti"]},
        )
    except jwt.InvalidTokenError as exc:
        raise AuthenticationError("The document editor link is invalid or has expired.") from exc
    if (
        payload.get("typ") != _TICKET_TYPE
        or payload.get("purpose") != purpose
        or str(payload.get("aid")) != str(attachment_id)
    ):
        raise AuthenticationError("The document editor link is invalid.")


def document_key(attachment: PageAttachment) -> str:
    # ONLYOFFICE limits keys to 128 characters. UUID hex plus the monotonically
    # increasing revision is compact, deterministic and cache-safe. The v2
    # namespace also keeps new sessions away from stale server-backup copies
    # produced by the initial callback integration.
    return f"wkh_v2_{attachment.id.hex}_{attachment.office_revision}"


def editor_config(*, attachment: PageAttachment, user: User) -> dict[str, Any]:
    require_enabled()
    extension = file_extension(attachment.filename)
    base_url = settings.onlyoffice_backend_url
    content_query = urlencode({"token": _ticket(attachment, purpose="content")})
    callback_query = urlencode({"token": _ticket(attachment, purpose="callback")})
    content_url = f"{base_url}/api/v1/attachments/{attachment.id}/office/content?{content_query}"
    callback_url = (
        f"{base_url}/api/v1/attachments/{attachment.id}/office/callback?{callback_query}"
    )
    config: dict[str, Any] = {
        "documentType": _DOCUMENT_TYPES[extension],
        "type": "desktop",
        "width": "100%",
        "height": "100%",
        "document": {
            "fileType": extension,
            "key": document_key(attachment),
            "title": attachment.filename,
            "url": content_url,
            "permissions": {
                "edit": True,
                "download": True,
                "print": True,
                "comment": True,
                "review": True,
                "fillForms": True,
            },
        },
        "editorConfig": {
            "mode": "edit",
            # Keep the editor chrome consistent with WikiHub's English UI.
            # This affects OnlyOffice controls only, never the document text.
            "lang": "en",
            "callbackUrl": callback_url,
            "user": {"id": str(user.id), "name": user.full_name or user.username},
            "customization": {
                "autosave": True,
                "forcesave": True,
                "compactToolbar": False,
                "toolbarNoTabs": False,
                "feedback": {"visible": False},
            },
        },
    }
    # ONLYOFFICE validates this token before it accepts the document URLs or
    # callback address. It deliberately contains the entire config payload.
    config["token"] = jwt.encode(config, settings.onlyoffice_jwt_secret, algorithm="HS256")
    return config


def verify_callback_token(payload: dict[str, Any]) -> None:
    token = payload.get("token")
    if not isinstance(token, str) or not token:
        raise AuthenticationError("The document editor callback is missing its signature.")
    try:
        signed = jwt.decode(token, settings.onlyoffice_jwt_secret, algorithms=["HS256"])
    except jwt.InvalidTokenError as exc:
        raise AuthenticationError("The document editor callback signature is invalid.") from exc
    # Outgoing callbacks are signed over the callback body (rather than over
    # the initialization config). Check every value that can select a document
    # or make the backend download a URL; otherwise a browser that knows its
    # callback URL could turn this into an SSRF primitive.
    for field in ("key", "status", "url"):
        if field in payload and signed.get(field) != payload.get(field):
            raise AuthenticationError("The document editor callback does not match this document.")
    if signed.get("key") != payload.get("key"):
        raise AuthenticationError("The document editor callback does not match this document.")


def internal_download_url(url: str) -> str | None:
    """Rewrite a Document Server download link onto its internal address.

    The Document Server builds cache links from the address the *browser* uses
    to reach it (``http://localhost:8080/cache/...``), which the backend cannot
    resolve and must not trust. The callback body is JWT-signed by the Document
    Server, so the path it names is authentic; only the authority is wrong.
    Keeping just the path and query and pinning scheme, host and port to
    ``onlyoffice_internal_url`` makes the download reachable while making it
    impossible for a callback to point the backend at any other host.
    """
    received = urlsplit(url)
    if received.scheme not in {"http", "https"} or not received.hostname or not received.path:
        return None
    internal = urlsplit(settings.onlyoffice_internal_url)
    if not internal.scheme or not internal.netloc:
        return None
    return urlunsplit((internal.scheme, internal.netloc, received.path, received.query, ""))


def preview_extension(filename: str) -> str | None:
    """The file's extension if the read-only previewer supports it, else `None`."""
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return extension if extension in _PREVIEW_DOCUMENT_TYPES else None


def _preview_ticket(key: str) -> str:
    now = datetime.now(UTC)
    payload = {
        "typ": _PREVIEW_TICKET_TYPE,
        "key": key,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=settings.onlyoffice_token_ttl_seconds)).timestamp()),
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def verify_preview_ticket(token: str, *, key: str) -> None:
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "key", "jti"]},
        )
    except jwt.InvalidTokenError as exc:
        raise AuthenticationError("The preview link is invalid or has expired.") from exc
    if payload.get("typ") != _PREVIEW_TICKET_TYPE or payload.get("key") != key:
        raise AuthenticationError("The preview link is invalid.")


def preview_editor_config(*, key: str, filename: str, user: User) -> dict[str, Any]:
    """A view-only ONLYOFFICE configuration for an arbitrary storage object.

    Deliberately narrower than `editor_config`: no `callbackUrl` (there is
    nowhere for an edit to be saved back to - the object may not even be a
    tracked attachment), `edit`/`comment`/`review`/`fillForms` all false, and
    `editorConfig.mode` is "view" rather than "edit". This is what keeps the
    admin Object Storage browser's preview read-only without duplicating
    ONLYOFFICE's own permission plumbing.
    """
    require_enabled()
    extension = preview_extension(filename)
    if extension is None:
        raise ServiceUnavailableError("This file type cannot be previewed in the document viewer.")
    base_url = settings.onlyoffice_backend_url
    content_query = urlencode({"key": key, "token": _preview_ticket(key)})
    content_url = f"{base_url}/api/v1/storage/office-preview/content?{content_query}"
    config: dict[str, Any] = {
        "documentType": _PREVIEW_DOCUMENT_TYPES[extension],
        # Not "desktop": this Document Server build (9.4.0.1) has no
        # `apps/<editor>/main/index_loader.html` on disk - only `embed/` and
        # `mobile/` variants do - and DocsAPI's "desktop" bootstrap requests
        # that missing loader page under this hosting context, 404s, and
        # then simply never proceeds (no `onError`, no editor, stuck on
        # whatever loading state the caller shows forever). "embedded" routes
        # to `apps/<editor>/embed/index.html`, which exists and is also the
        # more honest fit for a view-only preview than the full desktop
        # editor chrome would be.
        "type": "embedded",
        "width": "100%",
        "height": "100%",
        "document": {
            "fileType": extension,
            # A fresh, random key every time rather than one derived from
            # `key`: ONLYOFFICE caches a document server-side by this value,
            # and an object key can be overwritten with different bytes
            # (an avatar replaced, say) without this preview ever being told.
            # Always-fresh trades away that caching for never showing stale
            # content in what is a low-traffic admin tool.
            "key": f"preview_{uuid.uuid4().hex}",
            "title": filename,
            "url": content_url,
            "permissions": {
                "edit": False,
                "download": True,
                "print": True,
                "comment": False,
                "review": False,
                "fillForms": False,
            },
        },
        "editorConfig": {
            "mode": "view",
            "lang": "en",
            "user": {"id": str(user.id), "name": user.full_name or user.username},
            "customization": {
                "forcesave": False,
                "feedback": {"visible": False},
            },
        },
    }
    config["token"] = jwt.encode(config, settings.onlyoffice_jwt_secret, algorithm="HS256")
    return config
