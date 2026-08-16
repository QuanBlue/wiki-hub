"""Confluence Data Center XML export adapters.

This is intentionally not a WikiHub restore package.  Each profile owns its
descriptor and XML shape so a future DC major-version change cannot silently
change an existing export contract.
"""

from __future__ import annotations

import zipfile
from collections.abc import Iterable
from xml.etree.ElementTree import Element, SubElement, tostring

from app.models.attachment import PageAttachment
from app.models.page import WikiPage
from app.models.space import Space
from app.services.storage import ObjectStorage

CONFLUENCE_DC_PROFILES = {"dc-8", "dc-9"}


def _property(parent: Element, name: str, value: str | int | None) -> None:
    if value is None:
        return
    node = SubElement(parent, "property", {"name": name})
    node.text = str(value)


async def write_confluence_dc_export(
    path: str,
    storage: ObjectStorage,
    *,
    profile: str,
    spaces: Iterable[Space],
    pages: Iterable[WikiPage],
    attachments: Iterable[PageAttachment],
) -> None:
    """Write a conservative Content/Space/Attachment DC export ZIP.

    IDs are scoped to this artifact and references are internally consistent.
    User directory, groups and application configuration are deliberately
    absent: they are neither portable nor safe to inject into another site.
    """
    if profile not in CONFLUENCE_DC_PROFILES:
        raise ValueError("A supported Confluence Data Center profile is required.")
    selected_spaces = list(spaces)
    selected_ids = {space.id for space in selected_spaces}
    selected_pages = [page for page in pages if page.space_id in selected_ids]
    pages_by_id = {page.id: page for page in selected_pages}
    selected_attachments = [item for item in attachments if item.page_id in pages_by_id]

    root = Element("hibernate-generic")
    ids: dict[object, int] = {}
    next_id = 1
    for space in selected_spaces:
        ids[space.id] = next_id
        next_id += 1
    for page in selected_pages:
        ids[page.id] = next_id
        next_id += 1
    for attachment in selected_attachments:
        ids[attachment.id] = next_id
        next_id += 1
    for space in selected_spaces:
        space_element = SubElement(root, "object", {"class": "Space", "id": str(ids[space.id])})
        _property(space_element, "key", space.key)
        _property(space_element, "name", space.name)
        _property(space_element, "description", space.description)
    for page in selected_pages:
        page_element = SubElement(root, "object", {"class": "Page", "id": str(ids[page.id])})
        _property(page_element, "title", page.title)
        _property(page_element, "space", ids[page.space_id])
        _property(page_element, "parent", ids.get(page.parent_id))
        _property(page_element, "contentStatus", "current")
        body = SubElement(root, "object", {"class": "BodyContent", "id": str(next_id)})
        next_id += 1
        _property(body, "body", page.content)
        _property(body, "bodyType", "2")
        _property(body, "content", ids[page.id])
    for attachment in selected_attachments:
        attachment_element = SubElement(
            root, "object", {"class": "Attachment", "id": str(ids[attachment.id])}
        )
        _property(attachment_element, "title", attachment.filename)
        _property(attachment_element, "contentType", attachment.content_type)
        _property(attachment_element, "containerContent", ids[attachment.page_id])

    descriptor = "\n".join(
        [
            "exportVersion=1.0",
            "buildNumber=wikihub",
            f"confluenceCompatibility={profile}",
            "type=space",
            "entities=entities.xml",
            "",
        ]
    )
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr("entities.xml", tostring(root, encoding="utf-8", xml_declaration=True))
        archive.writestr("exportDescriptor.properties", descriptor)
        for attachment in selected_attachments:
            # A Data Center export stores attachment bytes separately from the
            # XML metadata.  The deterministic path is declared by our adapter.
            archive.writestr(
                f"attachments/{ids[attachment.id]}/{attachment.filename}",
                await storage.get(attachment.object_key),
            )
