"""Single-range ``Range:`` header parsing for attachment downloads.

Audio and video elements seek by asking for byte ranges. A server that answers
every request with the whole body leaves the browser unable to scrub the
timeline, so :mod:`app.api.v1.attachments` advertises ``Accept-Ranges`` and
serves ``206 Partial Content`` through the helpers below.
"""

from __future__ import annotations

from dataclasses import dataclass

_UNIT_PREFIX = "bytes="


@dataclass(frozen=True, slots=True)
class ByteRange:
    """An inclusive byte range, already clamped to the object's size."""

    start: int
    end: int

    @property
    def length(self) -> int:
        return self.end - self.start + 1


@dataclass(frozen=True, slots=True)
class UnsatisfiableRange:
    """A well-formed range that falls outside the object entirely."""


UNSATISFIABLE = UnsatisfiableRange()


def parse_byte_range(
    header: str | None, size: int
) -> ByteRange | UnsatisfiableRange | None:
    """Resolve a ``Range`` header against an object of ``size`` bytes.

    Returns ``None`` when the caller should answer with the complete body:
    RFC 9110 requires an unparsable range to be ignored rather than rejected,
    and this only serves single ranges, so a multipart request is ignored too.
    """
    if not header or size <= 0:
        return None
    value = header.strip()
    if not value.lower().startswith(_UNIT_PREFIX):
        return None
    specs = value[len(_UNIT_PREFIX) :].split(",")
    if len(specs) != 1:
        return None

    first, separator, last = specs[0].strip().partition("-")
    if not separator:
        return None

    if not first:
        # `bytes=-500` asks for the final 500 bytes.
        if not last.isdigit():
            return None
        suffix = int(last)
        if suffix == 0:
            return UNSATISFIABLE
        return ByteRange(start=max(0, size - suffix), end=size - 1)

    if not first.isdigit():
        return None
    start = int(first)
    if start >= size:
        return UNSATISFIABLE
    if not last:
        return ByteRange(start=start, end=size - 1)
    if not last.isdigit():
        return None
    end = min(int(last), size - 1)
    if end < start:
        return None
    return ByteRange(start=start, end=end)
