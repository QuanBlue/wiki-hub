"""Issues: anyone reports one, triagers claim and close them."""

from __future__ import annotations

import re
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, File, Query, Response, UploadFile, status

from app.api.deps import CurrentUser, DbSession
from app.api.v1.attachments import StorageDep
from app.core.exceptions import WikiHubError
from app.core.logging import get_logger
from app.models.user import User
from app.modules.admin_mail.service import AdminMailService, is_deliverable_address
from app.modules.issues.service import MAX_IMAGE_BYTES, IssueService
from app.schemas.issue import (
    IssueAssign,
    IssueAttachmentRead,
    IssueBulkFailure,
    IssueBulkRequest,
    IssueBulkResult,
    IssueCounts,
    IssueCreate,
    IssueNoteCreate,
    IssuePerson,
    IssueRead,
    IssueStatusUpdate,
)
from app.schemas.pagination import Page

router = APIRouter(prefix="/issues", tags=["issues"])
logger = get_logger(__name__)

#: ``open`` = anything not finished; ``closed`` = done; the rest pick one status.
IssueStateFilter = Literal["open", "closed", "open_only", "in_progress", "done", "all"]
IssueSort = Literal["newest", "oldest", "updated", "stale"]


@router.post(
    "", response_model=IssueRead, status_code=status.HTTP_201_CREATED, summary="Report an issue"
)
async def create_issue(payload: IssueCreate, user: CurrentUser, session: DbSession) -> IssueRead:
    return await IssueService(session, user).create(payload)


