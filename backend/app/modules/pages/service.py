"""Page business rules."""

from __future__ import annotations

import difflib
import re
import uuid
from collections.abc import Sequence

from bs4 import BeautifulSoup
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError, NotFoundError, PermissionDeniedError
from app.core.logging import get_logger
from app.models.draft import PageDraft
from app.models.page import WikiPage
from app.models.permission import Permission
from app.models.revision import PageRevision
from app.models.space import Space, SpaceStatus
from app.models.user import User
from app.modules.spaces.service import SpaceService
from app.repositories.draft import PageDraftRepository
from app.repositories.page import PageRepository
from app.repositories.revision import PageRevisionRepository
from app.schemas.draft import PageDraftRead, PageDraftUpsert
from app.schemas.page import (
    PageCreate,
    PageLikeRead,
    PageMove,
    PageRead,
    PageRecentItem,
    PageUpdate,
)
from app.schemas.revision import (
    PageRevisionDiffChunk,
    PageRevisionDiffLine,
    PageRevisionDiffRead,
    PageRevisionDiffSegment,
    PageRevisionRead,
)

logger = get_logger(__name__)


SLUG_CHARS = re.compile(r"[^a-z0-9]+")


class PageService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.pages = PageRepository(session)
        self.spaces = SpaceService(session)
        self.revisions = PageRevisionRepository(session)
        self.drafts = PageDraftRepository(session)

    async def require_editor(self, space: Space, user: User) -> None:
        await self.spaces.require_add(space, user)

    async def require_page_editor(self, page: WikiPage, user: User) -> None:
        if not await self.spaces.permissions.can_edit_page(page, user):
            raise PermissionDeniedError("You do not have edit access to this page.")

    async def require_page_view(self, page: WikiPage, user: User) -> None:
        if not await self.spaces.permissions.can_view_page(page, user):
            raise PermissionDeniedError("You do not have access to this page.")

    def to_read(self, page: WikiPage) -> PageRead:
        return PageRead(
            id=page.id,
            space_id=page.space_id,
            parent_id=page.parent_id,
            title=page.title,
            slug=page.slug,
            content=page.content,
            content_format=page.content_format,
            created_at=page.created_at,
            updated_at=page.updated_at,
            created_by_username=page.created_by_label
            or (page.created_by.username if page.created_by else None),
            updated_by_username=page.updated_by_label
            or (page.updated_by.username if page.updated_by else None),
        )

    async def to_read_for_user(self, page: WikiPage, user: User) -> PageRead:
        result = self.to_read(page)
        result.can_edit = await self.spaces.permissions.can_edit_page(page, user)
        space = await self.session.get(Space, page.space_id)
        result.can_export = (
            await self.spaces.permissions.can_view_page(page, user)
            and space is not None
            and Permission.export
            in await self.spaces.permissions.effective_permissions(space, user)
        )
        result.is_restricted = await self.spaces.permissions.page_view_is_restricted(page)
        return result

    def to_read_many(self, pages: Sequence[WikiPage]) -> list[PageRead]:
        return [self.to_read(page) for page in pages]

    async def list_for_space(
        self, space: Space, user: User | None = None, *, limit: int = 10000, offset: int = 0
    ) -> list[PageRead]:
        pages = await self.pages.list_for_space(space.id, limit=limit, offset=offset)
        if user is None:
            return self.to_read_many(pages)
        visible = [
            page for page in pages if await self.spaces.permissions.can_view_page(page, user)
        ]
        return [await self.to_read_for_user(page, user) for page in visible]

    async def get_by_slug(self, space: Space, slug: str) -> WikiPage:
        page = await self.pages.get_by_slug(space.id, slug)
        if page is None:
            raise NotFoundError("Page not found.")
        return page

    async def like_status(self, page: WikiPage, user: User) -> PageLikeRead:
        return PageLikeRead(
            liked_by_me=await self.pages.is_liked(page.id, user.id),
            like_count=await self.pages.like_count(page.id),
        )

    async def set_like(self, page: WikiPage, user: User, liked: bool) -> PageLikeRead:
        await self.pages.set_like(page.id, user.id, liked)
        await self.session.flush()
        return await self.like_status(page, user)

    async def snapshot_revision(
        self, page: WikiPage, author: User | None, summary: str | None = None
    ) -> PageRevision:
        max_version = await self.revisions.get_max_version(page.id)
        rev = PageRevision(
            page_id=page.id,
            version=max_version + 1,
            title=page.title,
            content=page.content,
            content_format=page.content_format,
            created_by_id=author.id if author else None,
            change_summary=summary,
        )
        self.revisions.add(rev)
        await self.session.flush()
        return rev

    async def create(self, space: Space, payload: PageCreate, creator: User) -> WikiPage:
        await self.require_editor(space, creator)
        title = payload.title.strip()
        if payload.parent_id is not None:
            parent = await self.pages.get(payload.parent_id)
            if parent is None or parent.space_id != space.id:
                raise NotFoundError("Parent page not found.")
        slug = await self.unique_slug(space, title)
        page = WikiPage(
            space_id=space.id,
            parent_id=payload.parent_id,
            title=title,
            slug=slug,
            content=payload.content.strip(),
            content_format=payload.content_format,
            created_by_id=creator.id,
            updated_by_id=creator.id,
        )
        self.pages.add(page)
        await self.session.flush()
        await self.session.refresh(page)
        await self.snapshot_revision(page, creator, "Initial page creation")
        logger.info("page_created", space_key=space.key, slug=page.slug, by=creator.username)
        return page

    async def update(
        self, space: Space, page: WikiPage, payload: PageUpdate, user: User
    ) -> WikiPage:
        await self.require_page_editor(page, user)
        data = payload.model_dump(exclude_unset=True)
        if data.get("title") is not None:
            page.title = str(data["title"]).strip()
        if data.get("content") is not None:
            page.content = str(data["content"]).strip()
        if data.get("content_format") is not None:
            page.content_format = str(data["content_format"])
        page.updated_by_id = user.id
        await self.session.flush()
        await self.session.refresh(page)
        await self.snapshot_revision(page, user, "Updated content")
        draft = await self.drafts.get(page.id, user.id)
        if draft is not None:
            await self.drafts.delete(draft)
        logger.info("page_updated", space_key=space.key, slug=page.slug, by=user.username)
        return page

    async def get_draft(self, page: WikiPage, user: User) -> PageDraftRead | None:
        await self.require_page_editor(page, user)
        draft = await self.drafts.get(page.id, user.id)
        if draft is None:
            return None
        return PageDraftRead(
            id=draft.id,
            page_id=draft.page_id,
            content=draft.content,
            content_format=draft.content_format,
            edit_mode=draft.edit_mode,
            base_updated_at=draft.base_updated_at,
            updated_at=draft.updated_at,
            is_conflict=draft.base_updated_at != page.updated_at,
        )

    async def save_draft(
        self, page: WikiPage, user: User, payload: PageDraftUpsert
    ) -> PageDraftRead:
        await self.require_page_editor(page, user)
        draft = await self.drafts.get(page.id, user.id)
        if draft is None:
            draft = self.drafts.add(PageDraft(page_id=page.id, user_id=user.id))
        draft.content = payload.content
        draft.content_format = payload.content_format
        draft.edit_mode = payload.edit_mode
        draft.base_updated_at = payload.base_updated_at
        await self.session.flush()
        return PageDraftRead(
            id=draft.id,
            page_id=draft.page_id,
            content=draft.content,
            content_format=draft.content_format,
            edit_mode=draft.edit_mode,
            base_updated_at=draft.base_updated_at,
            updated_at=draft.updated_at,
            is_conflict=draft.base_updated_at != page.updated_at,
        )

    async def discard_draft(self, page: WikiPage, user: User) -> None:
        await self.require_page_editor(page, user)
        draft = await self.drafts.get(page.id, user.id)
        if draft is not None:
            await self.drafts.delete(draft)

    async def list_revisions(self, page: WikiPage) -> list[PageRevisionRead]:
        revisions = await self.revisions.list_for_page(page.id)
        # If no revisions exist yet (e.g. legacy pages), snapshot version 1 dynamically
        if not revisions:
            first_rev = await self.snapshot_revision(page, page.created_by, "Initial version")
            revisions = [first_rev]

        items: list[PageRevisionRead] = []
        for r in revisions:
            author_user = r.created_by
            items.append(
                PageRevisionRead(
                    id=r.id,
                    page_id=r.page_id,
                    version=r.version,
                    title=r.title,
                    content=r.content,
                    content_format=r.content_format,
                    created_at=r.created_at,
                    change_summary=r.change_summary,
                    created_by_username=(
                        page.created_by_label or (author_user.username if author_user else None)
                    ),
                    created_by_full_name=author_user.full_name
                    if author_user and author_user.full_name
                    else (author_user.username if author_user else "System"),
                )
            )
        return items

    async def get_revision(self, page: WikiPage, version: int) -> PageRevisionRead:
        rev = await self.revisions.get_by_version(page.id, version)
        if rev is None:
            # Check if this is version 1 for a legacy page
            all_revs = await self.list_revisions(page)
            for r in all_revs:
                if r.version == version:
                    return r
            raise NotFoundError(f"Revision version {version} not found.")

        author_user = rev.created_by
        return PageRevisionRead(
            id=rev.id,
            page_id=rev.page_id,
            version=rev.version,
            title=rev.title,
            content=rev.content,
            content_format=rev.content_format,
            created_at=rev.created_at,
            change_summary=rev.change_summary,
            created_by_username=(
                page.created_by_label or (author_user.username if author_user else None)
            ),
            created_by_full_name=author_user.full_name
            if author_user and author_user.full_name
            else (author_user.username if author_user else "System"),
        )

    async def calculate_diff(
        self, page: WikiPage, from_version: int | None = None, to_version: int | None = None
    ) -> PageRevisionDiffRead:
        revisions = await self.list_revisions(page)
        if not revisions:
            raise NotFoundError("No revisions available for diff calculation.")

        # Default to_version is latest version, from_version is version prior or same
        latest_rev = revisions[0]
        target_to = to_version if to_version is not None else latest_rev.version
        target_from = (
            from_version
            if from_version is not None
            else (target_to - 1 if target_to > 1 else target_to)
        )

        rev_from = next((r for r in revisions if r.version == target_from), None)
        rev_to = next((r for r in revisions if r.version == target_to), None)

        if rev_from is None:
            rev_from = revisions[-1]
        if rev_to is None:
            rev_to = latest_rev

        def diff_lines(content: str, content_format: str) -> list[str]:
            if content_format != "html":
                return content.splitlines()

            soup = BeautifulSoup(content, "html.parser")
            block_tags = (
                "p",
                "h1",
                "h2",
                "h3",
                "h4",
                "h5",
                "h6",
                "li",
                "blockquote",
                "pre",
                "tr",
                "div",
            )
            lines: list[str] = []
            for block in soup.find_all(block_tags):
                if block.find_parent(block_tags):
                    continue
                text = block.get_text(" ", strip=True)
                if text:
                    lines.append(text)

            if lines:
                return lines
            return [line.strip() for line in soup.get_text("\n").splitlines() if line.strip()]

        from_lines = diff_lines(rev_from.content, rev_from.content_format)
        to_lines = diff_lines(rev_to.content, rev_to.content_format)

        matcher = difflib.SequenceMatcher(None, from_lines, to_lines)
        chunks: list[PageRevisionDiffChunk] = []
        lines: list[PageRevisionDiffLine] = []
        added_count = 0
        deleted_count = 0

        def char_segments(
            old_text: str, new_text: str
        ) -> tuple[list[PageRevisionDiffSegment], list[PageRevisionDiffSegment]]:
            old_segments: list[PageRevisionDiffSegment] = []
            new_segments: list[PageRevisionDiffSegment] = []
            char_matcher = difflib.SequenceMatcher(None, old_text, new_text)
            for char_tag, old_start, old_end, new_start, new_end in char_matcher.get_opcodes():
                if char_tag == "equal":
                    old_segments.append(
                        PageRevisionDiffSegment(operation="equal", text=old_text[old_start:old_end])
                    )
                    new_segments.append(
                        PageRevisionDiffSegment(operation="equal", text=new_text[new_start:new_end])
                    )
                elif char_tag in {"delete", "replace"}:
                    if old_start != old_end:
                        old_segments.append(
                            PageRevisionDiffSegment(
                                operation="delete", text=old_text[old_start:old_end]
                            )
                        )
                    if new_start != new_end:
                        new_segments.append(
                            PageRevisionDiffSegment(
                                operation="add", text=new_text[new_start:new_end]
                            )
                        )
                elif char_tag == "insert" and new_start != new_end:
                    new_segments.append(
                        PageRevisionDiffSegment(operation="add", text=new_text[new_start:new_end])
                    )
            return old_segments, new_segments

        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                text = "\n".join(from_lines[i1:i2])
                if text:
                    chunks.append(PageRevisionDiffChunk(operation="equal", text=text))
                for offset, line_text in enumerate(from_lines[i1:i2]):
                    lines.append(
                        PageRevisionDiffLine(
                            operation="equal",
                            old_line_number=i1 + offset + 1,
                            new_line_number=j1 + offset + 1,
                            old_text=line_text,
                            new_text=line_text,
                            old_segments=[
                                PageRevisionDiffSegment(operation="equal", text=line_text)
                            ],
                            new_segments=[
                                PageRevisionDiffSegment(operation="equal", text=line_text)
                            ],
                        )
                    )
            elif tag == "replace":
                deleted_text = "\n".join(from_lines[i1:i2])
                added_text = "\n".join(to_lines[j1:j2])
                if deleted_text:
                    deleted_count += i2 - i1
                    chunks.append(PageRevisionDiffChunk(operation="delete", text=deleted_text))
                if added_text:
                    added_count += j2 - j1
                    chunks.append(PageRevisionDiffChunk(operation="add", text=added_text))
                pair_count = min(i2 - i1, j2 - j1)
                for offset in range(pair_count):
                    old_text = from_lines[i1 + offset]
                    new_text = to_lines[j1 + offset]
                    old_segments, new_segments = char_segments(old_text, new_text)
                    lines.append(
                        PageRevisionDiffLine(
                            operation="replace",
                            old_line_number=i1 + offset + 1,
                            new_line_number=j1 + offset + 1,
                            old_text=old_text,
                            new_text=new_text,
                            old_segments=old_segments,
                            new_segments=new_segments,
                        )
                    )
                for offset in range(pair_count, i2 - i1):
                    old_text = from_lines[i1 + offset]
                    lines.append(
                        PageRevisionDiffLine(
                            operation="delete",
                            old_line_number=i1 + offset + 1,
                            old_text=old_text,
                            old_segments=[
                                PageRevisionDiffSegment(operation="delete", text=old_text)
                            ],
                        )
                    )
                for offset in range(pair_count, j2 - j1):
                    new_text = to_lines[j1 + offset]
                    lines.append(
                        PageRevisionDiffLine(
                            operation="add",
                            new_line_number=j1 + offset + 1,
                            new_text=new_text,
                            new_segments=[PageRevisionDiffSegment(operation="add", text=new_text)],
                        )
                    )
            elif tag == "delete":
                deleted_text = "\n".join(from_lines[i1:i2])
                if deleted_text:
                    deleted_count += i2 - i1
                    chunks.append(PageRevisionDiffChunk(operation="delete", text=deleted_text))
                for offset, line_text in enumerate(from_lines[i1:i2]):
                    lines.append(
                        PageRevisionDiffLine(
                            operation="delete",
                            old_line_number=i1 + offset + 1,
                            old_text=line_text,
                            old_segments=[
                                PageRevisionDiffSegment(operation="delete", text=line_text)
                            ],
                        )
                    )
            elif tag == "insert":
                added_text = "\n".join(to_lines[j1:j2])
                if added_text:
                    added_count += j2 - j1
                    chunks.append(PageRevisionDiffChunk(operation="add", text=added_text))
                for offset, line_text in enumerate(to_lines[j1:j2]):
                    lines.append(
                        PageRevisionDiffLine(
                            operation="add",
                            new_line_number=j1 + offset + 1,
                            new_text=line_text,
                            new_segments=[PageRevisionDiffSegment(operation="add", text=line_text)],
                        )
                    )

        return PageRevisionDiffRead(
            from_version=rev_from.version,
            to_version=rev_to.version,
            title_changed=rev_from.title != rev_to.title,
            from_title=rev_from.title,
            to_title=rev_to.title,
            chunks=chunks,
            added_count=added_count,
            deleted_count=deleted_count,
            lines=lines,
        )

    async def restore_revision(
        self, space: Space, page: WikiPage, version: int, user: User
    ) -> WikiPage:
        await self.require_page_editor(page, user)
        rev = await self.revisions.get_by_version(page.id, version)
        if rev is None:
            raise NotFoundError(f"Revision version {version} not found.")

        page.title = rev.title
        page.content = rev.content
        page.content_format = rev.content_format
        page.updated_by_id = user.id
        await self.session.flush()
        await self.session.refresh(page)

        await self.snapshot_revision(page, user, f"Restored version {version}")
        logger.info(
            "page_restored", space_key=space.key, slug=page.slug, version=version, by=user.username
        )
        return page

    async def move(self, space: Space, page: WikiPage, payload: PageMove, user: User) -> WikiPage:
        await self.require_page_editor(page, user)
        destination = await self.spaces.get_by_key(payload.destination_space_key)
        if destination.status is not SpaceStatus.active:
            raise BadRequestError("Pages can only be moved to an active space.")
        await self.require_editor(destination, user)

        source_pages = await self.pages.list_all_for_space(space.id)
        children_by_parent: dict[uuid.UUID, list[WikiPage]] = {}
        for candidate in source_pages:
            if candidate.parent_id is not None:
                children_by_parent.setdefault(candidate.parent_id, []).append(candidate)

        subtree: list[WikiPage] = []
        pending = [page]
        seen: set[uuid.UUID] = set()
        while pending:
            candidate = pending.pop()
            if candidate.id in seen:
                continue
            seen.add(candidate.id)
            subtree.append(candidate)
            pending.extend(children_by_parent.get(candidate.id, []))

        if payload.parent_id is not None:
            parent = await self.pages.get(payload.parent_id)
            if parent is None or parent.space_id != destination.id:
                raise NotFoundError("Destination parent page not found.")
            if parent.id in seen:
                raise BadRequestError("A page cannot be moved into itself or one of its children.")

        destination_pages = await self.pages.list_all_for_space(destination.id)
        occupied_slugs = {
            candidate.slug for candidate in destination_pages if candidate.id not in seen
        }
        for candidate in subtree:
            candidate.space_id = destination.id
            candidate.updated_by_id = user.id
            candidate.slug = self.unique_slug_from_occupied(candidate.slug, occupied_slugs)
            occupied_slugs.add(candidate.slug)
        page.parent_id = payload.parent_id

        await self.session.flush()
        await self.session.refresh(page)
        logger.info(
            "page_moved",
            source_space_key=space.key,
            destination_space_key=destination.key,
            slug=page.slug,
            descendants=len(subtree) - 1,
            by=user.username,
        )
        return page

    async def delete(self, space: Space, page: WikiPage, user: User) -> int:
        """Delete one page while preserving its direct child pages.

        Moving children to the deleted page's parent avoids silently deleting a
        branch of documentation when an editor only intended to remove one
        page. Root children remain root pages.
        """
        if not await self.spaces.permissions.can_view_page(page, user):
            raise PermissionDeniedError("You do not have access to this page.")
        permissions = await self.spaces.permissions.effective_permissions(space, user)
        if Permission.delete not in permissions and (
            Permission.delete_own not in permissions or page.created_by_id != user.id
        ):
            raise PermissionDeniedError("You need Delete or Delete Own permission in this space.")
        children = await self.pages.list_children(page.id)
        for child in children:
            child.parent_id = page.parent_id
            child.updated_by_id = user.id

        moved_children = len(children)
        await self.pages.delete(page)
        await self.session.flush()
        logger.info(
            "page_deleted",
            space_key=space.key,
            slug=page.slug,
            moved_children=moved_children,
            by=user.username,
        )
        return moved_children

    async def unique_slug(self, space: Space, title: str) -> str:
        base = SLUG_CHARS.sub("-", title.strip().lower()).strip("-") or "page"
        slug = base[:240].strip("-") or "page"
        candidate = slug
        suffix = 2
        while await self.pages.slug_exists(space.id, candidate):
            candidate = f"{slug}-{suffix}"
            suffix += 1
        return candidate

    @staticmethod
    def unique_slug_from_occupied(slug: str, occupied: set[str]) -> str:
        candidate = slug
        suffix = 2
        while candidate in occupied:
            candidate = f"{slug[:240].strip('-') or 'page'}-{suffix}"
            suffix += 1
        return candidate

    async def list_recent_pages(self, user: User, *, limit: int = 50) -> list[PageRecentItem]:
        pages = await self.pages.list_recent_pages(limit=limit)
        pages = [page for page in pages if await self.spaces.permissions.can_view_page(page, user)]
        items: list[PageRecentItem] = []
        for page in pages:
            author = page.updated_by or page.created_by
            username = author.username if author else "system"
            full_name = author.full_name if author and author.full_name else username
            items.append(
                PageRecentItem(
                    id=page.id,
                    title=page.title,
                    slug=page.slug,
                    space_key=page.space.key,
                    space_name=page.space.name,
                    created_at=page.created_at,
                    updated_at=page.updated_at,
                    user_username=username,
                    user_full_name=full_name,
                )
            )
        return items
