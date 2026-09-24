"""Streaming reader for Confluence site-export archives."""

from __future__ import annotations

import xml.etree.ElementTree as ET
import zipfile
from collections.abc import Iterator
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import IO

from dateutil import parser as dateutil_parser

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
    creator: str | None = None
    last_modifier: str | None = None


@dataclass(slots=True)
class ConfluencePermission:
    perm_type: str
    user_name: str | None = None
    group_name: str | None = None


@dataclass(slots=True)
class ConfluencePageRestriction:
    page_id: str
    restriction_type: str  # "view" or "edit"
    user_name: str | None = None
    group_name: str | None = None


@dataclass(slots=True)
class ConfluenceGroup:
    name: str
    members: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ConfluenceUserInfo:
    """The directory record for one Confluence account: its real email and display name.

    Confluence's own site export never carries a *password*, but the
    ``InternalUser``/``ConfluenceUserImpl`` objects in ``entities.xml`` do
    carry ``emailAddress`` and ``displayName`` when the archive is a full
    site backup (as opposed to a single-space content export). Without this,
    the importer has no real email to give a newly-created account and falls
    back to a fabricated placeholder that has nothing to do with Confluence.
    """

    username: str
    email: str | None = None
    display_name: str | None = None


@dataclass(slots=True)
class ConfluenceSpace:
    source_id: str
    key: str
    name: str
    pages: list[ConfluencePage] = field(default_factory=list)
    attachment_count: int = 0
    permissions: list[ConfluencePermission] = field(default_factory=list)
    restrictions: list[ConfluencePageRestriction] = field(default_factory=list)
    #: When Confluence's export carries them (a full site export usually
    #: does; a single-space content export sometimes doesn't), the space's
    #: own creation date and creator - not to be confused with any page's.
    created_at: datetime | None = None
    creator: str | None = None


class ConfluenceSpaceList(list[ConfluenceSpace]):
    """A list of Confluence spaces that also carries parsed group/user directory data."""

    def __init__(
        self,
        spaces: list[ConfluenceSpace] = (),
        groups: list[ConfluenceGroup] = (),
        users: list[ConfluenceUserInfo] = (),
    ) -> None:
        super().__init__(spaces)
        self.groups: list[ConfluenceGroup] = list(groups)
        self.users: list[ConfluenceUserInfo] = list(users)


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


def _property_text(element: ET.Element | None) -> str:
    """Extract raw text from a property element, checking child tags like <date>."""
    if element is None:
        return ""
    # Confluence DC / Server serializes dates and IDs into child tags
    # e.g. <property name="creationDate"><id>123</id><date>2022-09-26 14:04:47.000</date></property>
    for child_tag in ("date", "value"):
        child_val = element.findtext(child_tag)
        if child_val and child_val.strip():
            return child_val.strip()
    if element.text and element.text.strip():
        return element.text.strip()
    # Check any child elements that are not <id> or <ref>
    for child in element:
        if child.tag not in ("id", "ref") and child.text and child.text.strip():
            return child.text.strip()
    return ""


def _timestamp(properties: dict[str, ET.Element], *names: str) -> datetime | None:
    """Read Confluence's Page/Space timestamp in UTC when present."""
    for name in names:
        element = properties.get(name)
        value = _property_text(element)
        if not value:
            continue
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            try:
                parsed = dateutil_parser.parse(value)
            except (ValueError, TypeError, OverflowError):
                continue
        return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
    return None


def _wrong_format_or(archive: zipfile.ZipFile, fallback: str) -> BadRequestError:
    """Say "you picked the other card's file" when that is what happened.

    A WikiHub backup is recognised by the same two entries its own reader
    requires (`app/modules/backup/package.py`); anything else falls back to the
    generic message, so an archive that is merely broken is not mislabelled.
    """
    names = set(archive.namelist())
    if "manifest.json" in names and "data/workspace.json" in names:
        return BadRequestError(
            "This looks like a WikiHub backup, not a Confluence export. "
            'Use "Restore WikiHub Backup" instead.',
            code="wrong_archive_format",
        )
    return BadRequestError(fallback)


