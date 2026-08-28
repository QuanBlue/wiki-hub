"""Unit coverage for recovering a playable media type from a filename."""

from __future__ import annotations

import pytest

from app.modules.attachments.media_types import playable_media_type


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("clip.mp4", "video/mp4"),
        ("song.mp3", "audio/mpeg"),
        ("diagram.png", "image/png"),
        ("photo.JPG", "image/jpeg"),
    ],
)
def test_a_generic_blob_is_retyped_from_its_extension(
    filename: str, expected: str
) -> None:
    assert playable_media_type("application/octet-stream", filename) == expected


@pytest.mark.parametrize(
    "filename",
    [
        # Nothing here may become renderable markup or a script.
        "payload.html",
        "payload.svg",
        "payload.js",
        "payload.pdf",
        "notes.txt",
        "archive.zip",
        "noextension",
    ],
)
def test_only_image_audio_and_video_types_are_recovered(filename: str) -> None:
    assert playable_media_type("application/octet-stream", filename) == (
        "application/octet-stream"
    )


def test_a_stored_type_is_never_overridden() -> None:
    assert playable_media_type("text/plain", "clip.mp4") == "text/plain"
    assert playable_media_type("video/mp4", "clip.mp4") == "video/mp4"


def test_a_missing_type_falls_back_to_a_generic_blob() -> None:
    assert playable_media_type("", "notes.unknownext") == "application/octet-stream"
    assert playable_media_type("", "clip.mp4") == "video/mp4"
