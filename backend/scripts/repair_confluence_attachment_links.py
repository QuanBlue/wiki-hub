"""One-off repair: resolve dead ``#attachment-<filename>`` hrefs left behind
by the Confluence importer's view-file/viewdoc macro handler whenever its
filename lookup missed a real attachment purely because of a cosmetic
mismatch - case, incidental whitespace, or an HTML-entity-escaped character
surviving an ``<ac:parameter>`` text node. See the tolerant matching added in
``_resolve_attachment_url`` (``app/modules/import_export/service.py``) and
its regression test in ``tests/unit/test_confluence_importer.py`` - that fix
only prevents the problem on *future* imports; a page imported before it
existed can still have the dead anchor baked into its stored content even
though the attachment itself uploaded fine and is sitting right there.

This script re-resolves each dead link against the attachments actually
stored for that page (falling back to any page in the same space, mirroring
the importer's own cross-page fallback) and rewrites the href to the real
``/api/v1/attachments/{id}/content`` URL that the editor's attachment node
expects.

Run once from inside the backend container:

    python scripts/repair_confluence_attachment_links.py

Safe to re-run: only pages whose content still contains a `#attachment-` href
are touched, and a link left unresolved (no matching attachment anywhere in
the space) is reported but not modified.
"""

from __future__ import annotations

import asyncio
import html
import sys
from pathlib import Path
from urllib.parse import unquote

from bs4 import BeautifulSoup
from sqlalchemy import select

# Running this file directly (`python scripts/repair_confluence_attachment_links.py`)
# puts `scripts/`, not the project root, on `sys.path` - add the root so `app.*`
# resolves regardless of the current working directory.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.session import session_scope
from app.models.attachment import PageAttachment
from app.models.page import WikiPage

DEAD_HREF_PREFIX = "#attachment-"


def _normalize(filename: str) -> str:
    return html.unescape(unquote(filename)).strip().lower()


async def main() -> None:
    async with session_scope() as session:
        pages = (
            (
                await session.execute(
                    select(WikiPage).where(WikiPage.content.contains(DEAD_HREF_PREFIX))
                )
            )
            .scalars()
            .all()
        )

        if not pages:
            print("No pages with a dead #attachment- link found.")
            return

        fixed = 0
        unresolved: list[str] = []
        space_attachment_cache: dict[str, list[PageAttachment]] = {}

        for page in pages:
            soup = BeautifulSoup(page.content, "html.parser")
            dead_links = [
                a
                for a in soup.find_all("a", href=True)
                if a["href"].startswith(DEAD_HREF_PREFIX)
            ]
            if not dead_links:
                continue

            same_page = (
                (
                    await session.execute(
                        select(PageAttachment).where(PageAttachment.page_id == page.id)
                    )
                )
                .scalars()
                .all()
            )
            by_name = {_normalize(a.filename): a for a in same_page}

            changed = False
            for link in dead_links:
                filename = link["href"][len(DEAD_HREF_PREFIX) :]
                key = _normalize(filename)
                attachment = by_name.get(key)
                if attachment is None:
                    space_key = str(page.space_id)
                    if space_key not in space_attachment_cache:
                        space_attachment_cache[space_key] = (
                            (
                                await session.execute(
                                    select(PageAttachment)
                                    .join(WikiPage, WikiPage.id == PageAttachment.page_id)
                                    .where(WikiPage.space_id == page.space_id)
                                )
                            )
                            .scalars()
                            .all()
                        )
                    attachment = next(
                        (
                            a
                            for a in space_attachment_cache[space_key]
                            if _normalize(a.filename) == key
                        ),
                        None,
                    )
                if attachment is None:
                    unresolved.append(f"{page.id} ({page.title!r}): {filename}")
                    continue
                link["href"] = f"/api/v1/attachments/{attachment.id}/content"
                changed = True

            if changed:
                page.content = str(soup)
                fixed += 1

        print(f"Pages with a dead #attachment- link: {len(pages)}")
        print(f"Pages fixed: {fixed}")
        if unresolved:
            print(
                f"Still unresolved ({len(unresolved)}) - no matching attachment "
                "found anywhere in the space:"
            )
            for line in unresolved:
                print(f"  {line}")


if __name__ == "__main__":
    asyncio.run(main())
