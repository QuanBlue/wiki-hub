"""Unit coverage for reading a video's subtitle and audio tracks."""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, Mock

import pytest

from app.core.exceptions import NotFoundError, ServiceUnavailableError
from app.modules.attachments import media_tracks
from app.modules.attachments.media_tracks import (
    extract_embedded_subtitle,
    ffmpeg_available,
    parse_probe_output,
    probe_embedded_tracks,
    subtitle_extension,
    subtitle_file_to_vtt,
)


def _probe(*streams: dict) -> str:
    return json.dumps({"streams": list(streams)})


def test_subtitle_and_audio_streams_are_both_listed() -> None:
    tracks = parse_probe_output(
        _probe(
            {"index": 0, "codec_type": "video", "codec_name": "h264"},
            {
                "index": 1,
                "codec_type": "audio",
                "codec_name": "aac",
                "tags": {"language": "eng"},
                "disposition": {"default": 1},
            },
            {
                "index": 2,
                "codec_type": "subtitle",
                "codec_name": "mov_text",
                "tags": {"language": "vie", "title": "Tiếng Việt"},
            },
        )
    )

    assert [(track.kind, track.stream_index) for track in tracks] == [
        ("audio", 1),
        ("subtitle", 2),
    ]
    assert tracks[0].label == "eng"
    assert tracks[0].is_default is True
    assert tracks[1].label == "Tiếng Việt (vie)"
    assert tracks[1].language == "vie"
    assert tracks[1].is_default is False


def test_a_titled_but_unlanguaged_stream_uses_just_the_title() -> None:
    tracks = parse_probe_output(
        _probe(
            {
                "index": 1,
                "codec_type": "subtitle",
                "codec_name": "subrip",
                "tags": {"title": "Director Commentary"},
            }
        )
    )

    assert tracks[0].label == "Director Commentary"


def test_a_stream_with_no_usable_index_is_skipped() -> None:
    # `-map 0:<index>` needs a real integer to select this stream by later -
    # one ffprobe cannot report can never be requested for extraction anyway.
    tracks = parse_probe_output(
        _probe({"index": None, "codec_type": "audio", "codec_name": "aac"})
    )

    assert tracks == []


def test_an_untagged_stream_gets_a_numbered_label() -> None:
    tracks = parse_probe_output(
        _probe(
            {"index": 1, "codec_type": "subtitle", "codec_name": "subrip"},
            {"index": 2, "codec_type": "subtitle", "codec_name": "subrip"},
        )
    )

    assert [track.label for track in tracks] == ["Subtitle 1", "Subtitle 2"]


def test_bitmap_subtitles_are_not_offered() -> None:
    # These are images. Converting them to WebVTT would need OCR, so offering
    # them would only ever produce an empty track.
    tracks = parse_probe_output(
        _probe({"index": 1, "codec_type": "subtitle", "codec_name": "hdmv_pgs_subtitle"})
    )

    assert tracks == []


@pytest.mark.parametrize("payload", ["", "not json", "{}", '{"streams": null}'])
def test_unreadable_probe_output_yields_no_tracks(payload: str) -> None:
    assert parse_probe_output(payload) == []


@pytest.mark.parametrize(
    ("filename", "expected"),
    [("a.srt", "srt"), ("a.SRT", "srt"), ("a.vtt", "vtt"), ("a.mp4", None), ("a", None)],
)
def test_subtitle_extensions_are_recognised(filename: str, expected: str | None) -> None:
    assert subtitle_extension(filename) == expected


def test_subrip_becomes_webvtt() -> None:
    srt = (
        b"1\r\n00:00:01,000 --> 00:00:04,500\r\nXin ch\xc3\xa0o\r\n\r\n"
        b"2\r\n00:00:05,250 --> 00:00:07,000\r\nT\xe1\xba\xa1m bi\xe1\xbb\x87t\r\n"
    )

    vtt = subtitle_file_to_vtt(srt, "phim.srt").decode()

    assert vtt.startswith("WEBVTT\n\n")
    assert "00:00:01.000 --> 00:00:04.500" in vtt
    assert "00:00:05.250 --> 00:00:07.000" in vtt
    assert "," not in vtt.split("Xin")[0].splitlines()[-2]
    assert "Xin chào" in vtt


def test_a_vtt_file_is_passed_through() -> None:
    vtt = b"WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi\n"

    assert subtitle_file_to_vtt(vtt, "phim.vtt") == vtt


def test_a_vtt_file_missing_its_signature_gains_one() -> None:
    # A browser rejects the whole track without it, so serving the file as-is
    # would be serving something unusable.
    converted = subtitle_file_to_vtt(b"00:00:01.000 --> 00:00:02.000\nhi\n", "phim.vtt")

    assert converted.startswith(b"WEBVTT\n\n")


def test_a_utf8_bom_is_not_left_in_the_signature() -> None:
    # Windows subtitle editors write one, and a BOM before "WEBVTT" makes the
    # browser refuse the file.
    converted = subtitle_file_to_vtt(
        b"\xef\xbb\xbf1\n00:00:01,000 --> 00:00:02,000\nhi\n", "phim.srt"
    )

    assert converted.startswith(b"WEBVTT")


def test_a_non_subtitle_attachment_is_refused() -> None:
    with pytest.raises(NotFoundError):
        subtitle_file_to_vtt(b"data", "clip.mp4")


