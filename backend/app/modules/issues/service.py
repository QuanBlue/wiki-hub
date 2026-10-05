"""Reporting, listing, claiming and closing issues.

Who may do what:

* anyone signed in reports an issue and sees *their own*;
* a triager (superuser, system administrator, or `manage_issues`) sees every
  issue and may claim one;
* only the assignee or a **superuser** may change an issue's status. A system
  administrator who is not the assignee may look, not close.

An issue that someone may not see is reported as not found, never as forbidden,
so its existence is not revealed.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    NotFoundError,
    PayloadTooLargeError,
    PermissionDeniedError,
    UnsupportedMediaTypeError,
)
from app.core.logging import get_logger
from app.models.issue import Issue, IssueAttachment, IssueNote, IssueStatus
from app.models.user import User
from app.modules.admin_mail.service import AdminMailService
from app.modules.issues.labels import NO_LABEL
from app.modules.notifications.service import notify
from app.modules.permissions.service import PermissionService
from app.schemas.issue import (
    IssueAttachmentRead,
    IssueCounts,
    IssueCreate,
    IssueNoteRead,
    IssuePerson,
    IssueRead,
)
from app.schemas.pagination import Page
from app.services.storage import ObjectStorage

#: Screenshots only: raster images a browser shows inline. SVG is active
#: content and is never accepted.
ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGES_PER_ISSUE = 5


def _safe_name(filename: str | None) -> str:
    name = re.split(r"[\\/]+", (filename or "").strip())[-1].strip()
    if not name or name in {".", ".."}:
        name = "screenshot.png"
    return name[:255]


def attachment_url(issue_id: uuid.UUID, attachment_id: uuid.UUID) -> str:
    return f"/api/v1/issues/{issue_id}/attachments/{attachment_id}/content"


logger = get_logger(__name__)


class IssueService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user
        self.permissions = PermissionService(session)

    # ------------------------------------------------------------ permissions

    async def is_triager(self) -> bool:
        return await self.permissions.can_triage_issues(self.user)

    async def require_triager(self) -> None:
        if not await self.is_triager():
            raise PermissionDeniedError("Only issue managers can do this.")

    def _can_set_status(self, issue: Issue) -> bool:
        return self.user.is_superuser or issue.assignee_id == self.user.id

    # ---------------------------------------------------------------- reading

    async def _load(self, issue_id: uuid.UUID) -> Issue:
        issue = await self.session.get(Issue, issue_id)
        if issue is None:
            raise NotFoundError("Issue not found.", code="issue_not_found")
        return issue

    async def get_visible(self, issue_id: uuid.UUID) -> Issue:
        issue = await self._load(issue_id)
        if issue.reporter_id != self.user.id and not await self.is_triager():
            raise NotFoundError("Issue not found.", code="issue_not_found")
        return issue

    async def _render(self, issues: list[Issue], *, triager: bool) -> list[IssueRead]:
        if not issues:
            return []
        # Managers see every note; the reporter only the ones meant for them.
        note_query = select(IssueNote).where(IssueNote.issue_id.in_([i.id for i in issues]))
        if not triager:
            note_query = note_query.where(IssueNote.public.is_(True))
        notes: dict[uuid.UUID, list[IssueNote]] = {}
        for note in (await self.session.scalars(note_query.order_by(IssueNote.created_at))).all():
            notes.setdefault(note.issue_id, []).append(note)

        people_ids = (
            {i.reporter_id for i in issues}
            | {i.assignee_id for i in issues if i.assignee_id}
            | {n.author_id for group in notes.values() for n in group if n.author_id}
        )
        people = {
            user.id: IssuePerson(id=user.id, username=user.username, full_name=user.full_name)
            for user in (
                await self.session.scalars(select(User).where(User.id.in_(people_ids)))
            ).all()
        }
        attachments: dict[uuid.UUID, list[IssueAttachment]] = {}
        for row in (
            await self.session.scalars(
                select(IssueAttachment)
                .where(IssueAttachment.issue_id.in_([i.id for i in issues]))
                .order_by(IssueAttachment.created_at)
            )
        ).all():
            attachments.setdefault(row.issue_id, []).append(row)

        rendered: list[IssueRead] = []
        for issue in issues:
            rendered.append(
                IssueRead(
                    id=issue.id,
                    title=issue.title,
                    description=issue.description,
                    status=issue.status,  # type: ignore[arg-type]
                    page_url=issue.page_url,
                    labels=list(issue.labels or []),
                    reporter=people[issue.reporter_id],
                    assignee=people.get(issue.assignee_id) if issue.assignee_id else None,
                    attachments=[
                        IssueAttachmentRead(
                            id=a.id,
                            filename=a.filename,
                            content_type=a.content_type,
                            size_bytes=a.size_bytes,
                            content_url=attachment_url(issue.id, a.id),
                        )
                        for a in attachments.get(issue.id, [])
                    ],
                    notes=[
                        IssueNoteRead(
                            id=n.id,
                            author=people.get(n.author_id) if n.author_id else None,
                            body=n.body,
                            public=n.public,
                            created_at=n.created_at,
                        )
                        for n in notes.get(issue.id, [])
                    ],
                    created_at=issue.created_at,
                    updated_at=issue.updated_at,
                    resolved_at=issue.resolved_at,
                    can_claim=triager
                    and issue.status != IssueStatus.done.value
                    and (issue.assignee_id is None or self.user.is_superuser)
                    and issue.assignee_id != self.user.id,
                    can_set_status=self._can_set_status(issue),
                )
            )
        return rendered

    async def read(self, issue_id: uuid.UUID) -> IssueRead:
        issue = await self.get_visible(issue_id)
        return (await self._render([issue], triager=await self.is_triager()))[0]

    async def list_mine(self, *, limit: int, offset: int) -> Page[IssueRead]:
        query = select(Issue).where(Issue.reporter_id == self.user.id)
        return await self._page(query, limit=limit, offset=offset)

    def _who(self, value: str) -> Select[tuple[uuid.UUID]]:
        """The account a filter names: ``@me``, or a username (any case)."""
        if value.lower() in {"@me", "me"}:
            return select(User.id).where(User.id == self.user.id)
        return select(User.id).where(func.lower(User.username) == value.lower())

    def _filtered(
        self,
        query: Select[tuple[Issue]],
        *,
        text: str | None = None,
        state: str | None = None,
        author: str | None = None,
        assignee: str | None = None,
        labels: list[str] | None = None,
    ) -> Select[tuple[Issue]]:
        """Narrow ``query`` by what the issue list's search box understands.

        ``state``: ``open`` is anything not finished (open + in progress),
        ``closed`` is done; ``in_progress`` / ``done`` / ``open_only`` pick one
        exact status. Free ``text`` must appear, word by word, in the title or
        description. ``assignee`` of ``none`` means nobody has taken it.
        """
        if state in {"open", "active"}:
            query = query.where(Issue.status != IssueStatus.done.value)
        elif state in {"closed", "done"}:
            query = query.where(Issue.status == IssueStatus.done.value)
        elif state in {"in_progress", "open_only"}:
            query = query.where(
                Issue.status
                == (IssueStatus.in_progress if state == "in_progress" else IssueStatus.open).value
            )
        for word in (text or "").split():
            escaped = word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{escaped}%"
            query = query.where(
                Issue.title.ilike(pattern, escape="\\")
                | Issue.description.ilike(pattern, escape="\\")
            )
        if labels:
            if NO_LABEL in labels:
                query = query.where(func.cardinality(Issue.labels) == 0)
            else:
                # Carrying every one of the chosen labels, as on GitHub.
                query = query.where(Issue.labels.contains(labels))
        if author:
            query = query.where(Issue.reporter_id.in_(self._who(author)))
        if assignee:
            if assignee.lower() == "none":
                query = query.where(Issue.assignee_id.is_(None))
            else:
                query = query.where(Issue.assignee_id.in_(self._who(assignee)))
        return query

    async def list_all(
        self,
        *,
        text: str | None = None,
        state: str | None = None,
        author: str | None = None,
        assignee: str | None = None,
        labels: list[str] | None = None,
        sort: str = "newest",
        limit: int,
        offset: int,
    ) -> Page[IssueRead]:
        await self.require_triager()
        query = self._filtered(
            select(Issue),
            text=text,
            state=state,
            author=author,
            assignee=assignee,
            labels=labels,
        )
        return await self._page(query, sort=sort, limit=limit, offset=offset)

    async def _page(
        self,
        query: Select[tuple[Issue]],
        *,
        sort: str = "newest",
        limit: int,
        offset: int,
    ) -> Page[IssueRead]:
        total = (
            await self.session.execute(select(func.count()).select_from(query.subquery()))
        ).scalar_one()
        order = {
            "oldest": (Issue.created_at.asc(), Issue.id),
            "updated": (Issue.updated_at.desc(), Issue.id),
            "stale": (Issue.updated_at.asc(), Issue.id),
        }.get(sort, (Issue.created_at.desc(), Issue.id))
        page_query = query.order_by(*order).limit(limit).offset(offset)
        rows = (await self.session.scalars(page_query)).all()
        items = await self._render(list(rows), triager=await self.is_triager())
        return Page.of(items, int(total), limit=limit, offset=offset)

    async def people(self) -> list[IssuePerson]:
        """Everyone who has reported or taken an issue, for the filter menus."""
        await self.require_triager()
        involved = select(Issue.reporter_id).union(
            select(Issue.assignee_id).where(Issue.assignee_id.is_not(None))
        )
        users = (
            await self.session.scalars(
                select(User).where(User.id.in_(involved)).order_by(User.username)
            )
        ).all()
        return [IssuePerson(id=u.id, username=u.username, full_name=u.full_name) for u in users]

    async def counts(
        self,
        *,
        text: str | None = None,
        author: str | None = None,
        assignee: str | None = None,
        labels: list[str] | None = None,
    ) -> IssueCounts:
        """Per-status totals for what the search box matches, ignoring the
        state itself - the tab numbers must not change when a tab is picked."""
        await self.require_triager()
        base = self._filtered(
            select(Issue.status, func.count()).select_from(Issue).group_by(Issue.status),  # type: ignore[arg-type]
            text=text,
            author=author,
            assignee=assignee,
            labels=labels,
        )
        rows = await self.session.execute(base)
        counts = IssueCounts()
        for status, count in rows:
            if hasattr(counts, status):
                setattr(counts, status, int(count))
        return counts

    # ---------------------------------------------------------------- writing

    async def create(self, payload: IssueCreate) -> IssueRead:
        issue = Issue(
            reporter_id=self.user.id,
            title=payload.title,
            description=payload.description.strip(),
            page_url=payload.page_url,
            labels=payload.labels,
            status=IssueStatus.open.value,
        )
        self.session.add(issue)
        await self.session.flush()
        triagers = await self.permissions.list_issue_triagers()
        for triager in triagers:
            await notify(
                self.session,
                triager.id,
                "issue_created",
                params={"title": issue.title},
                link=f"/admin/issues?issue={issue.id}",
                actor=self.user,
            )
        await self._email_triagers(issue, triagers)
        return (await self._render([issue], triager=await self.is_triager()))[0]

    async def _email_triagers(self, issue: Issue, triagers: list[User]) -> None:
        """Email the managers too, not only the bell. Best effort: a mail
        problem must never stop someone from reporting an issue."""
        try:
            await AdminMailService(self.session, actor=self.user).send_issue_created_email(
                reporter=self.user,
                issue_id=issue.id,
                issue_title=issue.title,
                description=issue.description,
                recipients=triagers,
            )
        except Exception:
            logger.exception("issue_created_email_error")

    async def add_attachment(
        self,
        storage: ObjectStorage,
        issue_id: uuid.UUID,
        *,
        filename: str | None,
        content_type: str | None,
        data: bytes,
    ) -> IssueAttachmentRead:
        issue = await self._load(issue_id)
        if issue.reporter_id != self.user.id:
            raise NotFoundError("Issue not found.", code="issue_not_found")
        normalized = (content_type or "").lower()
        if normalized not in ALLOWED_IMAGE_TYPES:
            raise UnsupportedMediaTypeError("Attach a PNG, JPEG, GIF or WebP image.")
        if not data:
            raise BadRequestError("The image is empty.")
        if len(data) > MAX_IMAGE_BYTES:
            raise PayloadTooLargeError("Images must be 5 MB or smaller.")
        existing = (
            await self.session.execute(
                select(func.count()).where(IssueAttachment.issue_id == issue.id)
            )
        ).scalar_one()
        if existing >= MAX_IMAGES_PER_ISSUE:
            raise BadRequestError(f"An issue can have at most {MAX_IMAGES_PER_ISSUE} images.")

        attachment_id = uuid.uuid4()
        name = _safe_name(filename)
        attachment = IssueAttachment(
            id=attachment_id,
            issue_id=issue.id,
            filename=name,
            content_type=normalized,
            object_key=f"issues/{issue.id}/{attachment_id}/{name}",
            size_bytes=len(data),
        )
        self.session.add(attachment)
        await storage.put(attachment.object_key, data, content_type=normalized)
        await self.session.flush()
        return IssueAttachmentRead(
            id=attachment.id,
            filename=attachment.filename,
            content_type=attachment.content_type,
            size_bytes=attachment.size_bytes,
            content_url=attachment_url(issue.id, attachment.id),
        )

    async def get_attachment(
        self, issue_id: uuid.UUID, attachment_id: uuid.UUID
    ) -> IssueAttachment:
        await self.get_visible(issue_id)
        attachment = await self.session.get(IssueAttachment, attachment_id)
        if attachment is None or attachment.issue_id != issue_id:
            raise NotFoundError("Attachment not found.", code="issue_attachment_not_found")
        return attachment

    async def claim(self, issue_id: uuid.UUID) -> IssueRead:
        await self.require_triager()
        issue = await self._load(issue_id)
        if issue.status == IssueStatus.done.value:
            raise ConflictError("This issue is already done.", code="issue_done")
        if issue.assignee_id == self.user.id:
            return (await self._render([issue], triager=True))[0]
        if issue.assignee_id is not None and not self.user.is_superuser:
            raise ConflictError("Someone else has already taken this issue.", code="issue_claimed")
        issue.assignee_id = self.user.id
        issue.status = IssueStatus.in_progress.value
        await self.session.flush()
        # `updated_at` is rewritten by the database on UPDATE; reading it
        # without a refresh would trigger a lazy load outside the greenlet.
        await self.session.refresh(issue)
        await notify(
            self.session,
            issue.reporter_id,
            "issue_claimed",
            params={"title": issue.title},
            link="/issues",
            actor=self.user,
        )
        return (await self._render([issue], triager=True))[0]

    async def assignable_people(self) -> list[IssuePerson]:
        """Who an issue can be handed to: everyone who may manage issues."""
        await self.require_triager()
        return [
            IssuePerson(id=u.id, username=u.username, full_name=u.full_name)
            for u in await self.permissions.list_issue_triagers()
        ]

    async def assign(self, issue_id: uuid.UUID, assignee_id: uuid.UUID | None) -> IssueRead:
        """Hand an issue to someone, or take it back to nobody.

        A manager may take an issue themselves (that is `claim`); only a
        superuser may give it to someone else, or take it off another person.
        The assignee has to be someone who can manage issues.
        """
        await self.require_triager()
        issue = await self._load(issue_id)
        if issue.status == IssueStatus.done.value:
            raise ConflictError("This issue is already done.", code="issue_done")

        if assignee_id is None:
            if issue.assignee_id is None:
                return (await self._render([issue], triager=True))[0]
            if not (self.user.is_superuser or issue.assignee_id == self.user.id):
                raise PermissionDeniedError(
                    "Only the person who took this issue, or a super administrator, "
                    "can hand it back."
                )
            issue.assignee_id = None
            issue.status = IssueStatus.open.value
            await self.session.flush()
            await self.session.refresh(issue)
            return (await self._render([issue], triager=True))[0]

        if assignee_id == self.user.id:
            return await self.claim(issue_id)
        if not self.user.is_superuser:
            raise PermissionDeniedError(
                "Only a super administrator can give an issue to someone else."
            )
        target = await self.session.get(User, assignee_id)
        if (
            target is None
            or not target.is_active
            or not await self.permissions.can_triage_issues(target)
        ):
            raise BadRequestError(
                "That person cannot manage issues.", code="issue_assignee_invalid"
            )
        if issue.assignee_id == target.id:
            return (await self._render([issue], triager=True))[0]
        issue.assignee_id = target.id
        issue.status = IssueStatus.in_progress.value
        await self.session.flush()
        await self.session.refresh(issue)
        name = target.full_name.strip() or target.username
        await notify(
            self.session,
            target.id,
            "issue_assigned",
            params={"title": issue.title},
            link=f"/admin/issues?issue={issue.id}",
            actor=self.user,
        )
        await notify(
            self.session,
            issue.reporter_id,
            "issue_assigned_reporter",
            params={"title": issue.title, "name": name},
            link="/issues",
            actor=self.user,
        )
        return (await self._render([issue], triager=True))[0]

    async def bulk(
        self,
        ids: list[uuid.UUID],
        *,
        action: str,
        status: str | None = None,
        assignee_id: uuid.UUID | None = None,
        note: str | None = None,
    ) -> tuple[list[IssueRead], list[tuple[uuid.UUID, str]], list[IssueRead]]:
        """Apply one change to many issues, one at a time under each issue's own
        rules, and report what did not go through instead of failing them all.

        Returns the updated issues, ``(id, reason)`` for each one skipped, and the
        ones this call just closed (so the caller can tell their reporters).
        """
        await self.require_triager()
        updated: list[IssueRead] = []
        failed: list[tuple[uuid.UUID, str]] = []
        closed: list[IssueRead] = []
        for issue_id in dict.fromkeys(ids):
            try:
                if action == "status":
                    before = (await self._load(issue_id)).status
                    result = await self.set_status(issue_id, status or "open", note)
                    updated.append(result)
                    if result.status == IssueStatus.done.value and before != result.status:
                        closed.append(result)
                elif action == "unassign":
                    updated.append(await self.assign(issue_id, None))
                else:
                    updated.append(await self.assign(issue_id, assignee_id))
            except (PermissionDeniedError, ConflictError, NotFoundError, BadRequestError) as error:
                failed.append((issue_id, error.code))
        return updated, failed, closed

    async def add_note(self, issue_id: uuid.UUID, body: str) -> IssueRead:
        """An internal note: seen by issue managers, never by the reporter."""
        await self.require_triager()
        issue = await self._load(issue_id)
        self.session.add(IssueNote(issue_id=issue.id, author_id=self.user.id, body=body))
        await self.session.flush()
        return (await self._render([issue], triager=True))[0]

    async def set_status(
        self, issue_id: uuid.UUID, status: str, note: str | None = None
    ) -> IssueRead:
        await self.require_triager()
        issue = await self._load(issue_id)
        if not self._can_set_status(issue):
            raise PermissionDeniedError(
                "Only the person who took this issue, or a super administrator, can change it."
            )
        if status != IssueStatus.open.value and issue.assignee_id is None:
            # Closing or progressing an unclaimed issue records who did it.
            issue.assignee_id = self.user.id
        previous = issue.status
        # What is said when closing is for the reporter: a public note.
        closing_note = (note or "").strip()
        if closing_note and status == IssueStatus.done.value:
            self.session.add(
                IssueNote(issue_id=issue.id, author_id=self.user.id, body=closing_note, public=True)
            )
        issue.status = status
        issue.resolved_at = datetime.now(UTC) if status == IssueStatus.done.value else None
        await self.session.flush()
        await self.session.refresh(issue)
        if status == IssueStatus.done.value and previous != status:
            await notify(
                self.session,
                issue.reporter_id,
                "issue_done",
                params={"title": issue.title},
                link="/issues",
                actor=self.user,
            )
        return (await self._render([issue], triager=True))[0]
