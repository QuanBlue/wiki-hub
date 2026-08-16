from __future__ import annotations

import hashlib
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
