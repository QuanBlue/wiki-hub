"""Confluence Data Center XML export adapters.

This is intentionally not a WikiHub restore package.  Each profile owns its
descriptor and XML shape so a future DC major-version change cannot silently
change an existing export contract.
"""

from __future__ import annotations

import uuid
import zipfile
from collections import defaultdict
from collections.abc import Iterable
from xml.etree.ElementTree import Element, SubElement, tostring

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attachment import PageAttachment
from app.models.backup_job import BackupJob
from app.models.page import WikiPage
from app.models.permission import (
    Group,
    GroupMember,
    Permission,
    SpaceGroupPermission,
    SpaceUserPermission,
)
from app.models.restriction import PageGroupRestriction, PageUserRestriction
from app.models.space import Space, SpaceOwner, SpaceVisibility
from app.models.user import User
from app.modules.backup.service import _PROGRESS_CHECK_EVERY, checkpoint_backup_job
from app.services.storage import ObjectStorage

CONFLUENCE_DC_PROFILES = {"dc-8", "dc-9"}

# Confluence's own Hibernate-based export nests an object's primary key (and
# any reference to *another* object) inside a bare `<id>` element rather than
# writing it as plain attribute/property text - confirmed by our own reader
# for the opposite direction (`import_export/confluence.py`'s `_reference`,
# which is `property_element.find("id")`, and `scan_archive`'s
# `element.findtext("id")` for an object's own key). Writing a reference as
# plain text - which this file used to do - produces XML real Confluence (or
# our own importer, fed its own export back) cannot resolve: every
# Page/BodyContent/Attachment would import with no space, no parent, no body
# and no attachments, i.e. the archive would open but come back empty.
_PACKAGE = {
    "Space": "com.atlassian.confluence.spaces",
    "Page": "com.atlassian.confluence.pages",
    "BodyContent": "com.atlassian.confluence.core",
    "Attachment": "com.atlassian.confluence.pages",
    "SpacePermission": "com.atlassian.confluence.security",
    "ContentPermissionSet": "com.atlassian.confluence.security",
    "ContentPermission": "com.atlassian.confluence.security",
    "Group": "com.atlassian.confluence.user",
    "Membership": "com.atlassian.confluence.user",
}

# Real Confluence space-permission "type" strings that our own reader (and
# hence any destination WikiHub instance re-importing this archive) collapses
# into a coarse admin/editor/viewer space role - see
# import_export/service.py's own {"SETSPACEPERMISSIONS", ...} /
# {"EDITSPACE", ...} / "VIEWSPACE" buckets. A WikiHub principal's `admin`/
# `add`/`view` grant maps onto exactly one of these three; the finer-grained
# delete/delete_own/restrictions/export/move permissions have no Confluence
# space-permission equivalent and are not separately exportable - the same
# width limit the DC export already accepted for page content itself.
_ADMIN_PERM_TYPE = "SETSPACEPERMISSIONS"
_EDITOR_PERM_TYPE = "EDITSPACE"
_VIEWER_PERM_TYPE = "VIEWSPACE"


def _role_perm_type(permissions: set[Permission]) -> str | None:
    if Permission.admin in permissions:
        return _ADMIN_PERM_TYPE
    if Permission.add in permissions:
        return _EDITOR_PERM_TYPE
    if Permission.view in permissions:
        return _VIEWER_PERM_TYPE
    return None


def _object(parent: Element, cls: str, object_id: int) -> Element:
    node = SubElement(parent, "object", {"class": cls, "package": _PACKAGE[cls]})
    id_node = SubElement(node, "id", {"name": "id"})
    id_node.text = str(object_id)
    return node


def _property(parent: Element, name: str, value: str | int | None) -> None:
    """A plain scalar property - text, not a reference to another object.

    See `_reference_property` for the id-typed case; mixing the two up is
    exactly the bug this file used to have (see the module-level note above
    `_PACKAGE`).
    """
    if value is None:
        return
    node = SubElement(parent, "property", {"name": name})
    node.text = str(value)


def _reference_property(parent: Element, name: str, cls: str, ref_id: int | None) -> None:
    """A property whose value is another object, referenced by primary key -
    a Page's `space`/`parent`, a BodyContent's `content`, or an Attachment's
    `containerContent`. See the module-level note above `_PACKAGE` for why
    this can't just be `_property` with an int value.
    """
    if ref_id is None:
        return
    node = SubElement(parent, "property", {"name": name, "class": cls, "package": _PACKAGE[cls]})
    id_node = SubElement(node, "id", {"name": "id"})
    id_node.text = str(ref_id)


