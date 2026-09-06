"""The ONLYOFFICE integration and `replace_attachment` - the one section of
attachments.py test_api_attachments_full.py / test_api_edges.py never touch.

`save_attachment_from_office` gets the most attention here: it downloads a
document server URL the *client* posted, verified only by an HMAC over the
callback body - which is exactly the shape of an SSRF primitive if any of the
redirect-following or URL-rewriting logic gets it wrong (see
`internal_download_url`'s own docstring).
"""

from __future__ import annotations

import io
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from fastapi import UploadFile

from app.api.v1 import attachments
from app.core.exceptions import (
    AuthenticationError,
    BadRequestError,
    NotFoundError,
    PayloadTooLargeError,
    ServiceUnavailableError,
)
from app.models.attachment import PageAttachment
from app.models.page import WikiPage
from app.models.space import Space
from app.modules.attachments import media_tracks
from app.modules.attachments.onlyoffice import _ticket


def _attachment(**overrides: object) -> PageAttachment:
    defaults: dict[str, object] = {
        "id": uuid.uuid4(),
        "page_id": uuid.uuid4(),
        "filename": "report.docx",
        "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "object_key": "attachments/p/a/report.docx",
        "size_bytes": 100,
        "office_revision": 1,
        "created_at": datetime.now(UTC),
    }
    defaults.update(overrides)
    return PageAttachment(**defaults)


_JWT_SECRET = "x" * 40


def _disable_onlyoffice(monkeypatch: pytest.MonkeyPatch) -> None:
    # This deployment's own .env has WIKIHUB_ONLYOFFICE_ENABLED=true (the
    # compose stack runs a real Document Server) - explicit, not assumed.
    monkeypatch.setattr("app.modules.attachments.onlyoffice.settings.onlyoffice_enabled", False)


