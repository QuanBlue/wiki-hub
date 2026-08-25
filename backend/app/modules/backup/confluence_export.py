"""Confluence Data Center XML export adapters.

This is intentionally not a WikiHub restore package.  Each profile owns its
descriptor and XML shape so a future DC major-version change cannot silently
change an existing export contract.
"""

from __future__ import annotations

import zipfile
from collections.abc import Iterable
from xml.etree.ElementTree import Element, SubElement, tostring

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attachment import PageAttachment
from app.models.backup_job import BackupJob
from app.models.page import WikiPage
from app.models.space import Space
from app.modules.backup.service import _PROGRESS_CHECK_EVERY, checkpoint_backup_job
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
    session: AsyncSession | None = None,
    job: BackupJob | None = None,
) -> None:
    """Write a conservative Content/Space/Attachment DC export ZIP.

    IDs are scoped to this artifact and references are internally consistent.
    User directory, groups and application configuration are deliberately
    absent: they are neither portable nor safe to inject into another site.

    ``session``/``job`` are optional and only used to report incremental
    progress / observe cancellation while attachment blobs are streamed from
    storage one by one - passing both is what lets the admin UI show a real
    percent/ETA and a working Cancel button instead of an indeterminate
    spinner.
    """
    if profile not in CONFLUENCE_DC_PROFILES:
        raise ValueError("A supported Confluence Data Center profile is required.")
    selected_spaces = list(spaces)
    selected_ids = {space.id for space in selected_spaces}
    selected_pages = [page for page in pages if page.space_id in selected_ids]
    pages_by_id = {page.id: page for page in selected_pages}
    selected_attachments = [item for item in attachments if item.page_id in pages_by_id]

    async def _checkpoint(counters: dict[str, int] | None = None) -> None:
        """No-op unless a job is being tracked; see `checkpoint_backup_job`."""
        if job is None or session is None:
            return
        await checkpoint_backup_job(session, job, counters=counters)

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
    for page_index, page in enumerate(selected_pages, start=1):
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
        # Building the XML for a large instance takes minutes and awaits
        # nothing, so without this the job would neither observe a cancel nor
        # emit a heartbeat for that entire stretch - which is exactly how an
        # export ends up looking uncancellable.
        if page_index % _PROGRESS_CHECK_EVERY == 0:
            await _checkpoint()
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
    total_items = len(selected_attachments)
    processed_items = 0

    async def _report_progress() -> None:
        nonlocal processed_items
        processed_items += 1
        if job is None or session is None or total_items == 0:
            return
        # Fixed item cadence, not gated on percent changing - see the matching
        # comment in `BackupService.export_full_package._report_progress`.
        if (
            processed_items % _PROGRESS_CHECK_EVERY != 0
            and processed_items != total_items
        ):
            return
        await _checkpoint(
            {"items_processed": processed_items, "items_total": total_items}
        )

    # Serialising the whole tree is another silent, potentially minutes-long
    # stretch; check once on either side of it.
    await _checkpoint()
    entities_xml = tostring(root, encoding="utf-8", xml_declaration=True)
    await _checkpoint()

    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr("entities.xml", entities_xml)
        archive.writestr("exportDescriptor.properties", descriptor)
        for attachment in selected_attachments:
            # A Data Center export stores attachment bytes separately from the
            # XML metadata.  The deterministic path is declared by our adapter.
            archive.writestr(
                f"attachments/{ids[attachment.id]}/{attachment.filename}",
                await storage.get(attachment.object_key),
            )
            await _report_progress()