async def write_confluence_dc_export(
    path: str,
    storage: ObjectStorage,
    *,
    profile: str,
    spaces: Iterable[Space],
    pages: Iterable[WikiPage],
    attachments: Iterable[PageAttachment],
    users: Iterable[User] = (),
    groups: Iterable[Group] = (),
    group_members: Iterable[GroupMember] = (),
    space_owners: Iterable[SpaceOwner] = (),
    space_user_permissions: Iterable[SpaceUserPermission] = (),
    space_group_permissions: Iterable[SpaceGroupPermission] = (),
    page_user_restrictions: Iterable[PageUserRestriction] = (),
    page_group_restrictions: Iterable[PageGroupRestriction] = (),
    session: AsyncSession | None = None,
    job: BackupJob | None = None,
) -> None:
    """Write a Content/Space/Attachment/Permission DC export ZIP.

    IDs are scoped to this artifact and references are internally consistent.
    Full account objects (password, e-mail, directory sync flags, ...) are
    deliberately never emitted - they are neither portable nor safe to inject
    into another site. What *is* emitted, as plain text rather than a full
    object, is who a name refers to: page authorship (`creatorName`/
    `lastModifierName`), space membership/roles (`SpacePermission`), page
    view/edit allow-lists (`ContentPermission`), and the groups those
    reference (`Group`/`Membership`) - all by name only, resolved against
    whatever account of that name already exists on the destination (or
    left unresolved there, same as a name with no match ever would be). This
    is the difference between "every space comes back owned by no one but
    the importing admin" (the previous, incomplete shape of this export) and
    an archive that actually reproduces who could do what.

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

    users_by_id = {user.id: user for user in users}
    groups_by_id = {group.id: group for group in groups}

    # Per-space {principal_id: {granted Permission}}. A SpaceOwner row counts
    # as a full admin grant regardless of whatever (if anything) also sits in
    # SpaceUserPermission - matches PermissionService.effective_permissions,
    # where being an Owner already implies full access on its own.
    user_perms_by_space: dict[uuid.UUID, dict[uuid.UUID, set[Permission]]] = defaultdict(
        lambda: defaultdict(set)
    )
    for row in space_user_permissions:
        if row.space_id in selected_ids:
            user_perms_by_space[row.space_id][row.user_id].add(row.permission)
    for owner_row in space_owners:
        if owner_row.space_id in selected_ids:
            user_perms_by_space[owner_row.space_id][owner_row.user_id].add(Permission.admin)

    group_perms_by_space: dict[uuid.UUID, dict[uuid.UUID, set[Permission]]] = defaultdict(
        lambda: defaultdict(set)
    )
    for row in space_group_permissions:
        if row.space_id in selected_ids:
            group_perms_by_space[row.space_id][row.group_id].add(row.permission)

    # Page view/edit allow-lists, keyed by (page, restriction type). A
    # `denied=True` row is an explicit block, not an allow-list entry -
    # Confluence's own ContentPermission has no "deny" concept, only "allow
    # only these", so a block has no faithful equivalent here and is simply
    # left out rather than emitted as something it isn't.
    restrictions_by_page: dict[uuid.UUID, dict[str, list[tuple[str, str]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for user_restriction in page_user_restrictions:
        if user_restriction.denied or user_restriction.page_id not in pages_by_id:
            continue
        restricted_user = users_by_id.get(user_restriction.user_id)
        if restricted_user is None:
            continue
        restrictions_by_page[user_restriction.page_id][user_restriction.permission.value].append(
            ("user", restricted_user.username)
        )
    for group_restriction in page_group_restrictions:
        if group_restriction.denied or group_restriction.page_id not in pages_by_id:
            continue
        restricted_group = groups_by_id.get(group_restriction.group_id)
        if restricted_group is None:
            continue
        restrictions_by_page[group_restriction.page_id][group_restriction.permission.value].append(
            ("group", restricted_group.name)
        )

    # Only a group actually referenced by a permission or restriction in a
    # selected space is worth an object of its own - mirrors
    # import_export/service.py's own `active_group_names` filter, and keeps a
    # site-wide group list from leaking into a single space's export.
    referenced_group_ids: set[uuid.UUID] = set()
    for perms_by_group in group_perms_by_space.values():
        referenced_group_ids.update(perms_by_group)
    for group_restriction in page_group_restrictions:
        if not group_restriction.denied and group_restriction.page_id in pages_by_id:
            if groups_by_id.get(group_restriction.group_id) is not None:
                referenced_group_ids.add(group_restriction.group_id)

    async def _checkpoint(counters: dict[str, int] | None = None) -> None:
        """No-op unless a job is being tracked; see `checkpoint_backup_job`."""
        if job is None or session is None:
            return
        await checkpoint_backup_job(session, job, counters=counters)

    root = Element("hibernate-generic")
    ids: dict[object, int] = {}
    next_id = 1

    def _next_id() -> int:
        nonlocal next_id
        allocated = next_id
        next_id += 1
        return allocated

    for space in selected_spaces:
        ids[space.id] = _next_id()
    for page in selected_pages:
        ids[page.id] = _next_id()
    for attachment in selected_attachments:
        ids[attachment.id] = _next_id()

    for space in selected_spaces:
        space_element = _object(root, "Space", ids[space.id])
        _property(space_element, "key", space.key)
        _property(space_element, "name", space.name)
        _property(space_element, "description", space.description)
        if space.created_at is not None:
            _property(space_element, "creationDate", space.created_at.isoformat())

        if space.visibility == SpaceVisibility.open:
            # A true anonymous grant - no userName/groupName - is what
            # `_space_has_public_view` (and real Confluence's own "Anyone
            # can view") reads as "Open". Emitted in addition to, not
            # instead of, any named grants below: an Open space can still
            # carry a named Admin, and that should survive too.
            anonymous_view = _object(root, "SpacePermission", _next_id())
            _reference_property(anonymous_view, "space", "Space", ids[space.id])
            _property(anonymous_view, "type", _VIEWER_PERM_TYPE)

        for user_id, granted in user_perms_by_space.get(space.id, {}).items():
            perm_type = _role_perm_type(granted)
            user = users_by_id.get(user_id)
            if perm_type is None or user is None:
                continue
            user_perm = _object(root, "SpacePermission", _next_id())
            _reference_property(user_perm, "space", "Space", ids[space.id])
            _property(user_perm, "type", perm_type)
            _property(user_perm, "userName", user.username)

        for group_id, granted in group_perms_by_space.get(space.id, {}).items():
            perm_type = _role_perm_type(granted)
            group = groups_by_id.get(group_id)
            if perm_type is None or group is None:
                continue
            group_perm = _object(root, "SpacePermission", _next_id())
            _reference_property(group_perm, "space", "Space", ids[space.id])
            _property(group_perm, "type", perm_type)
            _property(group_perm, "groupName", group.name)

    for group_id in referenced_group_ids:
        group = groups_by_id.get(group_id)
        if group is None:
            continue
        ids[group_id] = _next_id()
        group_element = _object(root, "Group", ids[group_id])
        _property(group_element, "name", group.name)

    for member_row in group_members:
        if member_row.group_id not in referenced_group_ids:
            continue
        member_user = users_by_id.get(member_row.user_id)
        member_group = groups_by_id.get(member_row.group_id)
        if member_user is None or member_group is None:
            continue
        membership = _object(root, "Membership", _next_id())
        _property(membership, "groupName", member_group.name)
        _property(membership, "userName", member_user.username)

    for page_index, page in enumerate(selected_pages, start=1):
        page_element = _object(root, "Page", ids[page.id])
        _property(page_element, "title", page.title)
        _reference_property(page_element, "space", "Space", ids[page.space_id])
        _reference_property(page_element, "parent", "Page", ids.get(page.parent_id))
        _property(page_element, "contentStatus", "current")
        if page.created_at is not None:
            _property(page_element, "creationDate", page.created_at.isoformat())
        if page.updated_at is not None:
            _property(page_element, "lastModificationDate", page.updated_at.isoformat())
        creator = users_by_id.get(page.created_by_id) if page.created_by_id else None
        modifier = users_by_id.get(page.updated_by_id) if page.updated_by_id else None
        if creator is not None:
            _property(page_element, "creatorName", creator.username)
        if modifier is not None:
            _property(page_element, "lastModifierName", modifier.username)

        body = _object(root, "BodyContent", _next_id())
        _property(body, "body", page.content)
        _property(body, "bodyType", "2")
        _reference_property(body, "content", "Page", ids[page.id])

        for restriction_type, entries in restrictions_by_page.get(page.id, {}).items():
            if not entries:
                continue
            set_id = _next_id()
            permission_set = _object(root, "ContentPermissionSet", set_id)
            _property(permission_set, "type", restriction_type.capitalize())
            _reference_property(permission_set, "owningContent", "Page", ids[page.id])
            for kind, name in entries:
                content_permission = _object(root, "ContentPermission", _next_id())
                _reference_property(content_permission, "owningSet", "ContentPermissionSet", set_id)
                _property(content_permission, "type", restriction_type)
                _property(content_permission, "userName" if kind == "user" else "groupName", name)

        # Building the XML for a large instance takes minutes and awaits
        # nothing, so without this the job would neither observe a cancel nor
        # emit a heartbeat for that entire stretch - which is exactly how an
        # export ends up looking uncancellable.
        if page_index % _PROGRESS_CHECK_EVERY == 0:
            await _checkpoint()
    for attachment in selected_attachments:
        attachment_element = _object(root, "Attachment", ids[attachment.id])
        _property(attachment_element, "title", attachment.filename)
        _property(attachment_element, "contentType", attachment.content_type)
        _reference_property(attachment_element, "containerContent", "Page", ids[attachment.page_id])

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
