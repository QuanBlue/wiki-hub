"""Confluence import orchestration shared by the API and ARQ worker."""

from __future__ import annotations

import html
import re
import tempfile
import urllib.parse
import uuid
import zipfile
from contextlib import suppress
from pathlib import Path

import anyio
from bs4 import BeautifulSoup
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError, ConflictError, NotFoundError, PayloadTooLargeError
from app.models.attachment import PageAttachment
from app.models.import_job import ImportArchive, ImportJob, ImportLog
from app.models.page import WikiPage
from app.models.space import Space, SpaceMember, SpaceRole
from app.modules.import_export.confluence import iter_attachments, iter_page_bodies, scan_archive
from app.services.storage import ObjectStorage


class ImportCancelled(Exception):
    """Raised when an import job is cancelled by an administrator."""


def _slug(value: str, occupied: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:240] or "page"
    candidate, suffix = base, 2
    while candidate in occupied:
        candidate = f"{base[: 240 - len(str(suffix)) - 1]}-{suffix}"
        suffix += 1
    occupied.add(candidate)
    return candidate


def _link_imported_attachments(
    content: str,
    source_page_id: str,
    urls: dict[tuple[str, str], str],
    title_to_page_id: dict[str, str],
) -> str:
    """Turn Confluence attachment/image macros and raw URLs into usable WikiHub HTML."""
    if not urls:
        return content
    soup = BeautifulSoup(content, "html.parser")
    
    # 1. Resolve <ac:image> macros
    for macro in soup.find_all("ac:image"):
        attachment = macro.find("ri:attachment")
        filename = attachment.get("ri:filename") if attachment else None
        if not isinstance(filename, str):
            continue
            
        # Determine referenced page_id
        page_ref = macro.find("ri:page")
        ref_title = page_ref.get("ri:content-title") if page_ref else None
        target_page_id = title_to_page_id.get(ref_title) if ref_title else source_page_id
        
        url = urls.get((target_page_id, filename))
        if not url:
            # Fallback: try case-insensitive or space-replace matches
            url = urls.get((target_page_id, filename.replace("+", " ")))
        if not url:
            # Fallback: find any matching filename in urls
            url = next((u for (pid, fn), u in urls.items() if fn == filename or fn == filename.replace("+", " ")), None)
            
        if url:
            image = soup.new_tag("img", src=url, alt=filename)
            # Preserve width/height attributes if specified on ac:image
            for attr in ("width", "height", "ac:width", "ac:height"):
                val = macro.get(attr)
                if val:
                    image[attr.replace("ac:", "")] = val
            macro.replace_with(image)
            
    # 2. Resolve <ac:link> macros
    for macro in soup.find_all("ac:link"):
        attachment = macro.find("ri:attachment")
        filename = attachment.get("ri:filename") if attachment else None
        if not isinstance(filename, str):
            continue
            
        # Determine referenced page_id
        page_ref = macro.find("ri:page")
        ref_title = page_ref.get("ri:content-title") if page_ref else None
        target_page_id = title_to_page_id.get(ref_title) if ref_title else source_page_id
        
        url = urls.get((target_page_id, filename))
        if not url:
            # Fallback: try case-insensitive or space-replace matches
            url = urls.get((target_page_id, filename.replace("+", " ")))
        if not url:
            # Fallback: find any matching filename in urls
            url = next((u for (pid, fn), u in urls.items() if fn == filename or fn == filename.replace("+", " ")), None)
            
        if url:
            link = soup.new_tag("a", href=url)
            link.string = macro.get_text(" ", strip=True) or filename
            macro.replace_with(link)
            
    result = str(soup)
    
    # 3. Replace raw attachment URLs with query parameters or without
    # Regex to match "/download/attachments/{page_id}/{filename}" with optional query parameters
    def replace_url(match: re.Match) -> str:
        pid = match.group(1)
        # Unescape/url-decode the filename if it was encoded in the html
        fn = urllib.parse.unquote_plus(match.group(2))
        url = urls.get((pid, fn))
        if not url:
            # Fallback: find any matching filename in urls
            url = next((u for (p, f), u in urls.items() if f == fn), None)
        return url if url else match.group(0)
        
    result = re.sub(
        r"/download/attachments/(\d+)/([^?\"'\s>]+)(?:\?[^\"'\s>]*)?",
        replace_url,
        result
    )
    
    return result