def _enable_onlyoffice(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.modules.attachments.onlyoffice.settings.onlyoffice_enabled", True)
    monkeypatch.setattr(
        "app.modules.attachments.onlyoffice.settings.onlyoffice_backend_url",
        "http://onlyoffice.internal:8080",
    )
    monkeypatch.setattr(
        "app.modules.attachments.onlyoffice.settings.onlyoffice_internal_url",
        "http://onlyoffice.internal:8080",
    )
    monkeypatch.setattr(
        "app.modules.attachments.onlyoffice.settings.onlyoffice_jwt_secret", _JWT_SECRET
    )


class TestReplaceAttachment:
    async def test_replaces_the_blob_and_bumps_the_office_revision(self) -> None:
        attachment = _attachment(size_bytes=5, office_revision=3)
        page = Mock(spec=WikiPage)
        space = Mock(spec=Space, max_upload_size_mb=None)
        session = AsyncMock(
            get=AsyncMock(side_effect=[attachment, page, space]), flush=AsyncMock()
        )
        storage = AsyncMock(put=AsyncMock())
        user = Mock()
        settings_service = Mock(
            get_effective=AsyncMock(
                return_value=SimpleNamespace(
                    allowed_attachment_types=["*"],
                    max_upload_size_bytes=1000,
                    max_upload_size_mb=1,
                )
            )
        )
        with _patched_page_editor(user), _patched_settings_service(settings_service):
            file = UploadFile(filename="report.docx", file=io.BytesIO(b"new bytes"))
            result = await attachments.replace_attachment(
                attachment.id, file, user, session, storage
            )

        assert result.size_bytes == len(b"new bytes")
        assert attachment.office_revision == 4
        storage.put.assert_awaited_once_with(
            attachment.object_key, b"new bytes", content_type=attachment.content_type
        )

    async def test_missing_attachment_404s(self) -> None:
        session = AsyncMock(get=AsyncMock(return_value=None))
        file = UploadFile(filename="x.docx", file=io.BytesIO(b"x"))
        with pytest.raises(NotFoundError):
            await attachments.replace_attachment(
                uuid.uuid4(), file, Mock(), session, AsyncMock()
            )

    async def test_missing_page_404s(self) -> None:
        attachment = _attachment()
        session = AsyncMock(get=AsyncMock(side_effect=[attachment, None]))
        file = UploadFile(filename="x.docx", file=io.BytesIO(b"x"))
        with pytest.raises(NotFoundError):
            await attachments.replace_attachment(
                attachment.id, file, Mock(), session, AsyncMock()
            )

    async def test_an_empty_replacement_is_rejected(self) -> None:
        attachment = _attachment()
        page = Mock(spec=WikiPage)
        space = Mock(spec=Space, max_upload_size_mb=None)
        session = AsyncMock(get=AsyncMock(side_effect=[attachment, page, space]))
        settings_service = Mock(
            get_effective=AsyncMock(
                return_value=SimpleNamespace(
                    allowed_attachment_types=["*"], max_upload_size_bytes=1000, max_upload_size_mb=1
                )
            )
        )
        with _patched_page_editor(Mock()), _patched_settings_service(settings_service):
            file = UploadFile(filename="x.docx", file=io.BytesIO(b""))
            with pytest.raises(BadRequestError):
                await attachments.replace_attachment(
                    attachment.id, file, Mock(), session, AsyncMock()
                )

    async def test_an_oversized_replacement_is_rejected(self) -> None:
        attachment = _attachment()
        page = Mock(spec=WikiPage)
        space = Mock(spec=Space, max_upload_size_mb=None)
        session = AsyncMock(get=AsyncMock(side_effect=[attachment, page, space]))
        settings_service = Mock(
            get_effective=AsyncMock(
                return_value=SimpleNamespace(
                    allowed_attachment_types=["*"], max_upload_size_bytes=4, max_upload_size_mb=1
                )
            )
        )
        with _patched_page_editor(Mock()), _patched_settings_service(settings_service):
            file = UploadFile(filename="x.docx", file=io.BytesIO(b"toolong"))
            with pytest.raises(PayloadTooLargeError):
                await attachments.replace_attachment(
                    attachment.id, file, Mock(), session, AsyncMock()
                )


class _patched_page_editor:
    """`replace_attachment`/`get_office_editor_config` both check
    `PageService(session).require_page_editor` - patched to a no-op so these
    tests are about the attachment/onlyoffice logic, not page permissions
    (covered on their own in test_pages_service.py-style suites)."""

    def __init__(self, user: object) -> None:
        self._user = user

    def __enter__(self) -> None:
        self._mp = pytest.MonkeyPatch()
        self._mp.setattr(
            attachments,
            "PageService",
            lambda session: Mock(require_page_editor=AsyncMock()),
        )

    def __exit__(self, *exc: object) -> None:
        self._mp.undo()


class _patched_settings_service:
    def __init__(self, service: object) -> None:
        self._service = service

    def __enter__(self) -> None:
        self._mp = pytest.MonkeyPatch()
        self._mp.setattr(attachments, "SiteSettingsService", lambda session: self._service)

    def __exit__(self, *exc: object) -> None:
        self._mp.undo()


class TestOfficeEditorConfig:
    async def test_disabled_raises_service_unavailable(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _disable_onlyoffice(monkeypatch)
        with pytest.raises(ServiceUnavailableError):
            await attachments.get_office_editor_config(uuid.uuid4(), Mock(), AsyncMock())

    async def test_missing_attachment_404s(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _enable_onlyoffice(monkeypatch)
        session = AsyncMock(get=AsyncMock(return_value=None))
        with pytest.raises(NotFoundError):
            await attachments.get_office_editor_config(uuid.uuid4(), Mock(), session)

    async def test_missing_page_404s(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _enable_onlyoffice(monkeypatch)
        attachment = _attachment()
        session = AsyncMock(get=AsyncMock(side_effect=[attachment, None]))
        with pytest.raises(NotFoundError):
            await attachments.get_office_editor_config(attachment.id, Mock(), session)

    async def test_returns_a_signed_config_for_an_editable_extension(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _enable_onlyoffice(monkeypatch)
        attachment = _attachment()
        page = Mock(spec=WikiPage)
        session = AsyncMock(get=AsyncMock(side_effect=[attachment, page]))
        user = Mock(id=uuid.uuid4(), full_name="Alice", username="alice")

        with _patched_page_editor(user):
            result = await attachments.get_office_editor_config(attachment.id, user, session)

        assert result.config["document"]["fileType"] == "docx"
        assert "token" in result.config


class TestReadAttachmentForOffice:
    async def test_disabled_raises_service_unavailable(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _disable_onlyoffice(monkeypatch)
        with pytest.raises(ServiceUnavailableError):
            await attachments.read_attachment_for_office(
                uuid.uuid4(), "irrelevant-token", AsyncMock(), AsyncMock()
            )

    async def test_an_invalid_ticket_is_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _enable_onlyoffice(monkeypatch)
        with pytest.raises(AuthenticationError):
            await attachments.read_attachment_for_office(
                uuid.uuid4(), "not-a-real-token", AsyncMock(), AsyncMock()
            )

    async def test_a_ticket_for_a_different_attachment_is_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _enable_onlyoffice(monkeypatch)
        attachment = _attachment()
        token = _ticket(attachment, purpose="content")
        with pytest.raises(AuthenticationError):
            await attachments.read_attachment_for_office(
                uuid.uuid4(), token, AsyncMock(), AsyncMock()
            )

    async def test_serves_the_stored_bytes_with_a_download_disposition(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _enable_onlyoffice(monkeypatch)
        attachment = _attachment()
        token = _ticket(attachment, purpose="content")
        session = AsyncMock(get=AsyncMock(return_value=attachment))
        storage = AsyncMock(get=AsyncMock(return_value=b"docx bytes"))

        response = await attachments.read_attachment_for_office(
            attachment.id, token, session, storage
        )

        assert response.body == b"docx bytes"
        assert response.media_type == attachment.content_type

    async def test_missing_attachment_404s(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _enable_onlyoffice(monkeypatch)
        attachment = _attachment()
        token = _ticket(attachment, purpose="content")
        session = AsyncMock(get=AsyncMock(return_value=None))

        with pytest.raises(NotFoundError):
            await attachments.read_attachment_for_office(
                attachment.id, token, session, AsyncMock()
            )


class TestListMediaTracks:
    """Sibling subtitle files (one query) plus whatever ffmpeg finds muxed
    into the file itself (media_tracks.py, tested fully on its own) - this
    is only about how the two get combined into one response."""

    def _mock_load_attachment(
        self, monkeypatch: pytest.MonkeyPatch, attachment: PageAttachment, page: object
    ) -> None:
        monkeypatch.setattr(
            attachments, "_load_attachment_for_view", AsyncMock(return_value=(attachment, page))
        )

    async def test_a_non_media_attachment_gets_no_tracks_without_touching_anything(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        attachment = _attachment(content_type="application/pdf", filename="report.pdf")
        self._mock_load_attachment(monkeypatch, attachment, Mock())
        session = AsyncMock()
        storage = AsyncMock()

        result = await attachments.list_media_tracks(attachment.id, Mock(), session, storage)

        assert result.subtitles == []
        assert result.audio == []
        session.execute.assert_not_called()
        storage.presigned_internal_url.assert_not_called()

    async def test_combines_sibling_subtitle_files_with_embedded_tracks(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        page_id = uuid.uuid4()
        attachment = _attachment(
            content_type="video/mp4", filename="lecture.mp4", page_id=page_id
        )
        self._mock_load_attachment(monkeypatch, attachment, Mock(id=page_id))

        matching_sibling = _attachment(filename="lecture.srt", page_id=page_id)
        unrelated_sibling = _attachment(filename="notes.vtt", page_id=page_id)
        non_subtitle_sibling = _attachment(filename="lecture.png", page_id=page_id)
        session = AsyncMock()
        session.execute = AsyncMock(
            return_value=Mock(
                scalars=Mock(
                    return_value=[matching_sibling, unrelated_sibling, non_subtitle_sibling]
                )
            )
        )
        storage = AsyncMock(presigned_internal_url=AsyncMock(return_value="http://internal/x"))
        embedded_audio = media_tracks.EmbeddedTrack(
            kind="audio", stream_index=1, label="eng", language="eng", is_default=True
        )
        monkeypatch.setattr(
            attachments, "probe_embedded_tracks", AsyncMock(return_value=[embedded_audio])
        )

        result = await attachments.list_media_tracks(attachment.id, Mock(), session, storage)

        # The file named after the video leads; an unrelated subtitle still
        # gets offered, just second.
        assert [s.label for s in result.subtitles] == ["lecture.srt", "notes.vtt"]
        assert result.subtitles[0].src == f"/api/v1/attachments/{matching_sibling.id}/subtitle-track"
        assert len(result.audio) == 1
        assert result.audio[0].id == "embedded:1"

    async def test_a_failed_probe_still_returns_the_sibling_files_it_already_has(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        page_id = uuid.uuid4()
        attachment = _attachment(
            content_type="video/mp4", filename="lecture.mp4", page_id=page_id
        )
        self._mock_load_attachment(monkeypatch, attachment, Mock(id=page_id))
        sibling = _attachment(filename="lecture.vtt", page_id=page_id)
        session = AsyncMock()
        session.execute = AsyncMock(
            return_value=Mock(scalars=Mock(return_value=[sibling]))
        )
        storage = AsyncMock(presigned_internal_url=AsyncMock(return_value="http://internal/x"))
        monkeypatch.setattr(
            attachments,
            "probe_embedded_tracks",
            AsyncMock(side_effect=ServiceUnavailableError("ffprobe unreachable")),
        )

        result = await attachments.list_media_tracks(attachment.id, Mock(), session, storage)

        assert [s.label for s in result.subtitles] == ["lecture.vtt"]
        assert result.audio == []


class TestReadSubtitleTrack:
    def _mock_load_attachment(
        self, monkeypatch: pytest.MonkeyPatch, attachment: PageAttachment
    ) -> None:
        monkeypatch.setattr(
            attachments, "_load_attachment_for_view", AsyncMock(return_value=(attachment, Mock()))
        )

    async def test_converts_the_attachment_itself_when_no_stream_is_given(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        attachment = _attachment(filename="phim.srt")
        self._mock_load_attachment(monkeypatch, attachment)
        storage = AsyncMock(
            get=AsyncMock(return_value=b"1\n00:00:01,000 --> 00:00:02,000\nhi\n")
        )

        response = await attachments.read_subtitle_track(
            attachment.id, Mock(), AsyncMock(), storage
        )

        assert response.media_type == "text/vtt; charset=utf-8"
        assert response.body.startswith(b"WEBVTT")
        storage.get.assert_awaited_once_with(attachment.object_key)

    async def test_extracts_an_embedded_stream_when_one_is_requested(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        attachment = _attachment(filename="lecture.mp4")
        self._mock_load_attachment(monkeypatch, attachment)
        storage = AsyncMock(presigned_internal_url=AsyncMock(return_value="http://internal/x"))
        extract = AsyncMock(return_value=b"WEBVTT\n\n...")
        monkeypatch.setattr(attachments, "extract_embedded_subtitle", extract)

        response = await attachments.read_subtitle_track(
            attachment.id, Mock(), AsyncMock(), storage, stream=2
        )

        assert response.body == b"WEBVTT\n\n..."
        extract.assert_awaited_once_with("http://internal/x", 2)

    async def test_a_negative_stream_index_is_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        attachment = _attachment(filename="lecture.mp4")
        self._mock_load_attachment(monkeypatch, attachment)

        with pytest.raises(BadRequestError):
            await attachments.read_subtitle_track(
                attachment.id, Mock(), AsyncMock(), AsyncMock(), stream=-1
            )


def _fake_httpx_client(responses: list[httpx.Response]) -> Mock:
    """A stand-in for `async with httpx.AsyncClient(...) as client`, returning
    each response in order on successive `client.get(...)` calls."""
    client = AsyncMock()
    client.get = AsyncMock(side_effect=responses)
    context = AsyncMock()
    context.__aenter__.return_value = client
    context.__aexit__.return_value = False
    factory = Mock(return_value=context)
    return factory


def _response(status_code: int, *, content: bytes = b"", location: str | None = None) -> httpx.Response:
    headers = {"location": location} if location else {}
    return httpx.Response(
        status_code,
        content=content,
        headers=headers,
        request=httpx.Request("GET", "http://document-server.example/cache/x"),
    )


class TestSaveAttachmentFromOffice:
    async def _callback(
        self,
        *,
        attachment: PageAttachment,
        payload: dict[str, object],
        session,
        storage=None,
        monkeypatch: pytest.MonkeyPatch,
    ):
        _enable_onlyoffice(monkeypatch)
        token = _ticket(attachment, purpose="callback")
        request = Mock(json=AsyncMock(return_value=payload))
        return await attachments.save_attachment_from_office(
            attachment.id, token, request, session, storage or AsyncMock()
        )

    async def test_disabled_raises_service_unavailable(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _disable_onlyoffice(monkeypatch)
        with pytest.raises(ServiceUnavailableError):
            await attachments.save_attachment_from_office(
                uuid.uuid4(), "irrelevant", Mock(), AsyncMock(), AsyncMock()
            )

    async def test_an_invalid_ticket_is_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _enable_onlyoffice(monkeypatch)
        with pytest.raises(AuthenticationError):
            await attachments.save_attachment_from_office(
                uuid.uuid4(), "not-a-real-token", Mock(), AsyncMock(), AsyncMock()
            )

    async def test_a_body_that_is_not_json_is_acknowledged_as_an_error_not_raised(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        attachment = _attachment()
        _enable_onlyoffice(monkeypatch)
        token = _ticket(attachment, purpose="callback")
        request = Mock(json=AsyncMock(side_effect=ValueError("not json")))
        result = await attachments.save_attachment_from_office(
            attachment.id, token, request, AsyncMock(), AsyncMock()
        )
        assert result == {"error": 1}

    async def test_a_non_object_body_is_acknowledged_as_an_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        attachment = _attachment()
        result = await self._callback(
            attachment=attachment, payload=[], session=AsyncMock(), monkeypatch=monkeypatch
        )
        assert result == {"error": 1}

    async def test_a_callback_body_without_a_valid_signature_is_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        attachment = _attachment()
        with pytest.raises(AuthenticationError):
            await self._callback(
                attachment=attachment,
                payload={"status": 2, "key": "x"},  # no "token" field at all
                session=AsyncMock(),
                monkeypatch=monkeypatch,
            )

    async def test_a_lifecycle_only_status_is_acknowledged_without_touching_storage(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Status 1 ("editing in progress") - not 2 or 6 - carries no document
        # to save; only 2 (closed) and 6 (force-save) do.
        attachment = _attachment()
        _enable_onlyoffice(monkeypatch)
        signed = {"key": "k", "status": 1, "url": None}
        payload = {**signed, "token": _jwt_for(signed)}
        storage = AsyncMock()
        result = await self._callback(
            attachment=attachment, payload=payload, session=AsyncMock(), storage=storage,
            monkeypatch=monkeypatch,
        )
        assert result == {"error": 0}
        storage.put.assert_not_called()

    async def test_a_completed_status_with_no_usable_url_is_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        attachment = _attachment()
        _enable_onlyoffice(monkeypatch)
        signed = {"key": "k", "status": 2, "url": "not a url"}
        payload = {**signed, "token": _jwt_for(signed)}
        result = await self._callback(
            attachment=attachment, payload=payload, session=AsyncMock(), monkeypatch=monkeypatch
        )
        assert result == {"error": 1}

    async def test_a_completed_status_for_a_deleted_attachment_is_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        attachment = _attachment()
        _enable_onlyoffice(monkeypatch)
        url = "http://document-server.example/cache/report.docx"
        signed = {"key": "k", "status": 2, "url": url}
        payload = {**signed, "token": _jwt_for(signed)}
        session = AsyncMock(get=AsyncMock(return_value=None))
        result = await self._callback(
            attachment=attachment, payload=payload, session=session, monkeypatch=monkeypatch
        )
        assert result == {"error": 1}

    async def test_downloads_and_stores_the_completed_document(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        attachment = _attachment(size_bytes=3, office_revision=1)
        _enable_onlyoffice(monkeypatch)
        url = "http://document-server.example/cache/report.docx"
        signed = {"key": "k", "status": 2, "url": url}
        payload = {**signed, "token": _jwt_for(signed)}
        page = Mock(spec=WikiPage, space_id=uuid.uuid4())
        space = Mock(spec=Space, max_upload_size_mb=None)
        session = AsyncMock(get=AsyncMock(side_effect=[attachment, page, space]))
        storage = AsyncMock(put=AsyncMock())
        settings_service = Mock(
            get_effective=AsyncMock(
                return_value=SimpleNamespace(
                    allowed_attachment_types=["*"], max_upload_size_bytes=1000, max_upload_size_mb=1
                )
            )
        )
        client_factory = _fake_httpx_client([_response(200, content=b"final doc")])
        with _patched_settings_service(settings_service):
            monkeypatch.setattr(attachments.httpx, "AsyncClient", client_factory)
            result = await self._callback(
                attachment=attachment, payload=payload, session=session, storage=storage,
                monkeypatch=monkeypatch,
            )

        assert result == {"error": 0}
        storage.put.assert_awaited_once_with(
            attachment.object_key, b"final doc", content_type=attachment.content_type
        )
        assert attachment.size_bytes == len(b"final doc")
        assert attachment.office_revision == 2

    async def test_follows_a_trusted_redirect_to_the_final_document(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        attachment = _attachment()
        _enable_onlyoffice(monkeypatch)
        url = "http://document-server.example/cache/report.docx"
        signed = {"key": "k", "status": 6, "url": url}
        payload = {**signed, "token": _jwt_for(signed)}
        page = Mock(spec=WikiPage, space_id=uuid.uuid4())
        space = Mock(spec=Space, max_upload_size_mb=None)
        session = AsyncMock(get=AsyncMock(side_effect=[attachment, page, space]))
        storage = AsyncMock(put=AsyncMock())
        settings_service = Mock(
            get_effective=AsyncMock(
                return_value=SimpleNamespace(
                    allowed_attachment_types=["*"], max_upload_size_bytes=1000, max_upload_size_mb=1
                )
            )
        )
        client_factory = _fake_httpx_client(
            [
                _response(
                    302, location="http://onlyoffice.internal:8080/cache/redirected.docx"
                ),
                _response(200, content=b"redirected doc"),
            ]
        )
        with _patched_settings_service(settings_service):
            monkeypatch.setattr(attachments.httpx, "AsyncClient", client_factory)
            result = await self._callback(
                attachment=attachment, payload=payload, session=session, storage=storage,
                monkeypatch=monkeypatch,
            )

        assert result == {"error": 0}
        storage.put.assert_awaited_once_with(
            attachment.object_key, b"redirected doc", content_type=attachment.content_type
        )

    async def test_a_redirect_with_no_location_header_is_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        attachment = _attachment()
        _enable_onlyoffice(monkeypatch)
        url = "http://document-server.example/cache/report.docx"
        signed = {"key": "k", "status": 2, "url": url}
        payload = {**signed, "token": _jwt_for(signed)}
        session = AsyncMock(get=AsyncMock(return_value=attachment))
        client_factory = _fake_httpx_client([_response(302)])
        monkeypatch.setattr(attachments.httpx, "AsyncClient", client_factory)
        result = await self._callback(
            attachment=attachment, payload=payload, session=session, monkeypatch=monkeypatch
        )
        assert result == {"error": 1}

    async def test_a_redirect_to_an_unparseable_location_is_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # internal_download_url() *always* rewrites the authority to the
        # configured internal Document Server, regardless of what host the
        # redirect named - that is its whole point, so a redirect to some
        # other Document Server cache hostname is still followed. What it
        # actually refuses is a location it cannot even parse a path out of.
        attachment = _attachment()
        _enable_onlyoffice(monkeypatch)
        url = "http://document-server.example/cache/report.docx"
        signed = {"key": "k", "status": 2, "url": url}
        payload = {**signed, "token": _jwt_for(signed)}
        session = AsyncMock(get=AsyncMock(return_value=attachment))
        client_factory = _fake_httpx_client(
            # A bare authority with no path at all - urljoin() only leaves a
            # location alone unmodified when it is already fully absolute
            # (scheme *and* host), so this is what actually still reaches
            # internal_download_url() without a path to reject it on.
            [_response(302, location="http://onlyoffice.internal:8080")]
        )
        monkeypatch.setattr(attachments.httpx, "AsyncClient", client_factory)
        result = await self._callback(
            attachment=attachment, payload=payload, session=session, monkeypatch=monkeypatch
        )
        assert result == {"error": 1}

    async def test_too_many_redirects_is_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        attachment = _attachment()
        _enable_onlyoffice(monkeypatch)
        url = "http://document-server.example/cache/report.docx"
        signed = {"key": "k", "status": 2, "url": url}
        payload = {**signed, "token": _jwt_for(signed)}
        session = AsyncMock(get=AsyncMock(return_value=attachment))
        redirect = _response(
            302, location="http://onlyoffice.internal:8080/cache/again.docx"
        )
        client_factory = _fake_httpx_client([redirect, redirect, redirect])
        monkeypatch.setattr(attachments.httpx, "AsyncClient", client_factory)
        result = await self._callback(
            attachment=attachment, payload=payload, session=session, monkeypatch=monkeypatch
        )
        assert result == {"error": 1}

    async def test_a_download_transport_failure_is_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        attachment = _attachment()
        _enable_onlyoffice(monkeypatch)
        url = "http://document-server.example/cache/report.docx"
        signed = {"key": "k", "status": 2, "url": url}
        payload = {**signed, "token": _jwt_for(signed)}
        session = AsyncMock(get=AsyncMock(return_value=attachment))
        client = AsyncMock()
        client.get = AsyncMock(side_effect=httpx.ConnectError("unreachable"))
        context = AsyncMock()
        context.__aenter__.return_value = client
        context.__aexit__.return_value = False
        monkeypatch.setattr(attachments.httpx, "AsyncClient", Mock(return_value=context))
        result = await self._callback(
            attachment=attachment, payload=payload, session=session, monkeypatch=monkeypatch
        )
        assert result == {"error": 1}

    async def test_an_empty_downloaded_document_is_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        attachment = _attachment()
        _enable_onlyoffice(monkeypatch)
        url = "http://document-server.example/cache/report.docx"
        signed = {"key": "k", "status": 2, "url": url}
        payload = {**signed, "token": _jwt_for(signed)}
        session = AsyncMock(get=AsyncMock(return_value=attachment))
        client_factory = _fake_httpx_client([_response(200, content=b"")])
        monkeypatch.setattr(attachments.httpx, "AsyncClient", client_factory)
        result = await self._callback(
            attachment=attachment, payload=payload, session=session, monkeypatch=monkeypatch
        )
        assert result == {"error": 1}

    async def test_a_downloaded_document_over_the_size_limit_is_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        attachment = _attachment()
        _enable_onlyoffice(monkeypatch)
        url = "http://document-server.example/cache/report.docx"
        signed = {"key": "k", "status": 2, "url": url}
        payload = {**signed, "token": _jwt_for(signed)}
        page = Mock(spec=WikiPage, space_id=uuid.uuid4())
        space = Mock(spec=Space, max_upload_size_mb=None)
        session = AsyncMock(get=AsyncMock(side_effect=[attachment, page, space]))
        settings_service = Mock(
            get_effective=AsyncMock(
                return_value=SimpleNamespace(
                    allowed_attachment_types=["*"], max_upload_size_bytes=4, max_upload_size_mb=1
                )
            )
        )
        client_factory = _fake_httpx_client([_response(200, content=b"way too big")])
        with _patched_settings_service(settings_service):
            monkeypatch.setattr(attachments.httpx, "AsyncClient", client_factory)
            result = await self._callback(
                attachment=attachment, payload=payload, session=session, monkeypatch=monkeypatch
            )
        assert result == {"error": 1}


def _jwt_for(payload: dict[str, object]) -> str:
    """A callback token signed the same way ONLYOFFICE signs one - see
    `editor_config`'s own `config["token"] = jwt.encode(config, ...)`.

    Signed with the same fixed secret `_enable_onlyoffice` patches in,
    independent of call order between the two (this is typically called
    before `_enable_onlyoffice` runs, to build the payload the callback
    itself receives)."""
    import jwt as pyjwt

    return pyjwt.encode(payload, _JWT_SECRET, algorithm="HS256")
