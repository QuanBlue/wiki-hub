"""Endpoint coverage for the video preview's track list."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.api.v1 import attachments
from app.modules.attachments.media_tracks import EmbeddedTrack

VIDEO_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
PAGE_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")


def _user() -> SimpleNamespace:
    return SimpleNamespace(id=uuid.uuid4(), username="alice")


def _video(filename: str = "lesson.mp4") -> SimpleNamespace:
    return SimpleNamespace(
        id=VIDEO_ID,
        page_id=PAGE_ID,
        filename=filename,
        content_type="video/mp4",
        object_key="k",
        size_bytes=1000,
    )


def _sibling(filename: str) -> SimpleNamespace:
    return SimpleNamespace(id=uuid.uuid4(), page_id=PAGE_ID, filename=filename)


def _session(attachment: SimpleNamespace, siblings: list[SimpleNamespace]) -> Mock:
    page = SimpleNamespace(id=PAGE_ID, space_id=uuid.uuid4())
    session = Mock()
    session.get = AsyncMock(side_effect=[attachment, page, SimpleNamespace()])
    session.execute = AsyncMock(
        return_value=SimpleNamespace(scalars=lambda: iter(siblings))
    )
    return session


@pytest.fixture(autouse=True)
def _permissive_services(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        attachments,
        "SpaceService",
        lambda _session: SimpleNamespace(permissions=SimpleNamespace(require=AsyncMock())),
    )
    monkeypatch.setattr(
        attachments,
        "PageService",
        lambda _session: SimpleNamespace(require_page_view=AsyncMock()),
    )


@pytest.mark.asyncio
async def test_sibling_subtitles_and_embedded_streams_are_both_offered(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    other = _sibling("notes.txt")
    unrelated = _sibling("intro.srt")
    matching = _sibling("lesson.vi.srt")
    storage = Mock(presigned_internal_url=AsyncMock(return_value="http://minio/k"))
    monkeypatch.setattr(
        attachments,
        "probe_embedded_tracks",
        AsyncMock(
            return_value=[
                EmbeddedTrack(
                    kind="audio", stream_index=1, label="eng", language="eng", is_default=True
                ),
                EmbeddedTrack(
                    kind="subtitle", stream_index=3, label="vie", language="vie", is_default=False
                ),
            ]
        ),
    )

    result = await attachments.list_media_tracks(
        VIDEO_ID, _user(), _session(_video(), [other, unrelated, matching]), storage
    )

    # The file named after the video leads, then the other subtitle file, then
    # whatever is muxed into the video itself. `notes.txt` is not a subtitle.
    assert [track.label for track in result.subtitles] == [
        "lesson.vi.srt",
        "intro.srt",
        "vie",
    ]
    assert result.subtitles[0].src.endswith(f"/attachments/{matching.id}/subtitle-track")
    assert result.subtitles[2].src.endswith(f"/attachments/{VIDEO_ID}/subtitle-track?stream=3")
    assert [track.label for track in result.audio] == ["eng"]
    # An audio track has no WebVTT to fetch.
    assert result.audio[0].src is None


@pytest.mark.asyncio
async def test_a_failed_probe_still_returns_the_sibling_files(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ffmpeg missing or a probe timing out must not cost the player its files."""
    monkeypatch.setattr(
        attachments,
        "probe_embedded_tracks",
        AsyncMock(side_effect=attachments.ServiceUnavailableError("nope")),
    )
    storage = Mock(presigned_internal_url=AsyncMock(return_value="http://minio/k"))

    result = await attachments.list_media_tracks(
        VIDEO_ID, _user(), _session(_video(), [_sibling("lesson.srt")]), storage
    )

    assert [track.label for track in result.subtitles] == ["lesson.srt"]
    assert result.audio == []


@pytest.mark.asyncio
async def test_a_non_media_attachment_is_never_probed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    probe = AsyncMock(return_value=[])
    monkeypatch.setattr(attachments, "probe_embedded_tracks", probe)
    document = _video("handbook.pdf")
    document.content_type = "application/pdf"

    result = await attachments.list_media_tracks(
        VIDEO_ID, _user(), _session(document, [_sibling("lesson.srt")]), Mock()
    )

    assert result.subtitles == [] and result.audio == []
    probe.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_subtitle_attachment_is_served_as_webvtt() -> None:
    subtitle = _sibling("lesson.srt")
    subtitle.content_type = "application/x-subrip"
    subtitle.object_key = "k"
    storage = Mock(get=AsyncMock(return_value=b"1\n00:00:01,000 --> 00:00:02,000\nhi\n"))

    response = await attachments.read_subtitle_track(
        subtitle.id, _user(), _session(subtitle, []), storage
    )

    assert response.media_type == "text/vtt; charset=utf-8"
    assert response.body.startswith(b"WEBVTT")
    assert b"00:00:01.000 --> 00:00:02.000" in response.body


@pytest.mark.asyncio
async def test_an_embedded_stream_is_extracted_on_demand(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    extract = AsyncMock(return_value=b"WEBVTT\n\n")
    monkeypatch.setattr(attachments, "extract_embedded_subtitle", extract)
    storage = Mock(presigned_internal_url=AsyncMock(return_value="http://minio/k"))

    response = await attachments.read_subtitle_track(
        VIDEO_ID, _user(), _session(_video(), []), storage, stream=3
    )

    assert response.status_code == 200
    extract.assert_awaited_once_with("http://minio/k", 3)


@pytest.mark.asyncio
async def test_a_negative_stream_index_is_refused() -> None:
    with pytest.raises(attachments.BadRequestError):
        await attachments.read_subtitle_track(
            VIDEO_ID, _user(), _session(_video(), []), Mock(), stream=-1
        )