def _normalize_confluence_code_macros(content: str) -> str:
    """Convert Confluence XML-style code macros into standard HTML <pre><code> blocks."""
    if "<ac:structured-macro" not in content:
        return content
        
    def replace_macro(match: re.Match) -> str:
        inner = match.group(1)
        
        # 1. Match code body inside ac:plain-text-body
        code_match = re.search(
            r"<ac:plain-text-body\b[^>]*>([\s\S]*?)</ac:plain-text-body>",
            inner,
            re.IGNORECASE
        )
            
        if not code_match:
            return match.group(0)
            
        code_text = code_match.group(1)
        
        # Strip CDATA wrapper if present (handling spacing variations and HTML entities like ]] > or ]]> or ]]&gt;)
        cdata_start_match = re.match(r"^\s*<!\[CDATA\[", code_text, re.IGNORECASE)
        if cdata_start_match:
            code_text = re.sub(r"^\s*<!\[CDATA\[", "", code_text, count=1, flags=re.IGNORECASE)
            code_text = re.sub(r"\]\]\s*(?:>?|&gt;)\s*$", "", code_text, count=1, flags=re.IGNORECASE)
        
        # 2. Match language parameter
        lang_match = re.search(
            r"<ac:parameter\b[^>]*\bac:name=(?:\"language\"|'language')[^>]*>([\s\S]*?)</ac:parameter>",
            inner,
            re.IGNORECASE
        )
        language = ""
        if lang_match:
            language = re.sub(r"[^a-z0-9_-]", "", lang_match.group(1).strip().lower())
            
        # Escape the code content for HTML
        escaped_code = html.escape(code_text)
        
        class_attr = f' class="language-{language}"' if language else ''
        return f'<pre><code{class_attr}>{escaped_code}</code></pre>'

    return re.sub(
        r"<ac:structured-macro\b[^>]*\bac:name=(?:\"code\"|'code')[^>]*>([\s\S]*?)</ac:structured-macro>",
        replace_macro,
        content,
        flags=re.IGNORECASE
    )


