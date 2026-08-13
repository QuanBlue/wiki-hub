"""Streaming reader for Confluence site-export archives."""

from __future__ import annotations

import xml.etree.ElementTree as ET
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from app.core.exceptions import BadRequestError


@dataclass(slots=True)
class ConfluencePage:
    source_id: str
    space_id: str
    parent_id: str | None
    title: str
    status: str
    created_at: datetime | None
    updated_at: datetime | None


@dataclass(slots=True)
class ConfluenceSpace:
    source_id: str
    key: str
    name: str
    pages: list[ConfluencePage] = field(default_factory=list)
    attachment_count: int = 0


@dataclass(slots=True)
class ConfluenceAttachment:
    source_id: str
    page_id: str
    filename: str
    content_type: str


def _properties(element: ET.Element) -> dict[str, ET.Element]:
    return {child.get("name", ""): child for child in element.findall("property")}


def _reference(property_element: ET.Element | None) -> str | None:
    if property_element is None:
        return None
    identifier = property_element.find("id")
    return identifier.text if identifier is not None else None


def _text(properties: dict[str, ET.Element], name: str, default: str = "") -> str:
    element = properties.get(name)
    return element.text.strip() if element is not None and element.text else default


def _timestamp(properties: dict[str, ET.Element], *names: str) -> datetime | None:
    """Read Confluence's ISO-8601 Page timestamp in UTC when present."""
    for name in names:
        value = _text(properties, name)
        if not value:
            continue
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            continue
        return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed
    return None


def scan_archive(path: Path) -> list[ConfluenceSpace]:
    """Read Space/Page metadata without materialising ``entities.xml`` in memory."""
    try:
        archive = zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        raise BadRequestError("The uploaded archive is not a valid ZIP file.") from exc

    with archive:
        try:
            stream = archive.open("entities.xml")
        except KeyError as exc:
            raise BadRequestError("The Confluence archive does not contain entities.xml.") from exc

        spaces: dict[str, ConfluenceSpace] = {}
        pages: list[ConfluencePage] = []
        attachment_page_ids: list[str] = []
        with stream:
            # Confluence exports are admin-only; iterparse keeps their 300MB XML bounded in memory.
            for _event, element in ET.iterparse(stream, events=("end",)):  # noqa: S314
                if element.tag != "object":
                    continue
                props = _properties(element)
                source_id = element.findtext("id")
                if element.get("class") == "Space" and source_id:
                    key = _text(props, "key")
                    name = _text(props, "name", key)
                    if key and name:
                        spaces[source_id] = ConfluenceSpace(source_id, key, name)
                elif element.get("class") == "Page" and source_id:
                    title = _text(props, "title")
                    space_id = _reference(props.get("space"))
                    status = _text(props, "contentStatus").lower()
                    if title and space_id and status == "current":
                        pages.append(
                            ConfluencePage(
                                source_id=source_id,
                                space_id=space_id,
                                parent_id=_reference(props.get("parent")),
                                title=title,
                                status=status,
                                created_at=_timestamp(props, "creationDate", "createdDate"),
                                updated_at=_timestamp(
                                    props, "lastModificationDate", "lastModifiedDate", "modifiedDate"
                                ),
                            )
                        )
                elif element.get("class") == "Attachment":
                    attachment_page_id = (
                        _reference(props.get("containerContent"))
                        or _reference(props.get("container"))
                        or _reference(props.get("content"))
                    )
                    if attachment_page_id:
                        attachment_page_ids.append(attachment_page_id)
                element.clear()
    pages_by_source_id = {page.source_id: page for page in pages}
    for attachment_page_id in attachment_page_ids:
        attachment_page = pages_by_source_id.get(attachment_page_id)
        if attachment_page and attachment_page.space_id in spaces:
            spaces[attachment_page.space_id].attachment_count += 1
    for page in pages:
        if page.space_id in spaces:
            spaces[page.space_id].pages.append(page)
    return sorted(spaces.values(), key=lambda item: item.key)


def iter_page_bodies(path: Path) -> Iterator[tuple[str, str]]:
    """Yield ``(page_source_id, html)`` without retaining page bodies in RAM."""
    with zipfile.ZipFile(path) as archive:
        try:
            stream = archive.open("entities.xml")
        except KeyError as exc:
            raise BadRequestError("The Confluence archive does not contain entities.xml.") from exc
        with stream:
            for _event, element in ET.iterparse(stream, events=("end",)):  # noqa: S314
                if element.tag != "object" or element.get("class") != "BodyContent":
                    continue
                props = _properties(element)
                page_id = _reference(props.get("content"))
                body = props.get("body")
                if page_id and body is not None and body.text:
                    yield page_id, body.text
                element.clear()


def iter_attachments(path: Path) -> Iterator[tuple[ConfluenceAttachment, str]]:
    """Yield attachment metadata with its ZIP member path, not its binary."""
    with zipfile.ZipFile(path) as archive:
        attachments: list[ConfluenceAttachment] = []
        with archive.open("entities.xml") as stream:
            for _event, element in ET.iterparse(stream, events=("end",)):  # noqa: S314
                if element.tag != "object":
                    continue
                if element.get("class") == "Attachment":
                    props = _properties(element)
                    source_id = element.findtext("id")
                    page_id = (
                        _reference(props.get("containerContent"))
                        or _reference(props.get("container"))
                        or _reference(props.get("content"))
                    )
                    filename = _text(props, "title") or _text(props, "fileName")
                    if source_id and page_id and filename:
                        attachments.append(
                            ConfluenceAttachment(
                                source_id,
                                page_id,
                                filename,
                                _text(props, "contentType", "application/octet-stream"),
                            )
                        )
                element.clear()
        names = set(archive.namelist())
        for attachment in attachments:
            candidates = (
                f"attachments/{attachment.source_id}",
                f"attachments/{attachment.source_id}/{attachment.filename}",
                f"attachments/{attachment.filename}",
            )
            entry = next((candidate for candidate in candidates if candidate in names), None)
            if entry is None:
                # Site exports vary between Confluence versions; retain only a
                # filename suffix fallback, never a broad fuzzy match.
                entry = next((name for name in names if name.endswith(f"/{attachment.filename}")), None)
            if entry is None:
                # Confluence Cloud / Server often stores attachments hierarchically by version number
                # without the filename in the path (e.g. attachments/.../12345/1)
                attachment_dir = f"/{attachment.source_id}/"
                versions = [name for name in names if attachment_dir in name and not name.endswith("/")]
                if versions:
                    try:
                        versions.sort(key=lambda x: int(x.split("/")[-1]))
                    except ValueError:
                        pass
                    entry = versions[-1]
            if entry:
                yield attachment, entry
