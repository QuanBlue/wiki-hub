"""Unit coverage for reading a video's subtitle and audio tracks."""

from __future__ import annotations

import json

import pytest

from app.core.exceptions import NotFoundError
from app.modules.attachments.media_tracks import (
    parse_probe_output,
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
