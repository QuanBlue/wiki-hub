"""The issue routes and the service paths only they reach, against real
PostgreSQL.

The route handlers are called directly, the same way the other integration
tests call service methods: what is under test is each handler's own wiring
(which service call, which response shape), not FastAPI's request parsing.
pandoc and object storage are stood in for, as in ``test_issue_export``.

Requires ``WIKIHUB_TEST_DATABASE_URL``; skipped otherwise.
"""

from __future__ import annotations

import io
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import UploadFile
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import Headers

from app.api.v1 import issues as routes
from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    NotFoundError,
    PayloadTooLargeError,
    UnsupportedMediaTypeError,
)
from app.modules.issues.service import MAX_IMAGE_BYTES, MAX_IMAGES_PER_ISSUE, IssueService
from app.schemas.issue import (
    IssueAssign,
    IssueBulkRequest,
    IssueCreate,
    IssueNoteCreate,
    IssueStatusUpdate,
)
from tests.integration.test_issues import _manager, _report, _superuser, _user
from tests.unit.test_issue_export import _fake_pandoc, _load, _pandoc_like_docx

pytestmark = pytest.mark.integration

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


class _Storage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def put(self, key: str, data: bytes, **_: object) -> None:
        self.objects[key] = data

    async def get(self, key: str) -> bytes:
        return self.objects[key]


def _upload(data: bytes, *, filename: str = "shot.png", content_type: str = "image/png"):
    return UploadFile(
        file=io.BytesIO(data),
        filename=filename,
        headers=Headers({"content-type": content_type}),
    )


