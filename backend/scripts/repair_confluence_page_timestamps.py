"""One-off repair: recompute page and space timestamps from Confluence export archives.

This repairs pages whose created_at and updated_at were set to the import timestamp
because entities.xml serializes dates inside composite <property> tags with child <date> elements.

Run once from inside the backend container:

    python scripts/repair_confluence_page_timestamps.py [archive_id]

If archive_id is omitted, all Confluence import archives will be processed.
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
import uuid
from pathlib import Path

from sqlalchemy import select, text

from app.db.session import session_scope
from app.models.import_job import ImportArchive
from app.models.page import WikiPage
from app.models.space import Space
from app.modules.import_export.confluence import scan_archive
from app.services.storage import get_storage


async def repair_archive(session, storage, archive: ImportArchive) -> tuple[int, int]:
    print(f"--> Processing archive: {archive.filename} (ID: {archive.id})")
    with tempfile.TemporaryDirectory(prefix="wikihub-timestamp-repair-") as tmp:
        path = Path(tmp) / "archive.zip"
        await storage.download_to_file(archive.object_key, str(path))
        scanned = await asyncio.to_thread(scan_archive, path)

    pages_repaired = 0
    spaces_repaired = 0

    for source_space in scanned:
        space = (
            await session.execute(
                select(Space).where(Space.key == source_space.key)
            )
        ).scalar_one_or_none()
        if not space:
            continue

        if source_space.created_at and space.created_at != source_space.created_at:
            await session.execute(
                text("UPDATE spaces SET created_at = :ca WHERE id = :id"),
                {"ca": source_space.created_at, "id": space.id},
            )
            spaces_repaired += 1

        db_pages = (
            await session.execute(
                select(WikiPage).where(WikiPage.space_id == space.id)
            )
        ).scalars().all()
        pages_by_title = {p.title.casefold(): p for p in db_pages}

        for source_page in source_space.pages:
            db_page = pages_by_title.get(source_page.title.casefold())
            if not db_page:
                continue

            target_created = source_page.created_at
            target_updated = source_page.updated_at or target_created

            needs_update = False
            params: dict = {"id": db_page.id}
            set_clauses = []

            if target_created and db_page.created_at != target_created:
                set_clauses.append("created_at = :ca")
                params["ca"] = target_created
                needs_update = True

            if target_updated and db_page.updated_at != target_updated:
                set_clauses.append("updated_at = :ua")
                params["ua"] = target_updated
                needs_update = True

            if needs_update and set_clauses:
                query = f"UPDATE pages SET {', '.join(set_clauses)} WHERE id = :id"
                await session.execute(text(query), params)
                pages_repaired += 1

    await session.commit()
    return spaces_repaired, pages_repaired


async def main(archive_id: uuid.UUID | None = None) -> None:
    storage = get_storage()
    async with session_scope() as session:
        if archive_id:
            archive = await session.get(ImportArchive, archive_id)
            if not archive:
                print(f"No such import archive: {archive_id}")
                return
            archives = [archive]
        else:
            archives = (
                await session.execute(
                    select(ImportArchive).order_by(ImportArchive.created_at.desc())
                )
            ).scalars().all()

        if not archives:
            print("No import archives found.")
            return

        total_spaces = 0
        total_pages = 0
        for arch in archives:
            try:
                sp_count, pg_count = await repair_archive(session, storage, arch)
                total_spaces += sp_count
                total_pages += pg_count
                print(f"Repaired {sp_count} spaces and {pg_count} pages for archive {arch.id}")
            except Exception as exc:
                print(f"Failed repairing archive {arch.id}: {exc}")

        print(f"\nCompleted! Total repaired: {total_spaces} spaces, {total_pages} pages.")


if __name__ == "__main__":
    arg = uuid.UUID(sys.argv[1]) if len(sys.argv) > 1 else None
    asyncio.run(main(arg))
