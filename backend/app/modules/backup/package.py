"""Safe, versioned WikiHub full-backup ZIP packages.

The old JSON document is intentionally still supported by the HTTP API.  This
module is the binary package boundary used by the asynchronous backup flow: it
does not extract untrusted archives, validates every declared entry while it is
read, and rejects paths that could escape a staging directory.
"""

from __future__ import annotations

import hashlib
import json
import stat
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

from pydantic import ValidationError

from app.core.config import settings
from app.core.exceptions import BadRequestError, PayloadTooLargeError
from app.schemas.backup import BackupDocument

FULL_BACKUP_FORMAT = "wikihub.full-backup"
FULL_BACKUP_VERSION = 1
MANIFEST_PATH = "manifest.json"
DOCUMENT_PATH = "data/workspace.json"
MAX_ARCHIVE_ENTRIES = 100_000
MAX_COMPRESSION_RATIO = 100


@dataclass(frozen=True, slots=True)
class PackageEntry:
    path: str
    sha256: str
    size_bytes: int


@dataclass(frozen=True, slots=True)
class ScannedPackage:
    document: BackupDocument
    manifest: dict[str, Any]
    entries: dict[str, PackageEntry]
    archive_sha256: str
    archive_size_bytes: int


def _safe_path(path: str) -> str:
    candidate = PurePosixPath(path)
    if (
        not path
        or "\\" in path
        or candidate.is_absolute()
        or ".." in candidate.parts
        or path.startswith("/")
        or str(candidate) != path
    ):
        raise BadRequestError("Backup contains an unsafe archive path.", code="unsafe_backup_path")
    return path


def _read_limited(archive: zipfile.ZipFile, info: zipfile.ZipInfo, limit: int) -> bytes:
    if info.file_size > limit:
        raise PayloadTooLargeError("Backup entry exceeds the configured import limit.")
    with archive.open(info) as source:
        payload = source.read(limit + 1)
    if len(payload) > limit:
        raise PayloadTooLargeError("Backup entry exceeds the configured import limit.")
    return payload


def scan_full_backup(path: str) -> ScannedPackage:
    """Verify a full backup ZIP without extracting it anywhere.

    A scanned archive is deterministic: apply is allowed only if the archive
    SHA-256 stored by the scan still matches immediately before restore.
    """
    archive_path = str(path)
    archive_size = __import__("os").path.getsize(archive_path)
    if archive_size > settings.max_import_size_bytes:
        raise PayloadTooLargeError("Backup archive exceeds the configured import limit.")
    digest = hashlib.sha256()
    with open(archive_path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)

    try:
        archive = zipfile.ZipFile(archive_path)
    except zipfile.BadZipFile as exc:
        raise BadRequestError(
            "The uploaded file is not a valid ZIP archive.", code="malformed_backup"
        ) from exc

    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_ARCHIVE_ENTRIES:
            raise BadRequestError(
                "Backup contains too many archive entries.", code="backup_too_many_entries"
            )
        seen: set[str] = set()
        total_uncompressed = 0
        by_path: dict[str, zipfile.ZipInfo] = {}
        for info in infos:
            entry_path = _safe_path(info.filename)
            if entry_path in seen:
                raise BadRequestError(
                    "Backup contains duplicate archive paths.", code="duplicate_backup_path"
                )
            seen.add(entry_path)
            if stat.S_IFMT(info.external_attr >> 16) == stat.S_IFLNK:
                raise BadRequestError(
                    "Backup must not contain symbolic links.", code="unsafe_backup_path"
                )
            if info.compress_size and info.file_size / info.compress_size > MAX_COMPRESSION_RATIO:
                raise BadRequestError(
                    "Backup compression ratio is unsafe.", code="backup_compression_ratio"
                )
            total_uncompressed += info.file_size
            if total_uncompressed > settings.max_import_size_bytes:
                raise PayloadTooLargeError("Backup expands beyond the configured import limit.")
            by_path[entry_path] = info

        if MANIFEST_PATH not in by_path or DOCUMENT_PATH not in by_path:
            raise BadRequestError(
                "Backup is missing its manifest or workspace data.", code="malformed_backup"
            )
        try:
            manifest = json.loads(_read_limited(archive, by_path[MANIFEST_PATH], 2 * 1024 * 1024))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise BadRequestError(
                "Backup manifest is not valid JSON.", code="malformed_backup"
            ) from exc
        if (
            not isinstance(manifest, dict)
            or manifest.get("format") != FULL_BACKUP_FORMAT
            or manifest.get("version") != FULL_BACKUP_VERSION
            or not isinstance(manifest.get("entries"), list)
        ):
            raise BadRequestError(
                "Backup manifest is unsupported.", code="unsupported_backup_version"
            )

        entries: dict[str, PackageEntry] = {}
        for raw in manifest["entries"]:
            if not isinstance(raw, dict):
                raise BadRequestError("Backup manifest entry is invalid.", code="malformed_backup")
            entry = PackageEntry(
                path=_safe_path(str(raw.get("path", ""))),
                sha256=str(raw.get("sha256", "")),
                size_bytes=int(raw.get("size_bytes", -1)),
            )
            if len(entry.sha256) != 64 or entry.size_bytes < 0 or entry.path in entries:
                raise BadRequestError("Backup manifest entry is invalid.", code="malformed_backup")
            if entry.path not in by_path:
                raise BadRequestError(
                    "Backup is missing a declared entry.", code="malformed_backup"
                )
            payload = _read_limited(archive, by_path[entry.path], settings.max_import_size_bytes)
            if (
                len(payload) != entry.size_bytes
                or hashlib.sha256(payload).hexdigest() != entry.sha256
            ):
                raise BadRequestError(
                    "Backup checksum verification failed.", code="backup_checksum_failed"
                )
            entries[entry.path] = entry
        if DOCUMENT_PATH not in entries:
            raise BadRequestError(
                "Backup manifest does not declare workspace data.", code="malformed_backup"
            )
        try:
            document = BackupDocument.model_validate_json(
                _read_limited(archive, by_path[DOCUMENT_PATH], settings.max_import_size_bytes)
            )
        except ValidationError as exc:
            raise BadRequestError(
                "Backup workspace data is invalid.", code="malformed_backup"
            ) from exc
        for attachment in document.attachments:
            declared = entries.get(attachment.object_path)
            if (
                declared is None
                or declared.sha256 != attachment.sha256
                or declared.size_bytes != attachment.size_bytes
            ):
                raise BadRequestError(
                    "Backup binary metadata does not match its manifest entry.",
                    code="backup_checksum_failed",
                )
        for avatar in document.avatars:
            declared = entries.get(avatar.object_path)
            if (
                declared is None
                or declared.sha256 != avatar.sha256
                or declared.size_bytes != avatar.size_bytes
            ):
                raise BadRequestError(
                    "Backup binary metadata does not match its manifest entry.",
                    code="backup_checksum_failed",
                )
        if seen != {*entries, MANIFEST_PATH}:
            raise BadRequestError(
                "Backup contains entries that are not covered by its manifest.",
                code="malformed_backup",
            )
    return ScannedPackage(document, manifest, entries, digest.hexdigest(), archive_size)