class TestRoutes:
    async def test_the_reporting_and_triage_round_trip(self, session: AsyncSession) -> None:
        reporter = await _user(session)
        admin = await _superuser(session)
        storage = _Storage()

        created = await routes.create_issue(
            IssueCreate(title="Export broken", description="**Bold** text", labels=["bug"]),
            reporter,
            session,
        )
        mine = await routes.list_my_issues(reporter, session, limit=20, offset=0)
        assert [issue.id for issue in mine.items] == [created.id]

        shot = await routes.upload_issue_attachment(
            created.id, _upload(PNG, filename='bad"name\r\n.png'), reporter, session, storage
        )
        content = await routes.read_issue_attachment(
            created.id, shot.id, reporter, session, storage
        )
        assert content.body == PNG
        assert content.headers["content-disposition"] == 'inline; filename="badname.png"'
        assert content.headers["x-content-type-options"] == "nosniff"

        found = await routes.list_issues(
            admin,
            session,
            q="Export",
            state="open_only",
            author=None,
            assignee=None,
            label=["bug"],
            sort="newest",
            limit=20,
            offset=0,
        )
        assert created.id in [issue.id for issue in found.items]
        counts = await routes.issue_counts(
            admin, session, q="Export", author=None, assignee=None, label=None
        )
        assert counts.open >= 1
        assert reporter.id in [person.id for person in await routes.issue_people(admin, session)]
        assert admin.id in [person.id for person in await routes.issue_assignees(admin, session)]

        read = await routes.read_issue(created.id, admin, session)
        # The screenshot is listed on the issue it belongs to.
        assert [attachment.id for attachment in read.attachments] == [shot.id]

        claimed = await routes.claim_issue(created.id, admin, session)
        assert claimed.status == "in_progress"
        in_progress = await routes.list_issues(
            admin,
            session,
            q="Export",
            state="in_progress",
            author=None,
            assignee=None,
            label=None,
            sort="newest",
            limit=20,
            offset=0,
        )
        assert [issue.id for issue in in_progress.items] == [created.id]

        noted = await routes.add_issue_note(
            created.id, IssueNoteCreate(body="Looking into it"), admin, session
        )
        assert [note.body for note in noted.notes] == ["Looking into it"]

        handed_back = await routes.assign_issue(
            created.id, IssueAssign(assignee_id=None), admin, session
        )
        assert handed_back.assignee is None

        # No mailbox exists, so closing works but the email cannot go out.
        closed = await routes.update_issue_status(
            created.id, IssueStatusUpdate(status="done", note="Fixed"), admin, session
        )
        assert closed.status == "done"
        assert closed.email == "failed"
        # Re-closing a closed issue does not email the reporter again.
        again = await routes.update_issue_status(
            created.id, IssueStatusUpdate(status="done"), admin, session
        )
        assert again.email is None

    async def test_bulk_closes_and_counts_the_emails_sent(self, session: AsyncSession) -> None:
        admin = await _superuser(session)
        first = await _report(session, await _user(session), "First")
        second = await _report(session, await _user(session), "Second")

        with patch.object(routes, "_email_reporter", AsyncMock(side_effect=["sent", "failed"])):
            result = await routes.bulk_update_issues(
                IssueBulkRequest(ids=[first.id, second.id], action="status", status="done"),
                admin,
                session,
            )

        assert result.updated == 2
        assert result.emailed == 1
        assert result.failed == []

    async def test_bulk_unassign_hands_issues_back(self, session: AsyncSession) -> None:
        admin = await _superuser(session)
        issue = await _report(session, await _user(session))
        await IssueService(session, admin).claim(issue.id)

        result = await routes.bulk_update_issues(
            IssueBulkRequest(ids=[issue.id], action="unassign"), admin, session
        )

        assert result.updated == 1
        assert (await IssueService(session, admin).read(issue.id)).assignee is None

    async def test_exports_one_or_many_issues_as_word(self, session: AsyncSession) -> None:
        reporter = await _user(session)
        admin = await _superuser(session)
        storage = _Storage()
        first = await _report(session, reporter, "First")
        second = await _report(session, reporter, "Second")
        await IssueService(session, reporter).add_attachment(
            storage, first.id, filename="a.png", content_type="image/png", data=PNG
        )

        with _fake_pandoc(_pandoc_like_docx()):
            single = await routes.export_issue_docx(first.id, admin, session, storage, lang="vi")
            many = await routes.export_issues_docx(
                admin, session, storage, ids=[first.id, second.id, first.id], lang="en"
            )

        assert single.headers["content-disposition"] == 'attachment; filename="issue-first.docx"'
        assert single.headers["cache-control"] == "no-store"
        assert _load(single.body).styles["WH Issue Eyebrow"] is not None
        assert many.headers["content-disposition"].startswith('attachment; filename="issues-2-')

    async def test_an_export_of_nothing_visible_is_not_found(self, session: AsyncSession) -> None:
        issue = await _report(session, await _user(session))
        with pytest.raises(NotFoundError):
            await IssueService(session, await _user(session)).export_docx(_Storage(), [issue.id])


class TestEmailReporter:
    async def test_an_inactive_reporter_is_not_emailed(self, session: AsyncSession) -> None:
        admin = await _superuser(session)
        reporter = await _user(session)
        issue = await _report(session, reporter)
        done = await IssueService(session, admin).set_status(issue.id, "done")
        reporter.is_active = False
        await session.flush()

        assert await routes._email_reporter(session, admin, done, None) == "skipped"

    async def test_an_unexpected_mail_error_is_reported_as_failed(
        self, session: AsyncSession
    ) -> None:
        admin = await _superuser(session)
        manager = await _manager(session)
        issue = await _report(session, await _user(session))
        await IssueService(session, manager).claim(issue.id)
        done = await IssueService(session, manager).set_status(issue.id, "done")

        with patch(
            "app.api.v1.issues.AdminMailService.send_issue_closed_email",
            AsyncMock(side_effect=RuntimeError("boom")),
        ) as send:
            outcome = await routes._email_reporter(session, admin, done, "  ")

        assert outcome == "failed"
        # The assignee is named; a blank note is not passed on.
        assert send.call_args.kwargs["taken_by"] == "Someone"
        assert send.call_args.kwargs["note"] is None


