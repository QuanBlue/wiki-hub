"""One-off backfill: replace fabricated `@imported.confluence` emails with the
real address/display name recorded in the archive's own Confluence user
directory, for users the importer already created before that directory was
read.

Run once from inside the backend container:

    python scripts/backfill_confluence_emails.py <archive_id>

Safe to re-run: only touches users whose email still ends with the
placeholder suffix, and skips (reporting) any username the directory has no
entry for, or whose real email collides with an existing account.
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
import uuid
from pathlib import Path

from sqlalchemy import func, select

from app.db.session import session_scope
from app.models.import_job import ImportArchive
from app.models.user import User
from app.modules.import_export.confluence import scan_archive
from app.services.storage import get_storage

PLACEHOLDER_SUFFIX = "@imported.confluence"


async def main(archive_id: uuid.UUID) -> None:
    storage = get_storage()
    async with session_scope() as session:
        archive = await session.get(ImportArchive, archive_id)
        if archive is None:
            print(f"No such import archive: {archive_id}")
            return

        with tempfile.TemporaryDirectory(prefix="wikihub-email-backfill-") as tmp:
            path = Path(tmp) / "archive.zip"
            await storage.download_to_file(archive.object_key, str(path))
            scanned = await asyncio.to_thread(scan_archive, path)

        directory = {
            info.username.strip().lower(): (info.email, info.display_name)
            for info in scanned.users
            if info.username
        }
        print(f"Archive user directory: {len(directory)} accounts with email/display name.")

        placeholder_users = (
            (
                await session.execute(
                    select(User).where(User.email.ilike(f"%{PLACEHOLDER_SUFFIX}"))
                )
            )
            .scalars()
            .all()
        )
        print(f"Users still on the placeholder email: {len(placeholder_users)}.")

        updated = 0
        no_directory_entry: list[str] = []
        conflicts: list[str] = []
        for user in placeholder_users:
            info = directory.get(user.username.strip().lower())
            if not info or not info[0]:
                no_directory_entry.append(user.username)
                continue
            email, display_name = info
            conflict = await session.scalar(
                select(User.id).where(
                    func.lower(User.email) == email.lower(), User.id != user.id
                )
            )
            if conflict:
                conflicts.append(f"{user.username} -> {email}")
                continue
            user.email = email
            if display_name and user.full_name == user.username:
                user.full_name = display_name
            updated += 1

        print(f"Updated: {updated}")
        if no_directory_entry:
            print(f"No directory entry ({len(no_directory_entry)}): {sorted(no_directory_entry)}")
        if conflicts:
            print(f"Skipped - email already in use ({len(conflicts)}): {conflicts}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python scripts/backfill_confluence_emails.py <archive_id>")
        raise SystemExit(2)
    asyncio.run(main(uuid.UUID(sys.argv[1])))
