from __future__ import annotations

import zipfile

import pytest

from app.core.exceptions import BadRequestError
from app.modules.import_export.confluence import iter_attachments, iter_page_bodies, scan_archive

XML = """<root>
<object class="ConfluenceUserImpl"><id>u1</id><property name="name">alice</property></object>
<object class="Space"><id>s1</id><property name="key">ENG</property><property name="name">Engineering</property></object>
<object class="Page"><id>p1</id><property name="title">ENG</property><property name="space"><id>s1</id></property><property name="contentStatus">current</property><property name="creator"><id>u1</id></property><property name="creationDate">2024-01-01T10:00:00Z</property></object>
<object class="Page"><id>p2</id><property name="title">Guide</property><property name="space"><id>s1</id></property><property name="parent"><id>p1</id></property><property name="contentStatus">current</property><property name="creatorName">bob</property><property name="lastModifierName">alice</property><property name="lastModificationDate">bad-date</property></object>
<object class="Page"><id>p3</id><property name="title">Direct author</property><property name="space"><id>s1</id></property><property name="contentStatus">current</property><property name="creator">carol</property><property name="lastModifier">dave</property></object>
<object class="Page"><id>old</id><property name="title">Old</property><property name="space"><id>s1</id></property><property name="contentStatus">draft</property></object>
<object class="BodyContent"><property name="content"><id>p2</id></property><property name="body"><![CDATA[<p>Guide</p>]]></property></object>
<object class="Attachment"><id>a1</id><property name="title">manual.pdf</property><property name="containerContent"><id>p2</id></property><property name="contentType">application/pdf</property></object>
</root>"""


def _archive(tmp_path):
    path = tmp_path / "export.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("entities.xml", XML)
        archive.writestr("attachments/a1/manual.pdf", b"pdf")
    return path


def test_scan_and_iterate_confluence_archive(tmp_path):
    path = _archive(tmp_path)
    spaces = scan_archive(path)
    assert len(spaces) == 1
    assert spaces[0].key == "ENG" and spaces[0].attachment_count == 1
    assert [page.title for page in spaces[0].pages] == ["ENG", "Guide", "Direct author"]
    assert spaces[0].pages[0].creator == "alice"
    assert spaces[0].pages[2].creator == "carol"
    assert spaces[0].pages[2].last_modifier == "dave"
    assert list(iter_page_bodies(path)) == [("p2", "<p>Guide</p>")]
    attachments = list(iter_attachments(path))
    assert attachments[0][0].filename == "manual.pdf"
    assert attachments[0][1] == "attachments/a1/manual.pdf"


SPACE_METADATA_XML = """<root>
<object class="ConfluenceUserImpl"><id>u1</id><property name="name">alice</property></object>
<object class="Space"><id>s1</id><property name="key">ENG</property><property name="name">Engineering</property><property name="creationDate">2020-03-04T09:00:00Z</property><property name="creator"><id>u1</id></property></object>
<object class="Space"><id>s2</id><property name="key">OPS</property><property name="name">Operations</property><property name="creationDate">2021-05-06T09:00:00Z</property><property name="creatorName">bob</property></object>
<object class="Space"><id>s3</id><property name="key">HR</property><property name="name">HR</property></object>
</root>"""


def test_scan_confluence_space_creator_and_creation_date(tmp_path):
    path = tmp_path / "export.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("entities.xml", SPACE_METADATA_XML)

    spaces = {space.key: space for space in scan_archive(path)}

    # A reference to a User object elsewhere in the export resolves to a
    # username, same as it does for a page's creator.
    assert spaces["ENG"].creator == "alice"
    assert spaces["ENG"].created_at is not None
    assert spaces["ENG"].created_at.year == 2020

    # The compact form (the username inline, no separate User object) also
    # resolves without going through the reference lookup.
    assert spaces["OPS"].creator == "bob"
    assert spaces["OPS"].created_at.year == 2021

    # A single-space content export commonly omits both altogether - the
    # importer must fall back to the importing user, not crash.
    assert spaces["HR"].creator is None
    assert spaces["HR"].created_at is None


def test_confluence_reader_reports_invalid_archives(tmp_path):
    bad = tmp_path / "bad.zip"
    bad.write_bytes(b"not zip")
    with pytest.raises(BadRequestError):
        scan_archive(bad)
    empty = tmp_path / "empty.zip"
    with zipfile.ZipFile(empty, "w"):
        pass
    with pytest.raises(BadRequestError):
        scan_archive(empty)
    with pytest.raises(BadRequestError):
        list(iter_page_bodies(empty))


XML_GROUPS_AND_RESTRICTIONS = """<root>
<object class="ConfluenceUserImpl"><id>u1</id><property name="name">alice</property></object>
<object class="ConfluenceUserImpl"><id>u2</id><property name="name">bob</property></object>
<object class="Group"><id>g1</id><property name="name">developers</property></object>
<object class="Membership"><property name="group"><id>g1</id></property><property name="user"><id>u1</id></property></object>
<object class="Membership"><property name="groupName">developers</property><property name="userName">bob</property></object>
<object class="Space"><id>s1</id><property name="key">DEV</property><property name="name">Development</property></object>
<object class="SpacePermission"><property name="space"><id>s1</id></property><property name="type">VIEWSPACE</property><property name="group">developers</property></object>
<object class="Page"><id>p1</id><property name="title">Secret Spec</property><property name="space"><id>s1</id></property><property name="contentStatus">current</property></object>
<object class="ContentPermissionSet"><id>cps1</id><property name="type">view</property><property name="owningContent"><id>p1</id></property></object>
<object class="ContentPermission"><property name="owningSet"><id>cps1</id></property><property name="userName">alice</property></object>
</root>"""


