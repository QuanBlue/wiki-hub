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
from typing import IO, Any

from pydantic import ValidationError

from app.core.config import settings
from app.core.exceptions import BadRequestError, PayloadTooLargeError
from app.schemas.backup import BackupDocument

FULL_BACKUP_FORMAT = "wikihub.full-backup"
FULL_BACKUP_VERSION = 1
MANIFEST_PATH = "manifest.json"
DOCUMENT_PATH = "data/workspace.json"
#: The entry every Confluence site/space export carries. The two import paths
#: both take a `.zip` and sit side by side in the admin UI, so handing one the
#: other's archive is an easy mistake - and one that used to be reported as
#: "Backup is missing its manifest or workspace data", which is true and
#: useless. Recognising the other format lets the error name the mistake.
CONFLUENCE_MARKER_PATH = "entities.xml"
MAX_ARCHIVE_ENTRIES = 100_000
MAX_COMPRESSION_RATIO = 100
#: `data/workspace.json` is read whole and parsed as one Pydantic tree
#: (`BackupDocument.model_validate_json`), unlike attachments/avatars, which
#: are streamed. It holds page/revision *text*, not binaries, so this is a
#: separate, deliberately generous but still bounded cap - independent of
#: the overall archive cap (which callers may raise much higher for
#: attachment-heavy backups) so raising that cap can never let one JSON parse
#: pull an unbounded amount of RAM.
MAX_DOCUMENT_BYTES = 4 * 1024 * 1024 * 1024
#: Bytes read per chunk when a manifest entry is hashed to verify its
#: checksum, instead of reading the whole entry into memory at once.
_HASH_CHUNK_BYTES = 4 * 1024 * 1024


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


@dataclass(frozen=True, slots=True)
class BackupSpaceSummary:
    """One row of the "which spaces are in this archive?" preview."""

    key: str
    name: str
    #: Pages the archive holds for this space. Counted here because the
    #: workspace document is already parsed - the picker showed a bare key
    #: while the Confluence one showed "KEY - N pages", so the same decision
    #: was made with less information depending on which card you had used.
    page_count: int = 0


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


def _verify_entry_checksum(
    archive: zipfile.ZipFile, info: zipfile.ZipInfo, entry: PackageEntry
) -> None:
    """Confirm a declared manifest entry's size/sha256 without holding the
    whole entry in memory - attachments/avatars can be many GB each, and this
    runs once per entry just to verify what the manifest already claims."""
    if info.file_size != entry.size_bytes:
        raise BadRequestError(
            "Backup checksum verification failed.", code="backup_checksum_failed"
        )
    digest = hashlib.sha256()
    size = 0
    with archive.open(info) as source:
        while chunk := source.read(_HASH_CHUNK_BYTES):
            digest.update(chunk)
            size += len(chunk)
    if size != entry.size_bytes or digest.hexdigest() != entry.sha256:
        raise BadRequestError(
            "Backup checksum verification failed.", code="backup_checksum_failed"
        )


def _index_entries(archive: zipfile.ZipFile, limit: int) -> dict[str, zipfile.ZipInfo]:
    """Validate the archive's central directory and index it by path.

    Every check here reads only ZIP metadata, never entry contents, so it is
    cheap enough to run before deciding to read anything at all - which is
    what makes it safe to share between a full scan and the lightweight
    space-list preview.
    """
    infos = archive.infolist()
    if len(infos) > MAX_ARCHIVE_ENTRIES:
        raise BadRequestError(
            "Backup contains too many archive entries.", code="backup_too_many_entries"
        )
    total_uncompressed = 0
    by_path: dict[str, zipfile.ZipInfo] = {}
    for info in infos:
        entry_path = _safe_path(info.filename)
        if entry_path in by_path:
            raise BadRequestError(
                "Backup contains duplicate archive paths.", code="duplicate_backup_path"
            )
        if stat.S_IFMT(info.external_attr >> 16) == stat.S_IFLNK:
            raise BadRequestError(
                "Backup must not contain symbolic links.", code="unsafe_backup_path"
            )
        if info.compress_size and info.file_size / info.compress_size > MAX_COMPRESSION_RATIO:
            raise BadRequestError(
                "Backup compression ratio is unsafe.", code="backup_compression_ratio"
            )
        total_uncompressed += info.file_size
        if total_uncompressed > limit:
            raise PayloadTooLargeError("Backup expands beyond the configured import limit.")
        by_path[entry_path] = info
    return by_path


def _read_manifest(archive: zipfile.ZipFile, by_path: dict[str, zipfile.ZipInfo]) -> dict[str, Any]:
    if MANIFEST_PATH not in by_path or DOCUMENT_PATH not in by_path:
        if CONFLUENCE_MARKER_PATH in by_path:
            raise BadRequestError(
                "This looks like a Confluence export, not a WikiHub backup. "
                "Use \"Import Confluence Backup\" instead.",
                code="wrong_archive_format",
            )
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
    return manifest