@router.get("/mine", response_model=Page[IssueRead], summary="Issues I reported")
async def list_my_issues(
    user: CurrentUser,
    session: DbSession,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[IssueRead]:
    return await IssueService(session, user).list_mine(limit=limit, offset=offset)


@router.get("", response_model=Page[IssueRead], summary="Search every issue (issue managers)")
async def list_issues(
    user: CurrentUser,
    session: DbSession,
    q: Annotated[str | None, Query(max_length=200)] = None,
    state: IssueStateFilter | None = None,
    author: Annotated[str | None, Query(max_length=64)] = None,
    assignee: Annotated[str | None, Query(max_length=64)] = None,
    label: Annotated[list[str] | None, Query(max_length=12)] = None,
    sort: IssueSort = "newest",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[IssueRead]:
    return await IssueService(session, user).list_all(
        text=q,
        state=state,
        author=author,
        assignee=assignee,
        labels=label,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@router.get("/counts", response_model=IssueCounts, summary="Issue counts by status")
async def issue_counts(
    user: CurrentUser,
    session: DbSession,
    q: Annotated[str | None, Query(max_length=200)] = None,
    author: Annotated[str | None, Query(max_length=64)] = None,
    assignee: Annotated[str | None, Query(max_length=64)] = None,
    label: Annotated[list[str] | None, Query(max_length=12)] = None,
) -> IssueCounts:
    """Totals per status for the same search, whichever state tab is showing."""
    return await IssueService(session, user).counts(
        text=q, author=author, assignee=assignee, labels=label
    )


@router.get("/people", response_model=list[IssuePerson], summary="Who reported or took issues")
async def issue_people(user: CurrentUser, session: DbSession) -> list[IssuePerson]:
    return await IssueService(session, user).people()


@router.get(
    "/assignees", response_model=list[IssuePerson], summary="Who an issue can be assigned to"
)
async def issue_assignees(user: CurrentUser, session: DbSession) -> list[IssuePerson]:
    return await IssueService(session, user).assignable_people()


@router.post("/bulk", response_model=IssueBulkResult, summary="Change many issues at once")
async def bulk_update_issues(
    payload: IssueBulkRequest, user: CurrentUser, session: DbSession
) -> IssueBulkResult:
    """One change applied to each selected issue under that issue's own rules.

    An issue the caller may not change is skipped and reported, never a reason
    to refuse the rest. Reporters of issues closed here are emailed, as they
    would be one by one.
    """
    updated, failed, closed = await IssueService(session, user).bulk(
        payload.ids,
        action=payload.action,
        status=payload.status,
        assignee_id=payload.assignee_id,
        note=payload.note,
    )
    emailed = 0
    for issue in closed:
        if await _email_reporter(session, user, issue, payload.note) == "sent":
            emailed += 1
    return IssueBulkResult(
        updated=len(updated),
        failed=[IssueBulkFailure(id=issue_id, reason=reason) for issue_id, reason in failed],
        emailed=emailed,
    )


@router.get("/{issue_id}", response_model=IssueRead, summary="Read one issue")
async def read_issue(issue_id: uuid.UUID, user: CurrentUser, session: DbSession) -> IssueRead:
    return await IssueService(session, user).read(issue_id)


@router.get(
    "/{issue_id}/export/docx",
    response_class=Response,
    summary="Download an issue as a Word document",
)
async def export_issue_docx(
    issue_id: uuid.UUID,
    user: CurrentUser,
    session: DbSession,
    storage: StorageDep,
    lang: Literal["en", "vi"] = "en",
) -> Response:
    content, filename = await IssueService(session, user).export_docx(
        storage, [issue_id], lang=lang
    )
    return _docx_response(content, filename)


@router.get(
    "/export/docx",
    response_class=Response,
    summary="Download several issues as one Word document",
)
async def export_issues_docx(
    user: CurrentUser,
    session: DbSession,
    storage: StorageDep,
    ids: Annotated[list[uuid.UUID], Query(min_length=1, max_length=100)],
    lang: Literal["en", "vi"] = "en",
) -> Response:
    """A GET with repeated ``ids`` so the browser can download it as a plain
    link, the same way a single issue (or a page) is exported. Issues the
    caller may not see are left out."""
    content, filename = await IssueService(session, user).export_docx(
        storage, ids, lang=lang
    )
    return _docx_response(content, filename)


def _docx_response(content: bytes, filename: str) -> Response:
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/{issue_id}/claim", response_model=IssueRead, summary="Take an issue")
async def claim_issue(issue_id: uuid.UUID, user: CurrentUser, session: DbSession) -> IssueRead:
    return await IssueService(session, user).claim(issue_id)


@router.put("/{issue_id}/assignee", response_model=IssueRead, summary="Assign or unassign an issue")
async def assign_issue(
    issue_id: uuid.UUID, payload: IssueAssign, user: CurrentUser, session: DbSession
) -> IssueRead:
    return await IssueService(session, user).assign(issue_id, payload.assignee_id)


@router.patch("/{issue_id}/status", response_model=IssueRead, summary="Change an issue's status")
async def update_issue_status(
    issue_id: uuid.UUID,
    payload: IssueStatusUpdate,
    user: CurrentUser,
    session: DbSession,
) -> IssueRead:
    service = IssueService(session, user)
    before = await service.read(issue_id)
    result = await service.set_status(issue_id, payload.status, payload.note)
    if before.status != "done" and result.status == "done":
        result.email = await _email_reporter(session, user, result, payload.note)
    return result


async def _email_reporter(
    session: DbSession, actor: User, issue: IssueRead, note: str | None
) -> Literal["sent", "failed", "skipped"]:
    """Tell the reporter their issue was closed, by email.

    Best effort: closing the issue has already happened and must not be undone
    or failed by a mail problem, so every failure becomes ``failed``. Nothing is
    sent when the person closing it is the reporter (they know), or when the
    reporter's account is gone or inactive.
    """
    if issue.reporter.id == actor.id:
        return "skipped"
    reporter = await session.get(User, issue.reporter.id)
    if reporter is None or not reporter.is_active or not is_deliverable_address(reporter.email):
        return "skipped"
    try:
        sent = await AdminMailService(session, actor=actor).send_issue_closed_email(
            actor,
            to_user=reporter,
            issue_title=issue.title,
            taken_by=(issue.assignee.full_name.strip() or issue.assignee.username)
            if issue.assignee
            else None,
            note=(note or "").strip() or None,
        )
    except WikiHubError as error:
        # Typically "no administrator mailbox is available to send from".
        logger.warning("issue_closed_email_unavailable", reason=error.code)
        return "failed"
    except Exception:
        logger.exception("issue_closed_email_error")
        return "failed"
    return "sent" if sent.email_sent else "failed"


@router.post(
    "/{issue_id}/notes",
    response_model=IssueRead,
    status_code=status.HTTP_201_CREATED,
    summary="Add an internal note (issue managers)",
)
async def add_issue_note(
    issue_id: uuid.UUID,
    payload: IssueNoteCreate,
    user: CurrentUser,
    session: DbSession,
) -> IssueRead:
    return await IssueService(session, user).add_note(issue_id, payload.body)


@router.post(
    "/{issue_id}/attachments",
    response_model=IssueAttachmentRead,
    status_code=status.HTTP_201_CREATED,
    summary="Attach a screenshot to my issue",
)
async def upload_issue_attachment(
    issue_id: uuid.UUID,
    file: Annotated[UploadFile, File(description="A PNG, JPEG, GIF or WebP image")],
    user: CurrentUser,
    session: DbSession,
    storage: StorageDep,
) -> IssueAttachmentRead:
    # One byte over the ceiling is enough to know it is over the ceiling.
    data = await file.read(MAX_IMAGE_BYTES + 1)
    return await IssueService(session, user).add_attachment(
        storage,
        issue_id,
        filename=file.filename,
        content_type=file.content_type,
        data=data,
    )


@router.get(
    "/{issue_id}/attachments/{attachment_id}/content",
    response_class=Response,
    summary="Read an issue screenshot",
)
async def read_issue_attachment(
    issue_id: uuid.UUID,
    attachment_id: uuid.UUID,
    user: CurrentUser,
    session: DbSession,
    storage: StorageDep,
) -> Response:
    attachment = await IssueService(session, user).get_attachment(issue_id, attachment_id)
    filename = re.sub(r'[\r\n\\"]+', "", attachment.filename)
    ascii_name = re.sub(r"[^\x20-\x7e]", "_", filename)
    return Response(
        content=await storage.get(attachment.object_key),
        media_type=attachment.content_type,
        headers={
            "Content-Disposition": f'inline; filename="{ascii_name}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=3600",
        },
    )