def test_scan_confluence_archive_with_groups_and_restrictions(tmp_path):
    path = tmp_path / "groups_export.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("entities.xml", XML_GROUPS_AND_RESTRICTIONS)
    spaces = scan_archive(path)
    assert len(spaces) == 1
    assert spaces[0].key == "DEV"
    assert len(spaces.groups) == 1
    assert spaces.groups[0].name == "developers"
    assert sorted(spaces.groups[0].members) == ["alice", "bob"]
    assert len(spaces[0].permissions) == 1
    assert spaces[0].permissions[0].group_name == "developers"
    assert len(spaces[0].restrictions) == 1
    assert spaces[0].restrictions[0].page_id == "p1"
    assert spaces[0].restrictions[0].user_name == "alice"
    assert spaces[0].restrictions[0].restriction_type == "view"


XML_CROWD_MEMBERSHIPS = """<root>
<object class="InternalDirectoryUser"><id>u10</id><property name="name">anhdt187</property></object>
<object class="InternalDirectoryUser"><id>u20</id><property name="name">anpb7</property></object>
<object class="InternalDirectoryGroup"><id>g10</id><property name="name">confluence-users</property></object>
<object class="InternalDirectoryMembership" package="com.atlassian.crowd.model.membership">
  <id>m1</id>
  <property name="membershipType">GROUP_USER</property>
  <property name="parentName">confluence-users</property>
  <property name="childName">anhdt187</property>
</object>
<object class="InternalDirectoryMembership">
  <id>m2</id>
  <property name="lowerParentName">confluence-users</property>
  <property name="lowerChildName">anpb7</property>
</object>
<object class="Space"><id>s10</id><property name="key">TEST</property><property name="name">Test Space</property></object>
</root>"""


def test_scan_confluence_crowd_internal_directory_memberships(tmp_path):
    path = tmp_path / "crowd_export.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("entities.xml", XML_CROWD_MEMBERSHIPS)
    spaces = scan_archive(path)
    assert len(spaces) == 1
    assert len(spaces.groups) == 1
    assert spaces.groups[0].name == "confluence-users"
    assert sorted(spaces.groups[0].members) == ["anhdt187", "anpb7"]


XML_USERKEY_MEMBERSHIPS = """<root>
<object class="ConfluenceUserImpl">
  <id>u100</id>
  <property name="key">2c91808465fb1234567890abcdef1234</property>
  <property name="name">anhdt187</property>
  <property name="lowerName">anhdt187</property>
</object>
<object class="InternalDirectoryGroup"><id>g100</id><property name="name">dms4_mem</property></object>
<object class="InternalDirectoryMembership">
  <property name="parentName">dms4_mem</property>
  <property name="childName">2c91808465fb1234567890abcdef1234</property>
</object>
<object class="Space"><id>s100</id><property name="key">DMS4</property><property name="name">DMS4 Space</property></object>
</root>"""


def test_scan_confluence_userkey_memberships(tmp_path):
    path = tmp_path / "userkey_export.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("entities.xml", XML_USERKEY_MEMBERSHIPS)
    spaces = scan_archive(path)
    assert len(spaces) == 1
    assert len(spaces.groups) == 1
    assert spaces.groups[0].name == "dms4_mem"
    assert spaces.groups[0].members == ["anhdt187"]


XML_HIBERNATE_MEMBERSHIPS = """<root>
<object class="InternalUser" package="com.atlassian.crowd.model.user">
  <id name="id">229377</id>
  <property name="name">thongnm1</property>
  <property name="lowerName">thongnm1</property>
</object>
<object class="InternalGroup" package="com.atlassian.crowd.model.group">
  <id name="id">163842</id>
  <property name="name">confluence-users</property>
  <property name="lowerName">confluence-users</property>
</object>
<object class="HibernateMembership" package="com.atlassian.crowd.embedded.hibernate2">
  <id name="id">294913</id>
  <property name="parentGroup" class="InternalGroup" package="com.atlassian.crowd.model.group"><id name="id">163842</id></property>
  <property name="userMember" class="InternalUser" package="com.atlassian.crowd.model.user"><id name="id">229377</id></property>
</object>
<object class="Space"><id>s200</id><property name="key">TEST2</property><property name="name">Test Space 2</property></object>
</root>"""


def test_scan_confluence_hibernate_memberships(tmp_path):
    path = tmp_path / "hibernate_export.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("entities.xml", XML_HIBERNATE_MEMBERSHIPS)
    spaces = scan_archive(path)
    assert len(spaces) == 1
    assert len(spaces.groups) == 1
    assert spaces.groups[0].name == "confluence-users"
    assert spaces.groups[0].members == ["thongnm1"]


def test_scan_names_the_mistake_when_given_a_wikihub_backup(tmp_path):
    """The two import cards both take a `.zip`, so feeding one the other's
    archive is routine. Saying "does not contain entities.xml" is true and
    tells the user nothing about what to do next."""
    path = tmp_path / "wikihub-full-backup.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("manifest.json", "{}")
        archive.writestr("data/workspace.json", "{}")

    with pytest.raises(BadRequestError) as excinfo:
        scan_archive(path)
    assert "WikiHub backup" in str(excinfo.value)
    assert "Restore WikiHub Backup" in str(excinfo.value)
    assert excinfo.value.code == "wrong_archive_format"


def test_scan_keeps_the_generic_message_for_a_merely_broken_archive(tmp_path):
    """Only an archive recognisable as the *other* format gets redirected; a
    zip that is simply wrong must not be mislabelled as a WikiHub backup."""
    path = tmp_path / "nonsense.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("readme.txt", "not an export")

    with pytest.raises(BadRequestError) as excinfo:
        scan_archive(path)
    assert "entities.xml" in str(excinfo.value)
    assert "WikiHub backup" not in str(excinfo.value)
