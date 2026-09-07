"""Unit coverage for the ``Range:`` header parsing behind media seeking."""

from __future__ import annotations

import pytest

from app.modules.attachments.byte_ranges import (
    UNSATISFIABLE,
    ByteRange,
    parse_byte_range,
)

SIZE = 1000


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("bytes=0-99", ByteRange(0, 99)),
        ("bytes=500-", ByteRange(500, 999)),
        ("bytes=-200", ByteRange(800, 999)),
        # A player commonly asks for more than is there; the tail is served.
        ("bytes=900-5000", ByteRange(900, 999)),
        ("bytes=-5000", ByteRange(0, 999)),
        ("BYTES=0-0", ByteRange(0, 0)),
        ("  bytes=10-20  ", ByteRange(10, 20)),
    ],
)
def test_a_single_range_is_resolved_against_the_object(
    header: str, expected: ByteRange
) -> None:
    assert parse_byte_range(header, SIZE) == expected


def test_range_length_counts_both_ends() -> None:
    resolved = parse_byte_range("bytes=0-99", SIZE)
    assert isinstance(resolved, ByteRange)
    assert resolved.length == 100


@pytest.mark.parametrize("header", ["bytes=1000-", "bytes=2500-3000", "bytes=-0"])
def test_a_range_past_the_end_is_unsatisfiable(header: str) -> None:
    assert parse_byte_range(header, SIZE) is UNSATISFIABLE


@pytest.mark.parametrize(
    "header",
    [
        None,
        "",
        "items=0-99",
        "bytes=abc-99",
        "bytes=0-abc",
        "bytes=-abc",
        "bytes=100",
        # Multipart ranges are not served, so the full body is the answer.
        "bytes=0-99,200-299",
        # An inverted range is malformed rather than unsatisfiable.
        "bytes=500-100",
    ],
)
def test_anything_not_served_falls_back_to_the_whole_body(header: str | None) -> None:
    assert parse_byte_range(header, SIZE) is None


def test_an_empty_object_is_never_ranged() -> None:
    assert parse_byte_range("bytes=0-99", 0) is None