class ConfluenceImportService:
    # S3 multipart uploads require every non-final part to be at least 5 MiB.
    # Eight MiB keeps retry costs reasonable without creating too many requests.
    upload_part_size_bytes = 8 * 1024 * 1024

    def __init__(self, session: AsyncSession, storage: ObjectStorage) -> None:
        self.session, self.storage = session, storage
        self._user_cache: dict[str, uuid.UUID] = {}

    async def _resolve_or_create_user(self, username: str) -> uuid.UUID:
        username_lower = username.lower()
        if username_lower in self._user_cache:
            return self._user_cache[username_lower]

        from app.models.user import User
        from sqlalchemy import func
        result = await self.session.execute(
            select(User).where(func.lower(User.username) == username_lower)
        )
        user = result.scalars().first()
        if user:
            self._user_cache[username_lower] = user.id
            return user.id

        new_user = User(
            username=username,
            email=f"{username}@imported.confluence",
            full_name=username,
            password_hash=None,
            is_active=True,
            is_superuser=False,
            is_protected=False,
        )
        self.session.add(new_user)
        await self.session.flush()
        self._user_cache[username_lower] = new_user.id
        return new_user.id

    async def find_reusable_archive(self, *, sha256: str, size_bytes: int) -> ImportArchive | None:
        archives = (
            await self.session.execute(
                select(ImportArchive)
                .where(
                    ImportArchive.sha256 == sha256,
                    ImportArchive.size_bytes == size_bytes,
                    ImportArchive.status.in_(["uploaded", "scanned"]),
                    ImportArchive.multipart_upload_id.is_(None),
                )
                .order_by(ImportArchive.updated_at.desc(), ImportArchive.created_at.desc())
                .limit(5)
            )
        ).scalars()
        for archive in archives:
            if await self.storage.exists(archive.object_key):
                return archive
        return None

    async def start_upload(
        self, *, filename: str, size_bytes: int, actor_id: uuid.UUID, sha256: str | None = None
    ) -> ImportArchive:
        if not filename.lower().endswith(".zip"):
            raise BadRequestError("Choose a .zip archive exported by Confluence.")
        from app.services.site_settings import SiteSettingsService

        limit = (
            await SiteSettingsService(self.session).get_effective()
        ).max_backup_import_size_bytes
        if size_bytes > limit:
            raise PayloadTooLargeError(
                f"Archive exceeds the configured {limit // (1024 * 1024)} MB limit."
            )
        if sha256:
            reusable = await self.find_reusable_archive(sha256=sha256, size_bytes=size_bytes)
            if reusable is not None:
                return reusable
        archive = ImportArchive(
            object_key=f"imports/confluence/{uuid.uuid4()}/{filename}",
            filename=filename,
            size_bytes=size_bytes,
            sha256=sha256,
            created_by_id=actor_id,
        )
        self.session.add(archive)
        await self.session.flush()
        archive.multipart_upload_id = await self.storage.start_multipart_upload(
            archive.object_key, content_type="application/zip"
        )
        await self.session.flush()
        return archive

    async def get_archive(self, archive_id: uuid.UUID) -> ImportArchive:
        archive = await self.session.get(ImportArchive, archive_id)
        if archive is None:
            raise NotFoundError("Import archive was not found.")
        if archive.spaces:
            existing = set((await self.session.execute(select(Space.key))).scalars())
            archive.spaces = [
                {
                    **item,
                    "conflict": item.get("key") in existing,
                }
                for item in archive.spaces
            ]
        return archive

    async def uploaded_part_numbers(self, archive: ImportArchive) -> list[int]:
        if not archive.multipart_upload_id:
            return []
        return [
            number
            for number, _etag in await self.storage.list_multipart_parts(
                archive.object_key, archive.multipart_upload_id
            )
        ]

    async def upload_part_urls(
        self, archive: ImportArchive, part_numbers: list[int]
    ) -> dict[int, str]:
        if archive.status != "uploading" or not archive.multipart_upload_id:
            raise ConflictError("This archive is not accepting upload parts.")
        return {
            part_number: await self.storage.presigned_upload_part_url(
                archive.object_key, archive.multipart_upload_id, part_number, expires_in=3600
            )
            for part_number in part_numbers
        }

    async def complete_upload(self, archive: ImportArchive) -> ImportArchive:
        if archive.status != "uploading" or not archive.multipart_upload_id:
            raise ConflictError("This archive upload has already completed.")
        parts = await self.storage.list_multipart_parts(
            archive.object_key, archive.multipart_upload_id
        )
        expected_parts = (
            archive.size_bytes + self.upload_part_size_bytes - 1
        ) // self.upload_part_size_bytes
        actual_parts = {number for number, _etag in parts}
        if actual_parts != set(range(1, expected_parts + 1)):
            raise BadRequestError("The archive upload is incomplete.")
        await self.storage.complete_multipart_upload(
            archive.object_key, archive.multipart_upload_id, parts
        )
        archive.multipart_upload_id = None
        archive.status = "uploaded"
        await self.session.flush()
        return archive

    async def abort_upload(self, archive: ImportArchive) -> None:
        if archive.multipart_upload_id:
            with suppress(NotFoundError):
                await self.storage.abort_multipart_upload(
                    archive.object_key, archive.multipart_upload_id
                )
        archive.multipart_upload_id = None
        archive.status = "cancelled"
        await self.session.flush()

    async def scan(self, archive: ImportArchive) -> ImportArchive:
        existing = set((await self.session.execute(select(Space.key))).scalars())
        if archive.status == "scanned" and archive.spaces:
            archive.spaces = [
                {
                    **item,
                    "conflict": item.get("key") in existing,
                }
                for item in archive.spaces
            ]
            archive.error = None
            await self.session.flush()
            return archive
        if not await self.storage.exists(archive.object_key):
            raise BadRequestError("The archive upload has not completed yet.")
        with tempfile.TemporaryDirectory(prefix="wikihub-confluence-scan-") as directory:
            path = Path(directory) / "archive.zip"
            await self.storage.download_to_file(archive.object_key, str(path))
            spaces = await anyio.to_thread.run_sync(scan_archive, path)
        archive.spaces = [
            {
                "key": item.key,
                "name": item.name,
                "page_count": len(item.pages),
                "attachment_count": item.attachment_count,
                "conflict": item.key in existing,
            }
            for item in spaces
        ]
        archive.status = "scanned"
        archive.error = None
        await self.session.flush()
        return archive

    async def create_job(
        self,
        archive: ImportArchive,
        *,
        import_all: bool,
        space_keys: list[str],
        overwrite_existing: bool,
        actor_id: uuid.UUID,
    ) -> ImportJob:
        if archive.status != "scanned":
            raise ConflictError("Wait until the archive scan finishes before starting import.")
        available = {item["key"] for item in archive.spaces}
        selected = sorted(set(space_keys))
        if not import_all and not selected:
            raise BadRequestError("Select at least one Space or choose Import all spaces.")
        if set(selected) - available:
            raise BadRequestError("One or more selected Space keys are not in this archive.")
        selected_keys = available if import_all else set(selected)
        selected_spaces = [item for item in archive.spaces if item["key"] in selected_keys]
        job = ImportJob(
            archive_id=archive.id,
            created_by_id=actor_id,
            import_all=import_all,
            space_keys=[] if import_all else selected,
            overwrite_existing=overwrite_existing,
            counters={
                "spaces_total": len(selected_spaces),
                "spaces_completed": 0,
                "pages_total": sum(int(item.get("page_count", 0)) for item in selected_spaces),
                "pages_processed": 0,
                "attachments_processed": 0,
                "downloaded_bytes": 0,
                "download_total_bytes": archive.size_bytes,
                "download_percent": 0,
            },
        )
        self.session.add(job)
        await self.session.flush()
        return job