def list_backup_spaces(
    source: IO[bytes] | str, *, max_size_bytes: int | None = None
) -> list[BackupSpaceSummary]:
    """List the spaces a backup archive contains, reading as little as possible.

    This backs the "select spaces to restore" picker, which only ever needs
    space keys and names. `scan_full_backup` would answer the same question,
    but at a wildly disproportionate cost: it SHA-256s the entire archive and
    then re-reads every declared entry to verify its checksum, so previewing a
    16 GB backup meant moving ~33 GB and taking minutes - long enough that the
    request died in the proxy before the answer arrived.

    Here only the ZIP central directory, `manifest.json`, and
    `data/workspace.json` are touched, which for that same archive is under
    4 MB. Combined with a ranged reader (`ObjectStorage.open_reader`), that
    holds whether the archive lives on disk or in object storage, and stays
    flat as archives grow.

    Skipping verification is safe precisely because this preview writes
    nothing: `restore_full_package` re-runs the full `scan_full_backup`,
    checksums included, before any row is touched.
    """
    limit = settings.max_import_size_bytes if max_size_bytes is None else max_size_bytes
    try:
        archive = zipfile.ZipFile(source)
    except zipfile.BadZipFile as exc:
        raise BadRequestError(
            "The uploaded file is not a valid ZIP archive.", code="malformed_backup"
        ) from exc

    with archive:
        by_path = _index_entries(archive, limit)
        _read_manifest(archive, by_path)
        try:
            document = json.loads(
                _read_limited(archive, by_path[DOCUMENT_PATH], MAX_DOCUMENT_BYTES)
            )
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise BadRequestError(
                "Backup workspace data is invalid.", code="malformed_backup"
            ) from exc

    # Parsed as plain JSON rather than through `BackupDocument`: validating
    # the whole tree (thousands of pages and revisions) to read one list is
    # the same disproportion this function exists to avoid.
    raw_spaces = document.get("spaces") if isinstance(document, dict) else None
    if not isinstance(raw_spaces, list):
        raise BadRequestError("Backup workspace data is invalid.", code="malformed_backup")
    raw_pages = document.get("pages") if isinstance(document, dict) else None
    page_counts: dict[str, int] = {}
    if isinstance(raw_pages, list):
        for raw_page in raw_pages:
            if isinstance(raw_page, dict):
                space_key = raw_page.get("space_key")
                if isinstance(space_key, str):
                    page_counts[space_key] = page_counts.get(space_key, 0) + 1

    spaces: list[BackupSpaceSummary] = []
    for raw in raw_spaces:
        if not isinstance(raw, dict) or not isinstance(raw.get("key"), str):
            raise BadRequestError("Backup workspace data is invalid.", code="malformed_backup")
        name = raw.get("name")
        spaces.append(
            BackupSpaceSummary(
                key=raw["key"],
                name=name if isinstance(name, str) else raw["key"],
                page_count=page_counts.get(raw["key"], 0),
            )
        )
    return spaces


def scan_full_backup(path: str, *, max_size_bytes: int | None = None) -> ScannedPackage:
    """Verify a full backup ZIP without extracting it anywhere.

    A scanned archive is deterministic: apply is allowed only if the archive
    SHA-256 stored by the scan still matches immediately before restore.

    ``max_size_bytes`` governs the overall archive/attachment total and
    defaults to the static `settings.max_import_size_bytes` when the caller
    has no runtime-configurable value to pass (e.g. the admin site setting a
    caller with a session can look up) - it does not affect
    `MAX_DOCUMENT_BYTES`, which is fixed regardless.
    """
    limit = settings.max_import_size_bytes if max_size_bytes is None else max_size_bytes
    archive_path = str(path)
    archive_size = __import__("os").path.getsize(archive_path)
    if archive_size > limit:
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
        by_path = _index_entries(archive, limit)
        seen = set(by_path)
        manifest = _read_manifest(archive, by_path)

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
            # Stream-hash rather than `_read_limited` (which reads the whole
            # entry into memory to hash it) - an attachment or avatar entry
            # can be many GB, and this loop verifies every single one.
            _verify_entry_checksum(archive, by_path[entry.path], entry)
            entries[entry.path] = entry
        if DOCUMENT_PATH not in entries:
            raise BadRequestError(
                "Backup manifest does not declare workspace data.", code="malformed_backup"
            )
        try:
            document = BackupDocument.model_validate_json(
                _read_limited(archive, by_path[DOCUMENT_PATH], MAX_DOCUMENT_BYTES)
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