def scan_archive(file_or_path: Path | IO[bytes]) -> ConfluenceSpaceList:
    """Read Space/Page metadata without materialising ``entities.xml`` in memory."""
    try:
        archive = zipfile.ZipFile(file_or_path)
    except zipfile.BadZipFile as exc:
        raise BadRequestError("The uploaded archive is not a valid ZIP file.") from exc

    with archive:
        try:
            stream = archive.open("entities.xml")
        except KeyError as exc:
            # The mirror of the check in backup/package.py: the two import
            # cards both take a `.zip`, so the archive handed to the wrong one
            # is a routine mistake. Name it instead of reporting a missing
            # entry the user has no reason to have heard of.
            raise _wrong_format_or(
                archive,
                "The Confluence archive does not contain entities.xml.",
            ) from exc

        spaces: dict[str, ConfluenceSpace] = {}
        pages: list[ConfluencePage] = []
        attachment_page_ids: list[str] = []
        user_names: dict[str, str] = {}
        user_info: dict[str, tuple[str | None, str | None]] = {}
        group_names: dict[str, str] = {}
        group_members: dict[str, set[str]] = {}

        page_user_refs: list[tuple[ConfluencePage, str | None, str | None]] = []
        space_user_refs: list[tuple[ConfluenceSpace, str | None]] = []
        space_permission_refs: list[
            tuple[str, str, str | None, str | None, str | None, str | None]
        ] = []
        membership_refs: list[tuple[str | None, str | None, str | None, str | None]] = []

        perm_sets: dict[str, tuple[str, str]] = {}  # set_id -> (page_id, set_type "view"|"edit")
        perm_refs: list[
            tuple[str, str | None, str | None, str | None, str | None, str | None]
        ] = []

        with stream:
            # Confluence exports are admin-only; iterparse keeps their 300MB XML bounded in memory.
            for _event, element in ET.iterparse(stream, events=("end",)):  # noqa: S314
                if element.tag != "object":
                    continue
                props = _properties(element)
                source_id = element.findtext("id")
                cls_name = element.get("class") or ""

                if cls_name == "Space" and source_id:
                    key = _text(props, "key")
                    name = _text(props, "name", key)
                    if key and name:
                        creator_ref = _reference(props.get("creator"))
                        creator_name = _text(props, "creatorName") or _text(props, "creator")
                        space_obj = ConfluenceSpace(
                            source_id,
                            key,
                            name,
                            created_at=_timestamp(props, "creationDate", "createdDate"),
                            creator=creator_name or None,
                        )
                        spaces[source_id] = space_obj
                        space_user_refs.append((space_obj, creator_ref))

                elif "Group" in cls_name and source_id:
                    gname = (
                        _text(props, "name")
                        or _text(props, "groupName")
                        or _text(props, "lowerName")
                    )
                    if gname:
                        group_names[source_id] = gname
                        group_members.setdefault(gname, set())

                elif "Membership" in cls_name or "Member" in cls_name:
                    gname = (
                        _text(props, "parentName")
                        or _text(props, "lowerParentName")
                        or _text(props, "groupName")
                        or _text(props, "group")
                        or _text(props, "name")
                    )
                    gref = (
                        _reference(props.get("parentGroup"))
                        or _reference(props.get("parent"))
                        or _reference(props.get("group"))
                        or _reference(props.get("directoryGroup"))
                    )
                    uname = (
                        _text(props, "childName")
                        or _text(props, "lowerChildName")
                        or _text(props, "userName")
                        or _text(props, "user")
                        or _text(props, "member")
                    )
                    uref = (
                        _reference(props.get("userMember"))
                        or _reference(props.get("member"))
                        or _reference(props.get("child"))
                        or _reference(props.get("user"))
                        or _reference(props.get("userSubject"))
                        or _reference(props.get("childUser"))
                        or _reference(props.get("directoryUser"))
                    )
                    if (gname or gref) and (uname or uref):
                        membership_refs.append((gname or None, gref, uname or None, uref))

                elif cls_name == "SpacePermission":
                    space_ref = _reference(props.get("space"))
                    perm_type = _text(props, "type")
                    user_name = _text(props, "userName")
                    user_ref = _reference(props.get("userSubject")) or _reference(props.get("user"))
                    group_name = _text(props, "group") or _text(props, "groupName")
                    group_ref = _reference(props.get("group"))
                    if space_ref and perm_type:
                        space_permission_refs.append(
                            (
                                space_ref,
                                perm_type,
                                user_name or None,
                                user_ref or None,
                                group_name or None,
                                group_ref or None,
                            )
                        )

                elif cls_name == "ContentPermissionSet" and source_id:
                    set_type = _text(props, "type").lower()
                    page_ref = _reference(props.get("owningContent")) or _reference(
                        props.get("content")
                    )
                    if page_ref and set_type:
                        perm_sets[source_id] = (page_ref, set_type)

                elif cls_name == "ContentPermission":
                    set_ref = _reference(props.get("owningSet"))
                    perm_type = _text(props, "type")
                    user_name = _text(props, "userName")
                    user_ref = _reference(props.get("userSubject")) or _reference(props.get("user"))
                    group_name = _text(props, "groupName") or _text(props, "group")
                    group_ref = _reference(props.get("group"))
                    if set_ref:
                        perm_refs.append(
                            (
                                set_ref,
                                perm_type.lower() if perm_type else None,
                                user_name or None,
                                user_ref or None,
                                group_name or None,
                                group_ref or None,
                            )
                        )

                elif "User" in cls_name and source_id:
                    username_val = (
                        _text(props, "name")
                        or _text(props, "userName")
                        or _text(props, "lowerName")
                    )
                    user_key = (
                        _text(props, "key") or _text(props, "userKey") or _text(props, "externalId")
                    )
                    email_val = _text(props, "emailAddress") or _text(props, "email")
                    display_name_val = _text(props, "displayName") or _text(props, "fullName")
                    if username_val:
                        user_names[source_id] = username_val
                        user_names[username_val] = username_val
                        user_names[username_val.lower()] = username_val
                        if user_key:
                            user_names[user_key] = username_val
                            user_names[user_key.lower()] = username_val
                        if email_val or display_name_val:
                            user_info[username_val] = (email_val or None, display_name_val or None)

                elif cls_name == "Page" and source_id:
                    title = _text(props, "title")
                    space_id = _reference(props.get("space"))
                    status = _text(props, "contentStatus").lower()
                    if title and space_id and status == "current":
                        creator_ref = _reference(props.get("creator"))
                        last_modifier_ref = _reference(props.get("lastModifier"))
                        # Confluence emits both a reference/object form and a
                        # compact form where the username is the direct text
                        # of ``creator`` / ``lastModifier``. The latter has no
                        # ``<id>`` and used to be treated as missing, causing
                        # the importer to credit the importing administrator.
                        creator_name = _text(props, "creatorName") or _text(props, "creator")
                        last_modifier_name = _text(props, "lastModifierName") or _text(
                            props, "lastModifier"
                        )

                        page = ConfluencePage(
                            source_id=source_id,
                            space_id=space_id,
                            parent_id=_reference(props.get("parent")),
                            title=title,
                            status=status,
                            created_at=_timestamp(props, "creationDate", "createdDate"),
                            updated_at=_timestamp(
                                props, "lastModificationDate", "lastModifiedDate", "modifiedDate"
                            ),
                            creator=creator_name or None,
                            last_modifier=last_modifier_name or None,
                        )
                        pages.append(page)
                        page_user_refs.append((page, creator_ref, last_modifier_ref))

                elif cls_name == "Attachment":
                    attachment_page_id = (
                        _reference(props.get("containerContent"))
                        or _reference(props.get("container"))
                        or _reference(props.get("content"))
                    )
                    if attachment_page_id:
                        attachment_page_ids.append(attachment_page_id)
                element.clear()

    def _lookup_user(name_or_key: str | None, ref_id: str | None) -> str | None:
        if name_or_key:
            res = (
                user_names.get(name_or_key)
                or user_names.get(name_or_key.lower())
                or name_or_key
            )
            # If the result was another key in user_names, resolve it
            return user_names.get(res) or user_names.get(res.lower()) or res
        if ref_id:
            res = user_names.get(ref_id) or user_names.get(ref_id.lower())
            if res:
                return user_names.get(res) or user_names.get(res.lower()) or res
        return None

    def _lookup_group(name_or_key: str | None, ref_id: str | None) -> str | None:
        if name_or_key:
            res = (
                group_names.get(name_or_key)
                or group_names.get(name_or_key.lower())
                or name_or_key
            )
            return group_names.get(res) or group_names.get(res.lower()) or res
        if ref_id:
            res = group_names.get(ref_id) or group_names.get(ref_id.lower())
            if res:
                return group_names.get(res) or group_names.get(res.lower()) or res
        return None

    # Resolve creator and modifier usernames from their referenced IDs
    for page, creator_ref, last_modifier_ref in page_user_refs:
        if not page.creator and creator_ref:
            page.creator = _lookup_user(None, creator_ref)
        elif page.creator:
            page.creator = _lookup_user(page.creator, None)
        if not page.last_modifier and last_modifier_ref:
            page.last_modifier = _lookup_user(None, last_modifier_ref)
        elif page.last_modifier:
            page.last_modifier = _lookup_user(page.last_modifier, None)

    # Resolve each space's own creator, same as pages above - it may arrive
    # as a bare reference id, a compact username, or not at all (a
    # single-space content export often omits the Space object's creator).
    for space_obj, creator_ref in space_user_refs:
        if not space_obj.creator and creator_ref:
            space_obj.creator = _lookup_user(None, creator_ref)
        elif space_obj.creator:
            space_obj.creator = _lookup_user(space_obj.creator, None)

    # Resolve group memberships
    for gname, gref, uname, uref in membership_refs:
        resolved_g = _lookup_group(gname, gref)
        resolved_u = _lookup_user(uname, uref)
        if resolved_g and resolved_u:
            target_g = resolved_g
            for existing_g in group_members:
                if existing_g.casefold() == resolved_g.casefold():
                    target_g = existing_g
                    break
            group_members.setdefault(target_g, set()).add(resolved_u)

    parsed_groups = [
        ConfluenceGroup(name=gname, members=sorted(members))
        for gname, members in group_members.items()
        if gname
    ]

    parsed_users = [
        ConfluenceUserInfo(username=uname, email=email, display_name=display_name)
        for uname, (email, display_name) in user_info.items()
    ]

    # Resolve space permissions
    for (
        space_ref,
        perm_type,
        user_name,
        user_ref,
        group_name,
        group_ref,
    ) in space_permission_refs:
        resolved_user = _lookup_user(user_name, user_ref)
        resolved_group = _lookup_group(group_name, group_ref)
        if space_ref in spaces:
            spaces[space_ref].permissions.append(
                ConfluencePermission(
                    perm_type=perm_type,
                    user_name=resolved_user,
                    group_name=resolved_group,
                )
            )

    pages_by_source_id = {page.source_id: page for page in pages}

    # Resolve page content permissions (restrictions)
    for set_ref, perm_type, user_name, user_ref, group_name, group_ref in perm_refs:
        if set_ref in perm_sets:
            page_id, set_type = perm_sets[set_ref]
            resolved_type = perm_type or set_type
            resolved_user = _lookup_user(user_name, user_ref)
            resolved_group = _lookup_group(group_name, group_ref)
            target_page = pages_by_source_id.get(page_id)
            if target_page and target_page.space_id in spaces and (resolved_user or resolved_group):
                spaces[target_page.space_id].restrictions.append(
                    ConfluencePageRestriction(
                        page_id=page_id,
                        restriction_type=resolved_type,
                        user_name=resolved_user,
                        group_name=resolved_group,
                    )
                )

    for attachment_page_id in attachment_page_ids:
        attachment_page = pages_by_source_id.get(attachment_page_id)
        if attachment_page and attachment_page.space_id in spaces:
            spaces[attachment_page.space_id].attachment_count += 1
    for page in pages:
        if page.space_id in spaces:
            spaces[page.space_id].pages.append(page)

    sorted_spaces = sorted(spaces.values(), key=lambda item: item.key)
    return ConfluenceSpaceList(sorted_spaces, parsed_groups, parsed_users)


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


