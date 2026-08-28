"""Subtitle and audio tracks for a video attachment.

A browser plays a video's default audio and shows nothing else: it does not
decode the subtitle streams muxed into an MP4 or MKV, and `<track>` accepts
WebVTT only. So the tracks come from two places, and both end up as WebVTT:

* streams inside the file, listed with ``ffprobe`` and converted on demand
  with ``ffmpeg``;
* subtitle files uploaded alongside the video, converted here in Python so
  they keep working on a deployment without ffmpeg installed.
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
from dataclasses import dataclass
from typing import Literal

from app.core.exceptions import NotFoundError, ServiceUnavailableError
from app.core.logging import get_logger

logger = get_logger(__name__)

#: Long enough for ffmpeg to range-read a large file's headers over HTTP,
#: short enough that a stuck probe cannot pin a request open.
PROBE_TIMEOUT_SECONDS = 30.0
EXTRACT_TIMEOUT_SECONDS = 120.0
#: A subtitle stream is text. Anything this big is not one, and is not going to
#: be handed to a browser.
MAX_SUBTITLE_BYTES = 8 * 1024 * 1024

SUBTITLE_EXTENSIONS = {"vtt", "srt"}
#: Image-based subtitles (DVD/Blu-ray bitmaps) cannot become WebVTT at all.
_UNCONVERTIBLE_SUBTITLE_CODECS = {"dvd_subtitle", "dvb_subtitle", "hdmv_pgs_subtitle", "xsub"}

TrackKind = Literal["subtitle", "audio"]


@dataclass(frozen=True, slots=True)
class EmbeddedTrack:
    """One subtitle or audio stream inside a media file."""

    kind: TrackKind
    #: Index within the container, as ffmpeg's ``-map 0:<index>`` expects it.
    stream_index: int
    label: str
    language: str | None
    is_default: bool


def ffmpeg_available() -> bool:
    return shutil.which("ffprobe") is not None and shutil.which("ffmpeg") is not None


def subtitle_extension(filename: str) -> str | None:
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return extension if extension in SUBTITLE_EXTENSIONS else None


async def _run(
    command: list[str], *, timeout_seconds: float, limit: int | None = None
) -> bytes:
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout_seconds)
    except TimeoutError:
        process.kill()
        await process.wait()
        raise ServiceUnavailableError("Reading the media file's tracks timed out.") from None
    if process.returncode != 0:
        logger.warning(
            "media_track_command_failed",
            command=command[0],
            returncode=process.returncode,
            stderr=stderr.decode("utf-8", "replace")[-500:],
        )
        raise ServiceUnavailableError("The media file's tracks could not be read.")
    if limit is not None and len(stdout) > limit:
        raise ServiceUnavailableError("The subtitle track is too large to display.")
    return stdout


def _track_label(stream: dict, kind: TrackKind, position: int) -> str:
    tags = stream.get("tags") or {}
    title = str(tags.get("title") or "").strip()
    language = str(tags.get("language") or "").strip()
    if title and language:
        return f"{title} ({language})"
    if title:
        return title
    if language:
        return language
    return f"{'Subtitle' if kind == 'subtitle' else 'Audio'} {position}"


def parse_probe_output(payload: str) -> list[EmbeddedTrack]:
    """Turn ``ffprobe -show_streams`` JSON into the tracks worth offering."""
    try:
        streams = json.loads(payload).get("streams") or []
    except (ValueError, AttributeError):
        logger.warning("media_probe_unreadable")
        return []

    tracks: list[EmbeddedTrack] = []
    counts: dict[TrackKind, int] = {"subtitle": 0, "audio": 0}
    for stream in streams:
        codec_type = stream.get("codec_type")
        if codec_type not in ("subtitle", "audio"):
            continue
        kind: TrackKind = codec_type
        if kind == "subtitle" and stream.get("codec_name") in _UNCONVERTIBLE_SUBTITLE_CODECS:
            # A bitmap subtitle would need OCR to become text; offering it
            # would only produce an empty track.
            continue
        counts[kind] += 1
        index = stream.get("index")
        if not isinstance(index, int):
            continue
        tags = stream.get("tags") or {}
        language = str(tags.get("language") or "").strip() or None
        tracks.append(
            EmbeddedTrack(
                kind=kind,
                stream_index=index,
                label=_track_label(stream, kind, counts[kind]),
                language=language,
                is_default=bool((stream.get("disposition") or {}).get("default")),
            )
        )
    return tracks


async def probe_embedded_tracks(source_url: str) -> list[EmbeddedTrack]:
    """List the subtitle and audio streams of the media at ``source_url``."""
    if not ffmpeg_available():
        return []
    payload = await _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_streams",
            "-show_entries",
            "stream=index,codec_type,codec_name:stream_tags=language,title:stream_disposition=default",
            "-i",
            source_url,
        ],
        timeout_seconds=PROBE_TIMEOUT_SECONDS,
    )
    return parse_probe_output(payload.decode("utf-8", "replace"))


async def extract_embedded_subtitle(source_url: str, stream_index: int) -> bytes:
    """Convert one embedded subtitle stream to WebVTT."""
    if not ffmpeg_available():
        raise ServiceUnavailableError("Embedded subtitles are not available on this server.")
    return await _run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            source_url,
            "-map",
            f"0:{stream_index}",
            "-f",
            "webvtt",
            "-",
        ],
        timeout_seconds=EXTRACT_TIMEOUT_SECONDS,
        limit=MAX_SUBTITLE_BYTES,
    )


_SRT_TIMESTAMP = re.compile(
    r"(\d{1,2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}),(\d{3})"
)


def _decode_subtitle(data: bytes) -> str:
    # Subtitle files travel without a declared charset. UTF-8 covers almost
    # everything; the Windows fallbacks cover the rest without ever raising,
    # which matters more here than guessing the exact legacy codepage.
    for encoding in ("utf-8-sig", "utf-8", "cp1258", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", "replace")


def subtitle_file_to_vtt(data: bytes, filename: str) -> bytes:
    """Convert an uploaded ``.srt``/``.vtt`` attachment to WebVTT.

    Done in Python rather than through ffmpeg so subtitle files keep working
    on a deployment that has no ffmpeg, and so a small text file never costs a
    subprocess.
    """
    extension = subtitle_extension(filename)
    if extension is None:
        raise NotFoundError("That attachment is not a subtitle file.")
    text = _decode_subtitle(data).replace("\r\n", "\n").replace("\r", "\n")
    if extension == "vtt":
        # Already WebVTT, but a file missing its signature is rejected outright
        # by the browser, so add one rather than serving something unusable.
        return (text if text.lstrip().startswith("WEBVTT") else f"WEBVTT\n\n{text}").encode()

    # SubRip differs from WebVTT in two ways that matter: comma decimal
    # separators in timestamps, and the missing file signature. The numeric
    # counter before each cue is a valid WebVTT cue identifier, so it stays.
    cues = _SRT_TIMESTAMP.sub(r"\1.\2 --> \3.\4", text).lstrip()
    return ("WEBVTT\n\n" + cues).encode()