def test_a_windows_1258_subtitle_survives_being_decoded() -> None:
    # "café" encoded as Windows-1258 (Vietnamese/Western-compatible) is not
    # valid UTF-8 - "\xe9" alone is an incomplete continuation byte - so this
    # only round-trips if the cp1258 fallback actually runs.
    raw = "1\n00:00:01,000 --> 00:00:02,000\ncafé\n".encode("cp1258")

    vtt = subtitle_file_to_vtt(raw, "phim.srt").decode()

    assert "café" in vtt


def test_an_undecodable_subtitle_still_returns_something_rather_than_raising() -> None:
    # 0x81 is undefined in cp1258 *and* cp1252 (unlike almost every other
    # byte value, which one of the two single-byte codecs always accepts) -
    # the one input that actually reaches the final utf-8/replace fallback,
    # which is what keeps a bad subtitle a bad subtitle rather than a 500 for
    # the whole page.
    converted = subtitle_file_to_vtt(b"\x81", "phim.srt")

    assert converted.startswith(b"WEBVTT")


def test_ffmpeg_available_reflects_both_binaries(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(media_tracks.shutil, "which", lambda name: f"/usr/bin/{name}")
    assert ffmpeg_available() is True

    monkeypatch.setattr(
        media_tracks.shutil, "which", lambda name: None if name == "ffmpeg" else "/usr/bin/ffprobe"
    )
    assert ffmpeg_available() is False


class _FakeProcess:
    def __init__(self, *, stdout: bytes = b"", stderr: bytes = b"", returncode: int = 0) -> None:
        self._stdout = stdout
        self._stderr = stderr
        self.returncode = returncode
        self.kill = Mock()
        self.wait = AsyncMock()

    async def communicate(self) -> tuple[bytes, bytes]:
        return self._stdout, self._stderr


class TestProbeEmbeddedTracks:
    async def test_no_ffmpeg_installed_yields_no_tracks_without_running_anything(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(media_tracks, "ffmpeg_available", lambda: False)
        run = AsyncMock()
        monkeypatch.setattr(media_tracks, "_run", run)

        assert await probe_embedded_tracks("http://storage/video.mp4") == []
        run.assert_not_called()

    async def test_parses_whatever_the_probe_reports(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(media_tracks, "ffmpeg_available", lambda: True)
        payload = _probe(
            {"index": 1, "codec_type": "audio", "codec_name": "aac", "tags": {"language": "eng"}}
        ).encode()
        create_subprocess = AsyncMock(
            return_value=_FakeProcess(stdout=payload, returncode=0)
        )
        monkeypatch.setattr(asyncio, "create_subprocess_exec", create_subprocess)

        tracks = await probe_embedded_tracks("http://storage/video.mp4")

        assert [t.kind for t in tracks] == ["audio"]
        assert create_subprocess.call_args.args[0] == "ffprobe"

    async def test_a_nonzero_exit_is_reported_as_unavailable(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(media_tracks, "ffmpeg_available", lambda: True)
        create_subprocess = AsyncMock(
            return_value=_FakeProcess(stderr=b"ffprobe: no such file", returncode=1)
        )
        monkeypatch.setattr(asyncio, "create_subprocess_exec", create_subprocess)

        with pytest.raises(ServiceUnavailableError, match="could not be read"):
            await probe_embedded_tracks("http://storage/video.mp4")

    async def test_a_stuck_probe_times_out_rather_than_hanging_the_request(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(media_tracks, "ffmpeg_available", lambda: True)
        process = _FakeProcess()
        create_subprocess = AsyncMock(return_value=process)
        monkeypatch.setattr(asyncio, "create_subprocess_exec", create_subprocess)
        monkeypatch.setattr(
            asyncio, "wait_for", AsyncMock(side_effect=TimeoutError)
        )

        with pytest.raises(ServiceUnavailableError, match="timed out"):
            await probe_embedded_tracks("http://storage/video.mp4")
        process.kill.assert_called_once()
        process.wait.assert_awaited_once()


class TestExtractEmbeddedSubtitle:
    async def test_no_ffmpeg_installed_is_reported_as_unavailable(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(media_tracks, "ffmpeg_available", lambda: False)

        with pytest.raises(ServiceUnavailableError, match="not available"):
            await extract_embedded_subtitle("http://storage/video.mp4", 2)

    async def test_extracts_the_requested_stream_as_webvtt(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(media_tracks, "ffmpeg_available", lambda: True)
        create_subprocess = AsyncMock(
            return_value=_FakeProcess(stdout=b"WEBVTT\n\n...", returncode=0)
        )
        monkeypatch.setattr(asyncio, "create_subprocess_exec", create_subprocess)

        result = await extract_embedded_subtitle("http://storage/video.mp4", 2)

        assert result == b"WEBVTT\n\n..."
        args = create_subprocess.call_args.args
        assert args[0] == "ffmpeg"
        assert "0:2" in args

    async def test_an_oversized_extracted_track_is_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(media_tracks, "ffmpeg_available", lambda: True)
        monkeypatch.setattr(media_tracks, "MAX_SUBTITLE_BYTES", 4)
        create_subprocess = AsyncMock(
            return_value=_FakeProcess(stdout=b"way too big", returncode=0)
        )
        monkeypatch.setattr(asyncio, "create_subprocess_exec", create_subprocess)

        with pytest.raises(ServiceUnavailableError, match="too large"):
            await extract_embedded_subtitle("http://storage/video.mp4", 0)
