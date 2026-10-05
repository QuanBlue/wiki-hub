"""Issues, against real PostgreSQL.

What matters is who may do what: a reporter sees only their own issues; a
triager (superuser, system admin, or `manage_issues`) sees all and may claim;
and only the assignee or a *superuser* may change the status - a system
administrator who is not the assignee may not. Notifications go to triagers on
a new issue and to the reporter when it is claimed or finished.

Requires ``WIKIHUB_TEST_DATABASE_URL``; skipped otherwise.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.issues import _email_reporter
from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    UnsupportedMediaTypeError,
)
from app.models.issue import Issue
from app.models.permission import GlobalPermission
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.issues.service import IssueService
from app.modules.notifications.service import NotificationService
from app.modules.permissions.service import PermissionService
from app.schemas.issue import IssueCreate
from app.schemas.user import UserCreate
from tests.integration.conftest import unique
from tests.integration.test_admin_mail_service import _mailbox
from tests.unit.test_admin_mail_smtp import _Server, smtp_server  # noqa: F401

pytestmark = pytest.mark.integration


async def _user(session: AsyncSession, **overrides: object) -> User:
    values: dict[str, object] = {
        "username": unique("user"),
        "email": f"{unique('user')}@example.org",
        "full_name": "Someone",
        "password": "Member-password-1",
    }
    values.update(overrides)
    return await AuthService(session).create_user(UserCreate(**values))


async def _superuser(session: AsyncSession) -> User:
    user = await _user(session)
    user.is_superuser = True
    await session.flush()
    return user


async def _manager(session: AsyncSession) -> User:
    user = await _user(session)
    await PermissionService(session).set_user_permission_overrides(
        user, {GlobalPermission.manage_issues: True}
    )
    await session.flush()
    return user


async def _system_admin(session: AsyncSession) -> User:
    user = await _user(session)
    await PermissionService(session).set_user_permission_overrides(
        user, {GlobalPermission.system_admin: True}
    )
    await session.flush()
    return user


async def _report(session: AsyncSession, reporter: User, title: str = "Broken"):
    return await IssueService(session, reporter).create(
        IssueCreate(title=title, description="It broke when I clicked save.")
    )


class _Storage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def put(self, key: str, data: bytes, **_: object) -> None:
        self.objects[key] = data


class TestVisibility:
    async def test_reporter_sees_only_their_own(self, session: AsyncSession) -> None:
        alice, bob = await _user(session), await _user(session)
        issue = await _report(session, alice)

        mine = await IssueService(session, alice).list_mine(limit=20, offset=0)
        assert [i.id for i in mine.items] == [issue.id]
        assert (await IssueService(session, bob).list_mine(limit=20, offset=0)).items == []
        with pytest.raises(NotFoundError):
            await IssueService(session, bob).read(issue.id)

    async def test_plain_user_cannot_list_everything(self, session: AsyncSession) -> None:
        with pytest.raises(PermissionDeniedError):
            await IssueService(session, await _user(session)).list_all(limit=20, offset=0)

    @pytest.mark.parametrize("factory", [_superuser, _system_admin, _manager])
    async def test_every_kind_of_triager_sees_all(self, session: AsyncSession, factory) -> None:
        issue = await _report(session, await _user(session))
        triager = await factory(session)

        page = await IssueService(session, triager).list_all(limit=20, offset=0)
        assert issue.id in [i.id for i in page.items]

    async def test_a_denied_manager_override_removes_access(self, session: AsyncSession) -> None:
        user = await _manager(session)
        await PermissionService(session).set_user_permission_overrides(
            user, {GlobalPermission.manage_issues: False}
        )
        await session.flush()
        with pytest.raises(PermissionDeniedError):
            await IssueService(session, user).list_all(limit=20, offset=0)


class TestClaimAndStatus:
    async def test_claim_assigns_and_marks_in_progress(self, session: AsyncSession) -> None:
        issue = await _report(session, await _user(session))
        manager = await _manager(session)

        claimed = await IssueService(session, manager).claim(issue.id)
        assert claimed.status == "in_progress"
        assert claimed.assignee is not None and claimed.assignee.id == manager.id

    async def test_plain_user_cannot_claim(self, session: AsyncSession) -> None:
        issue = await _report(session, await _user(session))
        with pytest.raises(PermissionDeniedError):
            await IssueService(session, await _user(session)).claim(issue.id)

    async def test_second_manager_cannot_take_a_claimed_issue(self, session: AsyncSession) -> None:
        issue = await _report(session, await _user(session))
        await IssueService(session, await _manager(session)).claim(issue.id)
        with pytest.raises(ConflictError):
            await IssueService(session, await _manager(session)).claim(issue.id)

    async def test_assignee_can_finish(self, session: AsyncSession) -> None:
        issue = await _report(session, await _user(session))
        manager = await _manager(session)
        await IssueService(session, manager).claim(issue.id)

        done = await IssueService(session, manager).set_status(issue.id, "done")
        assert done.status == "done" and done.resolved_at is not None

    async def test_system_admin_who_is_not_the_assignee_cannot_change_status(
        self, session: AsyncSession
    ) -> None:
        issue = await _report(session, await _user(session))
        await IssueService(session, await _manager(session)).claim(issue.id)

        with pytest.raises(PermissionDeniedError):
            await IssueService(session, await _system_admin(session)).set_status(issue.id, "done")

    async def test_superuser_can_change_status_of_anyones_issue(
        self, session: AsyncSession
    ) -> None:
        issue = await _report(session, await _user(session))
        await IssueService(session, await _manager(session)).claim(issue.id)

        done = await IssueService(session, await _superuser(session)).set_status(issue.id, "done")
        assert done.status == "done"

    async def test_reopening_clears_the_resolved_time(self, session: AsyncSession) -> None:
        issue = await _report(session, await _user(session))
        manager = await _manager(session)
        await IssueService(session, manager).claim(issue.id)
        await IssueService(session, manager).set_status(issue.id, "done")

        reopened = await IssueService(session, manager).set_status(issue.id, "in_progress")
        assert reopened.resolved_at is None


class TestNotifications:
    async def test_new_issue_alerts_triagers_but_not_the_reporter(
        self, session: AsyncSession
    ) -> None:
        manager = await _manager(session)
        bystander = await _user(session)
        reporter = await _manager(session)  # a triager reporting their own issue

        await _report(session, reporter)

        kinds = [
            n.kind
            for n in (
                await NotificationService(session, manager).list(
                    unread_only=False, limit=20, offset=0
                )
            ).items
        ]
        assert kinds == ["issue_created"]
        assert (
            await NotificationService(session, bystander).list(
                unread_only=False, limit=20, offset=0
            )
        ).items == []
        assert (
            await NotificationService(session, reporter).list(unread_only=False, limit=20, offset=0)
        ).items == []

    async def test_reporter_hears_when_claimed_and_done(self, session: AsyncSession) -> None:
        reporter = await _user(session)
        issue = await _report(session, reporter)
        manager = await _manager(session)
        await IssueService(session, manager).claim(issue.id)
        await IssueService(session, manager).set_status(issue.id, "done")

        kinds = sorted(
            n.kind
            for n in (
                await NotificationService(session, reporter).list(
                    unread_only=False, limit=20, offset=0
                )
            ).items
        )
        assert kinds == ["issue_claimed", "issue_done"]


class TestScreenshots:
    async def test_reporter_attaches_an_image_and_a_triager_can_read_it(
        self, session: AsyncSession
    ) -> None:
        reporter = await _user(session)
        issue = await _report(session, reporter)
        storage = _Storage()

        attachment = await IssueService(session, reporter).add_attachment(
            storage,  # type: ignore[arg-type]
            issue.id,
            filename="shot.png",
            content_type="image/png",
            data=b"\x89PNG-bytes",
        )
        assert storage.objects  # written to object storage

        found = await IssueService(session, await _manager(session)).get_attachment(
            issue.id, attachment.id
        )
        assert found.filename == "shot.png"
        with pytest.raises(NotFoundError):
            await IssueService(session, await _user(session)).get_attachment(
                issue.id, attachment.id
            )

    async def test_only_raster_images_are_accepted(self, session: AsyncSession) -> None:
        reporter = await _user(session)
        issue = await _report(session, reporter)
        for content_type in ("image/svg+xml", "text/html", "application/pdf"):
            with pytest.raises(UnsupportedMediaTypeError):
                await IssueService(session, reporter).add_attachment(
                    _Storage(),  # type: ignore[arg-type]
                    issue.id,
                    filename="x",
                    content_type=content_type,
                    data=b"data",
                )

    async def test_someone_else_cannot_attach_to_my_issue(self, session: AsyncSession) -> None:
        issue = await _report(session, await _user(session))
        with pytest.raises(NotFoundError):
            await IssueService(session, await _user(session)).add_attachment(
                _Storage(),  # type: ignore[arg-type]
                issue.id,
                filename="x.png",
                content_type="image/png",
                data=b"data",
            )


class TestSearchAndFilters:
    async def _setup(self, session: AsyncSession):
        alice, bob = await _user(session), await _user(session)
        manager = await _manager(session)
        saving = await _report(session, alice, "Cannot save page")
        await _report(session, bob, "Search is slow")
        done = await _report(session, alice, "Typo on 100% banner")
        service = IssueService(session, manager)
        await service.claim(done.id)
        await service.set_status(done.id, "done")
        return alice, bob, manager, saving, done, service

    async def test_free_text_matches_title_and_description_word_by_word(
        self, session: AsyncSession
    ) -> None:
        *_, service = await self._setup(session)

        page = await service.list_all(text="save page", limit=20, offset=0)
        assert [i.title for i in page.items] == ["Cannot save page"]
        # The description is searched too ("It broke when I clicked save." is on
        # every issue), and every word has to match somewhere.
        assert (await service.list_all(text="broke clicked", limit=20, offset=0)).total == 3
        assert (await service.list_all(text="banner clicked", limit=20, offset=0)).total == 1
        assert (await service.list_all(text="banner unicorn", limit=20, offset=0)).total == 0

    async def test_percent_and_underscore_in_text_are_literal(self, session: AsyncSession) -> None:
        *_, service = await self._setup(session)

        assert (await service.list_all(text="100%", limit=20, offset=0)).total == 1
        assert (await service.list_all(text="%", limit=20, offset=0)).total == 1
        assert (await service.list_all(text="_", limit=20, offset=0)).total == 0

    async def test_state_open_includes_in_progress_and_closed_means_done(
        self, session: AsyncSession
    ) -> None:
        *_, service = await self._setup(session)

        assert (await service.list_all(state="open", limit=20, offset=0)).total == 2
        closed = await service.list_all(state="closed", limit=20, offset=0)
        assert [i.title for i in closed.items] == ["Typo on 100% banner"]

    async def test_author_and_assignee_filters(self, session: AsyncSession) -> None:
        alice, bob, manager, _saving, _done, service = await self._setup(session)

        by_bob = await service.list_all(author=bob.username.upper(), limit=20, offset=0)
        assert [i.title for i in by_bob.items] == ["Search is slow"]
        taken = await service.list_all(assignee=manager.username, limit=20, offset=0)
        assert [i.title for i in taken.items] == ["Typo on 100% banner"]
        nobody = await service.list_all(assignee="none", limit=20, offset=0)
        assert nobody.total == 2
        assert (await service.list_all(assignee="@me", limit=20, offset=0)).total == 1
        assert (await service.list_all(author="no-such-user", limit=20, offset=0)).total == 0
        assert alice.username  # silence unused

    async def test_sort_orders(self, session: AsyncSession) -> None:
        *_, service = await self._setup(session)
        # Issues made inside one transaction share a `now()`; space them out.
        for age, title in enumerate(["Typo on 100% banner", "Search is slow", "Cannot save page"]):
            await session.execute(
                update(Issue)
                .where(Issue.title == title)
                .values(created_at=datetime(2026, 1, 1, tzinfo=UTC) + timedelta(days=age))
            )
        await session.flush()

        newest = [i.title for i in (await service.list_all(limit=20, offset=0)).items]
        oldest = [
            i.title for i in (await service.list_all(sort="oldest", limit=20, offset=0)).items
        ]
        assert oldest == list(reversed(newest))

    async def test_counts_follow_the_search_but_not_the_state(self, session: AsyncSession) -> None:
        alice, _bob, _manager, _saving, _done, service = await self._setup(session)

        everything = await service.counts()
        assert (everything.open, everything.in_progress, everything.done) == (2, 0, 1)
        hers = await service.counts(author=alice.username)
        assert (hers.open, hers.done) == (1, 1)
        assert (await service.counts(text="slow")).open == 1

    async def test_people_lists_reporters_and_assignees_only(self, session: AsyncSession) -> None:
        alice, bob, manager, *_, service = await self._setup(session)
        bystander = await _user(session)

        usernames = {p.username for p in await service.people()}
        assert {alice.username, bob.username, manager.username} <= usernames
        assert bystander.username not in usernames

    async def test_plain_user_cannot_use_the_manager_views(self, session: AsyncSession) -> None:
        plain = IssueService(session, await _user(session))
        with pytest.raises(PermissionDeniedError):
            await plain.people()
        with pytest.raises(PermissionDeniedError):
            await plain.counts()


class TestNotes:
    async def test_managers_see_every_note_the_reporter_only_public_ones(
        self, session: AsyncSession
    ) -> None:
        reporter = await _user(session)
        issue = await _report(session, reporter)
        manager = await _manager(session)
        service = IssueService(session, manager)
        await service.claim(issue.id)
        await service.add_note(issue.id, "Looks like a cache problem.")
        await service.set_status(issue.id, "done", "Fixed in today's release.")

        for_manager = await service.read(issue.id)
        assert [(n.body, n.public) for n in for_manager.notes] == [
            ("Looks like a cache problem.", False),
            ("Fixed in today's release.", True),
        ]
        for_reporter = await IssueService(session, reporter).read(issue.id)
        assert [(n.body, n.public) for n in for_reporter.notes] == [
            ("Fixed in today's release.", True)
        ]
        assert for_reporter.notes[0].author is not None

    async def test_a_plain_user_cannot_add_a_note(self, session: AsyncSession) -> None:
        reporter = await _user(session)
        issue = await _report(session, reporter)
        with pytest.raises(PermissionDeniedError):
            await IssueService(session, reporter).add_note(issue.id, "sneaky")

    async def test_the_closing_note_is_only_kept_when_closing(self, session: AsyncSession) -> None:
        issue = await _report(session, await _user(session))
        manager = await _manager(session)
        service = IssueService(session, manager)
        await service.claim(issue.id)

        progressed = await service.set_status(issue.id, "in_progress", "ignored")
        assert progressed.notes == []


class TestEmails:
    async def test_new_issue_emails_the_managers_through_a_working_mailbox(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        manager = await _superuser(session)
        await _mailbox(session, manager, smtp_server)
        other = await _manager(session)
        reporter = await _user(session)

        await _report(session, reporter, "Login page crashes")

        recipients = sorted(
            address for envelope in smtp_server.envelopes for address in envelope.rcpt_tos
        )
        assert recipients == sorted([manager.email, other.email])
        body = smtp_server.envelopes[0].content.decode(errors="replace")
        assert "Login page crashes" in body

    async def test_no_mailbox_means_no_email_but_the_issue_is_still_reported(
        self, session: AsyncSession
    ) -> None:
        await _manager(session)
        issue = await _report(session, await _user(session))
        assert issue.status == "open"

    async def test_closing_emails_the_reporter_with_the_note(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin = await _superuser(session)
        await _mailbox(session, admin, smtp_server)
        reporter = await _user(session)
        issue = await _report(session, reporter, "Cannot save")
        smtp_server.envelopes.clear()
        done = await IssueService(session, admin).set_status(issue.id, "done", "Fixed it.")

        outcome = await _email_reporter(session, admin, done, "Fixed it.")

        assert outcome == "sent"
        (envelope,) = smtp_server.envelopes
        assert envelope.rcpt_tos == [reporter.email]
        body = envelope.content.decode(errors="replace")
        assert "Cannot save" in body and "Fixed it." in body

    async def test_closing_your_own_issue_sends_nothing(self, session: AsyncSession) -> None:
        admin = await _superuser(session)
        issue = await _report(session, admin)
        done = await IssueService(session, admin).set_status(issue.id, "done")

        assert await _email_reporter(session, admin, done, None) == "skipped"

    async def test_a_mail_problem_never_blocks_closing(self, session: AsyncSession) -> None:
        # No mailbox anywhere: the status change stands, the email is "failed".
        admin = await _superuser(session)
        issue = await _report(session, await _user(session))
        done = await IssueService(session, admin).set_status(issue.id, "done")

        assert done.status == "done"
        assert await _email_reporter(session, admin, done, None) == "failed"


class TestAssign:
    async def test_superuser_can_hand_an_issue_to_another_manager(
        self, session: AsyncSession
    ) -> None:
        reporter = await _user(session)
        issue = await _report(session, reporter)
        boss, worker = await _superuser(session), await _manager(session)

        handed = await IssueService(session, boss).assign(issue.id, worker.id)

        assert handed.status == "in_progress"
        assert handed.assignee is not None and handed.assignee.id == worker.id
        mine = await NotificationService(session, worker).list(
            unread_only=False, limit=50, offset=0
        )
        assert "issue_assigned" in [n.kind for n in mine.items]
        told = await NotificationService(session, reporter).list(
            unread_only=False, limit=50, offset=0
        )
        assert "issue_assigned_reporter" in [n.kind for n in told.items]

    async def test_a_manager_cannot_give_an_issue_to_someone_else(
        self, session: AsyncSession
    ) -> None:
        issue = await _report(session, await _user(session))
        with pytest.raises(PermissionDeniedError):
            await IssueService(session, await _manager(session)).assign(
                issue.id, (await _manager(session)).id
            )

    async def test_assigning_yourself_is_taking_it(self, session: AsyncSession) -> None:
        issue = await _report(session, await _user(session))
        manager = await _manager(session)

        taken = await IssueService(session, manager).assign(issue.id, manager.id)
        assert taken.assignee is not None and taken.assignee.id == manager.id

    async def test_the_assignee_must_be_able_to_manage_issues(self, session: AsyncSession) -> None:
        issue = await _report(session, await _user(session))
        with pytest.raises(BadRequestError):
            await IssueService(session, await _superuser(session)).assign(
                issue.id, (await _user(session)).id
            )

    async def test_handing_back_is_for_the_assignee_or_a_superuser(
        self, session: AsyncSession
    ) -> None:
        issue = await _report(session, await _user(session))
        worker = await _manager(session)
        await IssueService(session, worker).claim(issue.id)

        with pytest.raises(PermissionDeniedError):
            await IssueService(session, await _manager(session)).assign(issue.id, None)
        back = await IssueService(session, worker).assign(issue.id, None)
        assert back.assignee is None and back.status == "open"

    async def test_assignable_people_are_the_managers(self, session: AsyncSession) -> None:
        manager, bystander = await _manager(session), await _user(session)
        usernames = {p.username for p in await IssueService(session, manager).assignable_people()}
        assert manager.username in usernames and bystander.username not in usernames


class TestBulk:
    async def test_applies_to_each_issue_under_its_own_rules(self, session: AsyncSession) -> None:
        reporter = await _user(session)
        mine, theirs, untaken = (
            await _report(session, reporter, "A"),
            await _report(session, reporter, "B"),
            await _report(session, reporter, "C"),
        )
        me, other = await _manager(session), await _manager(session)
        await IssueService(session, me).claim(mine.id)
        await IssueService(session, other).claim(theirs.id)

        updated, failed, closed = await IssueService(session, me).bulk(
            [mine.id, theirs.id, untaken.id], action="status", status="done", note="done!"
        )

        # Only the one this manager took can be closed; the others are skipped.
        assert [i.id for i in updated] == [mine.id]
        assert {issue_id for issue_id, _ in failed} == {theirs.id, untaken.id}
        assert [i.id for i in closed] == [mine.id]

    async def test_a_superuser_can_close_everything_and_assign_in_bulk(
        self, session: AsyncSession
    ) -> None:
        reporter = await _user(session)
        first, second = await _report(session, reporter), await _report(session, reporter)
        boss, worker = await _superuser(session), await _manager(session)
        service = IssueService(session, boss)

        updated, failed, _ = await service.bulk(
            [first.id, second.id], action="assign", assignee_id=worker.id
        )
        assert len(updated) == 2 and failed == []

        _, failed, closed = await service.bulk(
            [first.id, second.id], action="status", status="done"
        )
        assert failed == [] and len(closed) == 2
        # Already done: closing again is not "newly closed".
        _, _, closed_again = await service.bulk([first.id], action="status", status="done")
        assert closed_again == []

    async def test_duplicates_and_unknown_ids_are_handled(self, session: AsyncSession) -> None:
        issue = await _report(session, await _user(session))
        boss = await _superuser(session)
        ghost = uuid.uuid4()

        updated, failed, _ = await IssueService(session, boss).bulk(
            [issue.id, issue.id, ghost], action="status", status="in_progress"
        )

        assert len(updated) == 1
        assert failed == [(ghost, "issue_not_found")]

    async def test_a_plain_user_cannot_use_it(self, session: AsyncSession) -> None:
        with pytest.raises(PermissionDeniedError):
            await IssueService(session, await _user(session)).bulk(
                [uuid.uuid4()], action="status", status="done"
            )


class TestLabels:
    async def test_labels_are_saved_and_filterable(self, session: AsyncSession) -> None:
        admin = await _superuser(session)
        reporter = await _user(session)
        service = IssueService(session, reporter)
        both = await service.create(IssueCreate(title="Both", labels=["question", "bug", "bug"]))
        only_bug = await service.create(IssueCreate(title="Bug", labels=["bug"]))
        bare = await service.create(IssueCreate(title="Bare"))

        # Stored once each, in the order the labels are defined.
        assert both.labels == ["bug", "question"]
        assert bare.labels == []

        triage = IssueService(session, admin)
        ids = lambda page: {item.id for item in page.items}  # noqa: E731
        every_bug = await triage.list_all(labels=["bug"], limit=20, offset=0)
        assert {both.id, only_bug.id} <= ids(every_bug)
        assert bare.id not in ids(every_bug)
        # Several labels mean all of them.
        both_labels = await triage.list_all(labels=["bug", "question"], limit=20, offset=0)
        assert both.id in ids(both_labels) and only_bug.id not in ids(both_labels)
        # "none" is the issues without any label.
        unlabelled = await triage.list_all(labels=["none"], limit=20, offset=0)
        assert bare.id in ids(unlabelled) and both.id not in ids(unlabelled)
        # The tab counts follow the label filter too.
        counts = await triage.counts(labels=["question"])
        assert counts.open == 1

    async def test_an_unknown_label_is_rejected(self) -> None:
        with pytest.raises(ValueError):
            IssueCreate(title="x", labels=["not-a-label"])


class TestUndeliverableAddresses:
    def test_placeholder_domains_are_not_mailed(self) -> None:
        from app.modules.admin_mail.service import is_deliverable_address

        assert is_deliverable_address("someone@viettel.com.vn")
        assert not is_deliverable_address("admin@wikihub.local")
        assert not is_deliverable_address("a@localhost")
        assert not is_deliverable_address("a@host.invalid")
        assert not is_deliverable_address("no-at-sign")
        assert not is_deliverable_address(None)
