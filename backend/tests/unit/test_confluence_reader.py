from __future__ import annotations

import zipfile
from pathlib import Path

from app.modules.import_export.confluence import scan_archive


def test_scan_archive_retains_confluence_page_timestamps(tmp_path: Path) -> None:
    archive_path = tmp_path / "confluence.zip"
    entities = """<hibernate-generic>
  <object class="Space"><id>1</id><property name="key">ENG</property><property name="name">Engineering</property></object>
  <object class="Page"><id>2</id><property name="title">Release notes</property><property name="space"><id>1</id></property><property name="contentStatus">current</property><property name="creationDate">2024-01-02T03:04:05.000+07:00</property><property name="lastModificationDate">2025-06-07T08:09:10Z</property><property name="creatorName">quannt39</property><property name="lastModifierName">quannt39_modifier</property></object>
</hibernate-generic>"""
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("entities.xml", entities)

    page = scan_archive(archive_path)[0].pages[0]

    assert page.created_at is not None
    assert page.created_at.isoformat() == "2024-01-02T03:04:05+07:00"
    assert page.updated_at is not None
    assert page.updated_at.isoformat() == "2025-06-07T08:09:10+00:00"
    assert page.creator == "quannt39"
    assert page.last_modifier == "quannt39_modifier"


def test_scan_archive_resolves_referenced_users(tmp_path: Path) -> None:
    archive_path = tmp_path / "confluence.zip"
    entities = """<hibernate-generic>
  <object class="Space"><id>1</id><property name="key">ENG</property><property name="name">Engineering</property></object>
  <object class="Page">
    <id>2</id>
    <property name="title">Release notes</property>
    <property name="space"><id>1</id></property>
    <property name="contentStatus">current</property>
    <property name="creator"><id>user123</id></property>
    <property name="lastModifier"><id>user456</id></property>
  </object>
  <object class="ConfluenceUserImpl">
    <id>user123</id>
    <property name="name">referenced_creator</property>
  </object>
  <object class="ConfluenceUserImpl">
    <id>user456</id>
    <property name="name">referenced_modifier</property>
  </object>
</hibernate-generic>"""
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("entities.xml", entities)

    page = scan_archive(archive_path)[0].pages[0]

    assert page.creator == "referenced_creator"
    assert page.last_modifier == "referenced_modifier"