class TestServiceEdges:
    async def test_a_failing_new_issue_email_never_blocks_the_report(
        self, session: AsyncSession
    ) -> None:
        await _manager(session)
        with patch(
            "app.modules.issues.service.AdminMailService.send_issue_created_email",
            AsyncMock(side_effect=RuntimeError("smtp down")),
        ):
            issue = await _report(session, await _user(session))

        assert issue.status == "open"

    async def test_attachments_are_checked_before_they_are_stored(
        self, session: AsyncSession
    ) -> None:
        reporter = await _user(session)
        issue = await _report(session, reporter)
        service = IssueService(session, reporter)
        storage = _Storage()

        with pytest.raises(NotFoundError):
            await IssueService(session, await _user(session)).add_attachment(
                storage, issue.id, filename="a.png", content_type="image/png", data=PNG
            )
        with pytest.raises(UnsupportedMediaTypeError):
            await service.add_attachment(
                storage, issue.id, filename="a.svg", content_type="image/svg+xml", data=PNG
            )
        with pytest.raises(BadRequestError):
            await service.add_attachment(
                storage, issue.id, filename="a.png", content_type="image/png", data=b""
            )
        with pytest.raises(PayloadTooLargeError):
            await service.add_attachment(
                storage,
                issue.id,
                filename="a.png",
                content_type="image/png",
                data=b"x" * (MAX_IMAGE_BYTES + 1),
            )

        for _ in range(MAX_IMAGES_PER_ISSUE):
            # A blank or path-like name still gets a usable one.
            stored = await service.add_attachment(
                storage, issue.id, filename="../", content_type="IMAGE/PNG", data=PNG
            )
            assert stored.filename == "screenshot.png"
        with pytest.raises(BadRequestError):
            await service.add_attachment(
                storage, issue.id, filename="a.png", content_type="image/png", data=PNG
            )

    async def test_an_attachment_of_another_issue_is_not_found(self, session: AsyncSession) -> None:
        reporter = await _user(session)
        first = await _report(session, reporter, "First")
        second = await _report(session, reporter, "Second")
        service = IssueService(session, reporter)
        shot = await service.add_attachment(
            _Storage(), first.id, filename="a.png", content_type="image/png", data=PNG
        )

        with pytest.raises(NotFoundError):
            await service.get_attachment(second.id, shot.id)
        with pytest.raises(NotFoundError):
            await service.get_attachment(first.id, uuid.uuid4())

    async def test_claim_and_assign_edges(self, session: AsyncSession) -> None:
        admin = await _superuser(session)
        manager = await _manager(session)
        issue = await _report(session, await _user(session))
        service = IssueService(session, manager)

        # Unassigning an issue nobody holds changes nothing.
        assert (await service.assign(issue.id, None)).assignee is None

        claimed = await service.claim(issue.id)
        # Claiming twice, or assigning to the current holder, is a no-op.
        assert (await service.claim(issue.id)).assignee.id == manager.id
        same = await IssueService(session, admin).assign(issue.id, manager.id)
        assert same.assignee.id == claimed.assignee.id

        await IssueService(session, admin).set_status(issue.id, "done")
        with pytest.raises(ConflictError):
            await service.claim(issue.id)
        with pytest.raises(ConflictError):
            await IssueService(session, admin).assign(issue.id, None)


class TestSchemas:
    def test_blank_title_and_note_are_refused(self) -> None:
        with pytest.raises(ValidationError):
            IssueCreate(title="   ")
        with pytest.raises(ValidationError):
            IssueNoteCreate(body="   ")

    def test_bulk_actions_need_their_argument(self) -> None:
        ids = [uuid.uuid4()]
        with pytest.raises(ValidationError, match="A status is required"):
            IssueBulkRequest(ids=ids, action="status")
        with pytest.raises(ValidationError, match="An assignee is required"):
            IssueBulkRequest(ids=ids, action="assign")
        assert IssueBulkRequest(ids=ids, action="unassign").action == "unassign"
