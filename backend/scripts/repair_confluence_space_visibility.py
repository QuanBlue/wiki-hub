"""One-off repair: recompute space visibility from the archive's own
permissions, for spaces the importer already created with the
``_space_has_public_view`` bug (see the regression tests next to it in
``tests/unit/test_confluence_importer.py``).

That bug treated a permission naming a specific user (no group) the same as
a true anonymous/"Anyone can view" entry, because ``(None or "")`` collapsed
to the same sentinel the public-group check used. Since almost every
Confluence space grants its own admin a named VIEWSPACE permission, nearly
every imported space ended up "open" - visible to every signed-in WikiHub
user - regardless of the space's actual per-group restrictions.

Run once from inside the backend container:

    python scripts/repair_confluence_space_visibility.py <archive_id>

Safe to re-run: recomputes from the archive every time and only writes a
row whose visibility actually needs to change.
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
import uuid
from pathlib import Path

from sqlalchemy import select

from app.db.session import session_scope
from app.models.import_job import ImportArchive
from app.models.space import Space, SpaceVisibility
from app.modules.import_export.confluence import scan_archive
from app.modules.import_export.service import _is_invalid_import_username, _space_has_public_view
from app.services.storage import get_storage


async def main(archive_id: uuid.UUID) -> None:
    storage = get_storage()
    async with session_scope() as session:
        archive = await session.get(ImportArchive, archive_id)
        if archive is None:
            print(f"No such import archive: {archive_id}")
            return

        with tempfile.TemporaryDirectory(prefix="wikihub-visibility-repair-") as tmp:
            path = Path(tmp) / "archive.zip"
            await storage.download_to_file(archive.object_key, str(path))
            scanned = await asyncio.to_thread(scan_archive, path)

        correct_visibility: dict[str, SpaceVisibility] = {}
        for source_space in scanned:
            public_view = _space_has_public_view(source_space.permissions)

            # Mirrors run_import()'s own user_roles construction exactly, since
            # is_restricted depends on whether it ends up non-empty.
            user_roles: dict[str, str] = {}
            for perm in source_space.permissions:
                if not perm.user_name:
                    continue
                username_clean = perm.user_name.strip().lower()
                if _is_invalid_import_username(username_clean):
                    continue
                if perm.perm_type in {"SETSPACEPERMISSIONS", "ADMINISTERSPACE", "SPACEADMIN", "ADMINISTER"}:
                    user_roles[username_clean] = "admin"
                elif perm.perm_type in {"EDITSPACE", "CREATEPAGE", "REMOVEPAGE", "EDITBLOG"}:
                    user_roles.setdefault(username_clean, "editor")
                elif perm.perm_type == "VIEWSPACE":
                    user_roles.setdefault(username_clean, "viewer")

            is_restricted = not public_view and (
                bool(user_roles) or any(p.group_name for p in source_space.permissions)
            )
            correct_visibility[source_space.key] = (
                SpaceVisibility.restricted if is_restricted else SpaceVisibility.open
            )

        spaces = (await session.execute(select(Space))).scalars().all()
        changed: list[str] = []
        unmatched: list[str] = []
        for space in spaces:
            target = correct_visibility.get(space.key)
            if target is None:
                unmatched.append(space.key)
                continue
            if space.visibility != target:
                changed.append(f"{space.key} ({space.visibility} -> {target})")
                space.visibility = target

        print(f"Spaces in archive: {len(correct_visibility)}")
        print(f"Spaces in database: {len(spaces)}")
        print(f"Changed: {len(changed)}")
        for line in changed:
            print(f"  {line}")
        if unmatched:
            print(
                f"Not in this archive, left untouched ({len(unmatched)}): {sorted(unmatched)}"
            )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python scripts/repair_confluence_space_visibility.py <archive_id>")
        raise SystemExit(2)
    asyncio.run(main(uuid.UUID(sys.argv[1])))
