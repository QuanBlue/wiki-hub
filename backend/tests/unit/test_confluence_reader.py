from __future__ import annotations

import zipfile
from pathlib import Path

from app.modules.import_export.confluence import scan_archive


def test_scan_archive_retains_confluence_page_timestamps(tmp_path: Path) -> None:
    archive_path = tmp_path / "confluence.zip"
    entities = """<hibernate-generic>
  <object class="Space"><id>1</id><property name="key">ENG</property><property name="name">Engineering</property></object>
  <object class="Page"><id>2</id><property name="title">Release notes</property><property name="space"><id>1</id></property><property name="contentStatus">current</property><property name="creationDate">2024-01-02T03:04:05.000+07:00</property><property name="lastModificationDate">2025-06-07T08:09:10Z</property></object>
</hibernate-generic>"""
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("entities.xml", entities)

    page = scan_archive(archive_path)[0].pages[0]

    assert page.created_at is not None
    assert page.created_at.isoformat() == "2024-01-02T03:04:05+07:00"
    assert page.updated_at is not None
    assert page.updated_at.isoformat() == "2025-06-07T08:09:10+00:00"
