"""Only files a page really carries are imported: not deleted ones, and not the
earlier versions of a re-uploaded file."""

from __future__ import annotations

import zipfile

from app.modules.import_export.confluence import iter_attachments, scan_archive

_ENTITIES = """
<root>
  <object class="Space"><id>s1</id><property name="key">ENG</property><property name="name">Engineering</property></object>
  <object class="Page"><id>p1</id><property name="title">Home</property><property name="space"><id>s1</id></property><property name="contentStatus">current</property></object>
  <object class="Attachment"><id>a3</id><property name="title">spec.docx</property><property name="contentStatus">current</property><property name="containerContent"><id>p1</id></property></object>
  <object class="Attachment"><id>a1</id><property name="title">spec.docx</property><property name="contentStatus">current</property><property name="containerContent"><id>p1</id></property><property name="originalVersion"><id>a3</id></property></object>
  <object class="Attachment"><id>a2</id><property name="title">spec.docx</property><property name="contentStatus">current</property><property name="containerContent"><id>p1</id></property><property name="originalVersion"><id>a3</id></property></object>
  <object class="Attachment"><id>a4</id><property name="title">old.png</property><property name="contentStatus">deleted</property><property name="containerContent"><id>p1</id></property></object>
  <object class="Attachment"><id>a5</id><property name="title">bin.zip</property><property name="contentStatus">trashed</property><property name="containerContent"><id>p1</id></property></object>
</root>
"""


def _archive(tmp_path):
    path = tmp_path / "export.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("entities.xml", _ENTITIES)
        # Every version of a re-uploaded file is stored under the newest row's id.
        archive.writestr("attachments/p1/a3/1", b"v1")
        archive.writestr("attachments/p1/a3/2", b"v2")
        archive.writestr("attachments/p1/a3/10", b"v10")
        archive.writestr("attachments/p1/a4/1", b"deleted but still bundled")
    return path


def test_only_the_newest_row_of_a_live_file_is_imported_with_its_latest_version(tmp_path):
    found = {item.source_id: entry for item, entry in iter_attachments(_archive(tmp_path))}

    # Old-version rows (a1, a2) and deleted/trashed rows (a4, a5) are not yielded at all -
    # in particular no "missing from the export" warning is produced for them.
    assert found == {"a3": "attachments/p1/a3/10"}


def test_space_attachment_counts_ignore_deleted_and_historical_rows(tmp_path):
    spaces = scan_archive(_archive(tmp_path))

    assert spaces[0].attachment_count == 1
