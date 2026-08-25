from __future__ import annotations

import hashlib
import io
import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.core.exceptions import BadRequestError
from app.modules.backup.package import (
    DOCUMENT_PATH,
    FULL_BACKUP_FORMAT,
    FULL_BACKUP_VERSION,
    MANIFEST_PATH,
    list_backup_spaces,
    scan_full_backup,
)


def _document() -> bytes:
    return json.dumps(
        {
            "wikihub_backup": {
                "version": 2,
                "exported_at": datetime.now(UTC).isoformat(),
                "app_version": "test",
                "site_name": "Test",
                "includes_credentials": False,
            }
        }
    ).encode()


def _write(path: str, *, extra_path: str | None = None, checksum: str | None = None) -> None:
    data = _document()
    manifest = {
        "format": FULL_BACKUP_FORMAT,
        "version": FULL_BACKUP_VERSION,
        "entries": [
            {
                "path": DOCUMENT_PATH,
                "sha256": checksum or hashlib.sha256(data).hexdigest(),
                "size_bytes": len(data),
            }
        ],
    }
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(DOCUMENT_PATH, data)
        archive.writestr(MANIFEST_PATH, json.dumps(manifest))
        if extra_path:
            archive.writestr(extra_path, b"bad")


def test_scan_accepts_valid_versioned_package(tmp_path: Path) -> None:
    path = str(tmp_path / "backup.zip")
    _write(path)
    scanned = scan_full_backup(path)
    assert scanned.manifest["format"] == FULL_BACKUP_FORMAT
    assert scanned.document.wikihub_backup.site_name == "Test"


def test_scan_rejects_zip_slip(tmp_path: Path) -> None:
    path = str(tmp_path / "unsafe.zip")
    _write(path, extra_path="../outside")
    with pytest.raises(BadRequestError, match="unsafe"):
        scan_full_backup(path)


def test_scan_rejects_bad_checksum(tmp_path: Path) -> None:
    path = str(tmp_path / "bad.zip")
    _write(path, checksum="0" * 64)
    with pytest.raises(BadRequestError, match="checksum"):
        scan_full_backup(path)


def test_scan_rejects_undeclared_entries(tmp_path: Path) -> None:
    path = str(tmp_path / "extra.zip")
    _write(path, extra_path="objects/unverified")
    with pytest.raises(BadRequestError, match="not covered"):
        scan_full_backup(path)


# -- list_backup_spaces: the picker's cheap preview -------------------------


def _write_with_spaces(path: str, spaces: list[dict[str, str]], *, blob: bytes = b"") -> None:
    """A package carrying `spaces`, plus an optional large unverified blob."""
    data = json.dumps(
        {
            "wikihub_backup": {
                "version": 2,
                "exported_at": datetime.now(UTC).isoformat(),
                "app_version": "test",
                "site_name": "Test",
                "includes_credentials": False,
            },
            "spaces": spaces,
        }
    ).encode()
    entries = [
        {
            "path": DOCUMENT_PATH,
            "sha256": hashlib.sha256(data).hexdigest(),
            "size_bytes": len(data),
        }
    ]
    if blob:
        # Deliberately declares a checksum that does NOT match, to prove the
        # preview never verifies entry contents.
        entries.append(
            {"path": "objects/blob.bin", "sha256": "0" * 64, "size_bytes": len(blob)}
        )
    manifest = {
        "format": FULL_BACKUP_FORMAT,
        "version": FULL_BACKUP_VERSION,
        "entries": entries,
    }
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(DOCUMENT_PATH, data)
        archive.writestr(MANIFEST_PATH, json.dumps(manifest))
        if blob:
            archive.writestr("objects/blob.bin", blob)


def test_list_backup_spaces_returns_key_and_name(tmp_path: Path) -> None:
    path = str(tmp_path / "spaces.zip")
    _write_with_spaces(path, [{"key": "ENG", "name": "Engineering"}, {"key": "OPS", "name": "Ops"}])
    with open(path, "rb") as handle:
        spaces = list_backup_spaces(handle)
    assert [(s.key, s.name) for s in spaces] == [("ENG", "Engineering"), ("OPS", "Ops")]


