"""Streaming reader for Confluence site-export archives."""

from __future__ import annotations

import xml.etree.ElementTree as ET
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

from app.core.exceptions import BadRequestError


@dataclass(slots=True)
class ConfluencePage:
    source_id: str
    space_id: str
    parent_id: str | None
    title: str
    status: str


@dataclass(slots=True)
class ConfluenceSpace:
    source_id: str
    key: str
    name: str
    pages: list[ConfluencePage] = field(default_factory=list)


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
                                source_id, space_id, _reference(props.get("parent")), title, status
                            )
                        )
                element.clear()
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