def iter_attachments(path: Path) -> Iterator[tuple[ConfluenceAttachment, str | None]]:
    """Yield attachment metadata with its ZIP member path, not its binary.

    The member path is ``None`` when ``entities.xml`` records the attachment
    but none of the naming conventions below find a matching entry in the
    ZIP - e.g. the export genuinely never bundled that file's binary (a
    known Confluence export limitation for very large attachments). Yielding
    it anyway (instead of dropping it, as this used to) lets the caller log
    which attachments it could not import instead of leaving a page's
    view-file reference resolving to nothing with no trace of why."""
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
        # One pass over the archive instead of one full scan per attachment: a
        # site export holds thousands of members and thousands of attachments,
        # and each attachment used to rescan every member up to twice - minutes
        # of silent CPU on a slow host, long enough to look like a dead worker.
        by_basename: dict[str, str] = {}
        by_directory: dict[str, list[str]] = {}
        for name in sorted(names):
            if name.endswith("/"):
                continue
            segments = name.split("/")
            by_basename.setdefault(segments[-1], name)
            for segment in segments[1:-1]:
                by_directory.setdefault(segment, []).append(name)
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
                candidate = by_basename.get(attachment.filename.rsplit("/", 1)[-1])
                if candidate is not None and candidate.endswith(f"/{attachment.filename}"):
                    entry = candidate
            if entry is None:
                # Confluence exports may store attachments by version number
                # without the filename in the path (e.g. attachments/.../12345/1)
                versions = list(by_directory.get(attachment.source_id, ()))
                if versions:
                    with suppress(ValueError):
                        versions.sort(key=lambda x: int(x.split("/")[-1]))
                    entry = versions[-1]
            yield attachment, entry