async def log(
    session: AsyncSession,
    job: ImportJob,
    level: str,
    phase: str,
    message: str,
    *,
    entity_type: str | None = None,
    entity_label: str | None = None,
) -> ImportLog:
    entry = ImportLog(
        job_id=job.id,
        level=level,
        phase=phase,
        message=message,
        entity_type=entity_type,
        entity_label=entity_label,
    )
    session.add(entry)
    return entry


async def run_import(session: AsyncSession, storage: ObjectStorage, job_id: uuid.UUID) -> None:
    service = ConfluenceImportService(session, storage)
    job = await session.get(ImportJob, job_id)
    if job is None or job.status not in {"queued", "retrying"}:
        return
    archive = await session.get(ImportArchive, job.archive_id)
    if archive is None:
        return
    job.status, job.phase = "running", "downloading"
    download_log = await log(
        session, job, "info", "downloading", "Downloading archive to worker scratch space: 0%."
    )
    await session.commit()
    try:
        with tempfile.TemporaryDirectory(prefix="wikihub-confluence-import-") as directory:
            path = Path(directory) / "archive.zip"
            last_logged_tenth = 0

            async def record_download_progress(downloaded_bytes: int) -> None:
                nonlocal last_logged_tenth
                await session.refresh(job)
                if job.cancel_requested:
                    raise ImportCancelled("Import cancelled by administrator.")
                percent = min(100, int(downloaded_bytes * 100 / max(1, archive.size_bytes)))
                if percent == job.counters.get("download_percent", 0):
                    return
                job.counters = {
                    **job.counters,
                    "downloaded_bytes": min(downloaded_bytes, archive.size_bytes),
                    "download_total_bytes": archive.size_bytes,
                    "download_percent": percent,
                }
                if percent // 10 > last_logged_tenth:
                    last_logged_tenth = percent // 10
                    download_log.message = f"Downloading archive to worker scratch space: {percent}%."
                await session.commit()

            await storage.download_to_file(
                archive.object_key,
                str(path),
                on_progress=record_download_progress,
            )
            job.phase = "scanning"
            job.counters = {
                **job.counters,
                "downloaded_bytes": archive.size_bytes,
                "download_total_bytes": archive.size_bytes,
                "download_percent": 100,
            }
            await log(
                session, job, "info", "scanning", "Archive downloaded. Reading its space structure."
            )
            await session.commit()
            scanned = await anyio.to_thread.run_sync(scan_archive, path)
            selected = {space.key for space in scanned} if job.import_all else set(job.space_keys)
            job.phase = "importing"
            await log(
                session, job, "info", "importing", "Archive ready. Importing selected spaces."
            )
            await session.commit()
            imported_pages: dict[str, WikiPage] = {}
            source_pages_by_id: dict[str, ConfluencePage] = {}

            def restore_timestamps() -> None:
                for source_id, target_page in imported_pages.items():
                    src_page = source_pages_by_id.get(source_id)
                    if src_page:
                        if src_page.created_at:
                            target_page.created_at = src_page.created_at
                        if src_page.updated_at:
                            target_page.updated_at = src_page.updated_at
                        elif src_page.created_at:
                            target_page.updated_at = src_page.created_at
            for source_space in scanned:
                if source_space.key not in selected:
                    continue
                await session.refresh(job)
                if job.cancel_requested:
                    job.status, job.phase = "cancelled", "cancelled"
                    await log(
                        session, job, "warning", "cancelled", "Import cancelled by administrator."
                    )
                    await session.commit()
                    return
                existing = (
                    await session.execute(select(Space).where(Space.key == source_space.key))
                ).scalar_one_or_none()
                if existing:
                    if job.overwrite_existing:
                        await session.delete(existing)
                        await session.flush()
                        await log(
                            session,
                            job,
                            "warning",
                            "spaces",
                            "Existing space was replaced with the archive version.",
                            entity_type="space",
                            entity_label=source_space.key,
                        )
                    else:
                        job.counters = {
                            **job.counters,
                            "spaces_completed": job.counters.get("spaces_completed", 0) + 1,
                        }
                        await log(
                            session,
                            job,
                            "warning",
                            "spaces",
                            "Skipped: Space key already exists.",
                            entity_type="space",
                            entity_label=source_space.key,
                        )
                        await session.commit()
                        continue
                space = Space(
                    key=source_space.key, name=source_space.name, created_by_id=job.created_by_id
                )
                session.add(space)
                await session.flush()
                session.add(
                    SpaceMember(space_id=space.id, user_id=job.created_by_id, role=SpaceRole.admin)
                )
                pages: dict[str, WikiPage] = {}
                occupied: set[str] = set()
                for source_page in source_space.pages:
                    creator_id = (
                        await service._resolve_or_create_user(source_page.creator)
                        if source_page.creator
                        else job.created_by_id
                    )
                    last_modifier_id = (
                        await service._resolve_or_create_user(source_page.last_modifier)
                        if source_page.last_modifier
                        else creator_id
                    )
                    page = WikiPage(
                        space_id=space.id,
                        title=source_page.title,
                        slug=_slug(source_page.title, occupied),
                        created_by_id=creator_id,
                        updated_by_id=last_modifier_id,
                        content_format="html",
                    )
                    session.add(page)
                    pages[source_page.source_id] = page
                    imported_pages[source_page.source_id] = page
                    source_pages_by_id[source_page.source_id] = source_page
                await session.flush()

                # Confluence exports can contain several top-level pages. In
                # WikiHub every imported space has one stable home page so the
                # page tree has a single root. Prefer an exported page named
                # after the space; otherwise create a lightweight home page.
                root_source_pages = [
                    source_page
                    for source_page in source_space.pages
                    if not source_page.parent_id
                ]
                home_source = next(
                    (
                        source_page
                        for source_page in root_source_pages
                        if source_page.title.casefold()
                        in {source_space.key.casefold(), source_space.name.casefold()}
                    ),
                    None,
                )
                if home_source:
                    home_page = pages[home_source.source_id]
                else:
                    home_page = WikiPage(
                        space_id=space.id,
                        title=source_space.key,
                        slug=_slug(source_space.key, occupied),
                        created_by_id=job.created_by_id,
                        updated_by_id=job.created_by_id,
                        content_format="html",
                    )
                    session.add(home_page)
                    await session.flush()

                for source_page in source_space.pages:
                    parent = pages.get(source_page.parent_id or "")
                    if parent:
                        pages[source_page.source_id].parent_id = parent.id
                    # The home page is a navigation destination, not a
                    # container for imported content. Top-level Confluence
                    # pages stay at space level; only their own descendants
                    # retain the imported parent hierarchy.
                    elif pages[source_page.source_id].id != home_page.id:
                        pages[source_page.source_id].parent_id = None
                    imported_page = pages[source_page.source_id]
                    if source_page.created_at:
                        imported_page.created_at = source_page.created_at
                    if source_page.updated_at:
                        imported_page.updated_at = source_page.updated_at
                    elif source_page.created_at:
                        imported_page.updated_at = source_page.created_at
                await session.flush()
                # Bodies are streamed in a second pass; only selected page ids are retained.
                for page_source_id, html_content in await anyio.to_thread.run_sync(
                    lambda: list(iter_page_bodies(path))
                ):
                    body_page: WikiPage | None = pages.get(page_source_id)
                    if body_page:
                        body_page.content = _normalize_confluence_code_macros(html_content)
                count = len(pages)
                job.counters = {
                    **job.counters,
                    "spaces_completed": job.counters.get("spaces_completed", 0) + 1,
                    "pages_processed": job.counters.get("pages_processed", 0) + count,
                }
                await log(
                    session,
                    job,
                    "info",
                    "spaces",
                    f"Imported {count} current pages.",
                    entity_type="space",
                    entity_label=space.key,
                )
                restore_timestamps()
                await session.commit()
            attachments_imported = 0
            attachment_urls: dict[tuple[str, str], str] = {}
            attachment_sources = await anyio.to_thread.run_sync(
                lambda: list(iter_attachments(path))
            )
            with zipfile.ZipFile(path) as source_archive:
                for source_attachment, archive_member in attachment_sources:
                    target_page = imported_pages.get(source_attachment.page_id)
                    if target_page is None:
                        continue
                    attachment = PageAttachment(
                        page_id=target_page.id,
                        filename=source_attachment.filename[:255],
                        content_type=source_attachment.content_type[:255],
                        object_key="",
                    )
                    session.add(attachment)
                    await session.flush()
                    attachment.object_key = (
                        f"attachments/{target_page.id}/{attachment.id}/{source_attachment.filename}"
                    )
                    with source_archive.open(archive_member) as binary:
                        await storage.put(
                            attachment.object_key,
                            binary,
                            content_type=attachment.content_type,
                            metadata={"source": "confluence-import"},
                        )
                    attachment_urls[(source_attachment.page_id, source_attachment.filename)] = (
                        f"/api/v1/attachments/{attachment.id}/content"
                    )
                    attachments_imported += 1
            if attachment_urls:
                title_to_page_id = {page.title: pid for pid, page in imported_pages.items()}
                for source_page_id, target_page in imported_pages.items():
                    target_page.content = _link_imported_attachments(
                        target_page.content, source_page_id, attachment_urls, title_to_page_id
                    )
                restore_timestamps()
            job.counters = {
                **job.counters,
                "attachments_processed": attachments_imported,
            }
            await log(
                session,
                job,
                "info",
                "attachments",
                f"Imported {attachments_imported} attachments and linked them to their pages.",
            )
            await session.commit()
        job.status, job.phase = "completed", "completed"
        await session.commit()
    except ImportCancelled as exc:
        await session.rollback()
        job = await session.get(ImportJob, job_id)
        if job:
            job.status, job.phase = "cancelled", "cancelled"
            await log(session, job, "warning", "cancelled", str(exc))
            await session.commit()
    except Exception as exc:  # noqa: BLE001 - persist any worker failure for the operator
        await session.rollback()
        job = await session.get(ImportJob, job_id)
        if job:
            job.status, job.phase, job.error = "failed", "failed", str(exc)
            await log(session, job, "error", "failed", str(exc))
            await session.commit()
