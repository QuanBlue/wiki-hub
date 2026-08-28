"""Recover a usable media type for attachments stored as a generic blob.

Uploads that arrive without a browser-supplied type - anything dragged in from
a client that guesses badly, and everything imported from Confluence - land in
storage as ``application/octet-stream``. Serving that back verbatim, under the
``X-Content-Type-Options: nosniff`` header the API sets on every response,
leaves the browser unable to play an mp4 or render a png: nosniff forbids it
from looking past the declared type.

The filename extension is the only signal left, so it is used - but only to
reach the image, audio and video types that a `<video>`, `<audio>` or `<img>`
element needs. Nothing here can promote a blob into HTML, SVG or a script,
which is what makes trusting the extension safe.
"""

from __future__ import annotations

import mimetypes

_GENERIC_TYPES = {"", "application/octet-stream", "binary/octet-stream"}
_PLAYABLE_PREFIXES = ("image/", "audio/", "video/")
#: SVG is an image that executes script, so it never gets recovered here.
_NEVER_INLINE = {"image/svg+xml"}


def playable_media_type(content_type: str, filename: str) -> str:
    """Return the type to serve an attachment as.

    The stored type wins whenever it says anything. Only a generic blob is
    re-typed, and only when the extension names an image, audio or video
    format.
    """
    stored = (content_type or "").strip().lower()
    if stored not in _GENERIC_TYPES:
        return content_type
    guessed, _ = mimetypes.guess_type(filename)
    if not guessed:
        return content_type or "application/octet-stream"
    guessed = guessed.lower()
    if guessed in _NEVER_INLINE or not guessed.startswith(_PLAYABLE_PREFIXES):
        return content_type or "application/octet-stream"
    return guessed