def test_list_backup_spaces_accepts_a_path_too(tmp_path: Path) -> None:
    path = str(tmp_path / "spaces.zip")
    _write_with_spaces(path, [{"key": "ENG", "name": "Engineering"}])
    assert [s.key for s in list_backup_spaces(path)] == ["ENG"]


def test_list_backup_spaces_skips_checksum_verification(tmp_path: Path) -> None:
    """The whole point of the preview: it must not read entry payloads.

    `scan_full_backup` rejects this archive (the blob's declared sha256 is
    wrong); the preview must still answer, because verifying every entry is
    exactly the multi-GB cost that made previewing a large backup time out.
    Nothing is written off the back of a preview - the restore job re-runs the
    full scan before touching a row.
    """
    path = str(tmp_path / "unverified.zip")
    _write_with_spaces(path, [{"key": "ENG", "name": "Engineering"}], blob=b"x" * 4096)

    with pytest.raises(BadRequestError, match="checksum"):
        scan_full_backup(path)

    assert [s.key for s in list_backup_spaces(path)] == ["ENG"]


def test_list_backup_spaces_only_reads_the_bytes_it_needs(tmp_path: Path) -> None:
    """Reading a space list must stay proportional to the manifest, not the
    archive - the property that keeps this fast as backups grow."""
    path = str(tmp_path / "big.zip")
    blob = b"\0" * (8 * 1024 * 1024)
    _write_with_spaces(path, [{"key": "ENG", "name": "Engineering"}], blob=blob)

    class _CountingReader(io.RawIOBase):
        def __init__(self, data: bytes) -> None:
            self._data, self._pos, self.read_bytes = data, 0, 0

        def readable(self) -> bool:
            return True

        def seekable(self) -> bool:
            return True

        def seek(self, offset: int, whence: int = 0) -> int:
            if whence == 0:
                self._pos = offset
            elif whence == 1:
                self._pos += offset
            else:
                self._pos = len(self._data) + offset
            return self._pos

        def tell(self) -> int:
            return self._pos

        def readinto(self, buffer) -> int:  # type: ignore[no-untyped-def]
            chunk = self._data[self._pos : self._pos + len(buffer)]
            buffer[: len(chunk)] = chunk
            self._pos += len(chunk)
            self.read_bytes += len(chunk)
            return len(chunk)

    raw = _CountingReader(Path(path).read_bytes())
    spaces = list_backup_spaces(io.BufferedReader(raw, buffer_size=64 * 1024))
    assert [s.key for s in spaces] == ["ENG"]
    # The 8 MB blob dominates the archive; the preview must not have read it.
    assert raw.read_bytes < len(blob) // 2


def test_list_backup_spaces_rejects_a_non_wikihub_zip(tmp_path: Path) -> None:
    path = str(tmp_path / "other.zip")
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("notes.txt", b"hello")
    with pytest.raises(BadRequestError, match="missing its manifest"):
        list_backup_spaces(path)


def test_list_backup_spaces_rejects_zip_slip(tmp_path: Path) -> None:
    path = str(tmp_path / "unsafe.zip")
    _write_with_spaces(path, [{"key": "ENG", "name": "Engineering"}])
    with zipfile.ZipFile(path, "a") as archive:
        archive.writestr("../outside", b"bad")
    with pytest.raises(BadRequestError, match="unsafe"):
        list_backup_spaces(path)


def test_list_backup_spaces_rejects_malformed_space_rows(tmp_path: Path) -> None:
    path = str(tmp_path / "bad-spaces.zip")
    _write_with_spaces(path, [{"name": "No key here"}])  # type: ignore[list-item]
    with pytest.raises(BadRequestError, match="workspace data is invalid"):
        list_backup_spaces(path)
