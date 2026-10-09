"""Administrator mail end to end: real PostgreSQL and a real SMTP server.

The unit tests replace the database and the network, so they cannot show that
the queries behind the Inbox are right or that a whole request - stored,
mailed, read back - holds together. These run the actual SQL and the actual
SMTP conversation.

Requires ``WIKIHUB_TEST_DATABASE_URL``; skipped otherwise.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError, NotFoundError, PermissionDeniedError
from app.models.admin_mail import AdminMailbox, AdminRequest, AdminRequestRecipient
from app.models.notification import Notification
from app.models.user import User
from app.modules.admin_mail.crypto import encrypt_password
from app.modules.admin_mail.service import AdminMailService
from app.modules.auth.service import AuthService
from app.schemas.admin_mail import ContactAdminCreate, InboxUpdate, MailboxCreate, MailboxUpdate
from app.schemas.user import UserCreate
from tests.integration.conftest import unique
from tests.unit.test_admin_mail_smtp import PASSWORD, USERNAME, _Server, smtp_server  # noqa: F401

pytestmark = pytest.mark.integration


async def _admin(session: AsyncSession) -> User:
    return await AuthService(session).create_user(
        UserCreate(
            username=unique("ops"),
            email=f"{unique('ops')}@example.com",
            full_name="Ops",
            password="ops-password-1",
            is_superuser=True,
        )
    )


async def _mailbox(
    session: AsyncSession, user: User, server: _Server, *, password: str = PASSWORD
) -> AdminMailbox:
    service = AdminMailService(session, actor=user)
    read = await service.create_mailbox(
        MailboxCreate(
            user_id=user.id,
            # The test server only accepts this one login, so every mailbox
            # shares it; what differs between them is the password on file.
            email=USERNAME,
            smtp_host="127.0.0.1",
            smtp_port=server.port,
            smtp_security="none",
            # A mailbox can only be created with a password that works...
            smtp_password=PASSWORD,
        )
    )
    mailbox = await session.get(AdminMailbox, read.id)
    assert mailbox is not None
    if password != PASSWORD:
        # ...so a password that has since expired is simulated afterwards.
        mailbox.smtp_password_enc = encrypt_password(password)
        await session.flush()
    return mailbox


def _request(**overrides: object) -> ContactAdminCreate:
    values: dict[str, object] = {
        "kind": "account",
        "requester_name": "Alice",
        "requester_email": "alice@example.org",
        "message": "Please create an account for me.",
    }
    values.update(overrides)
    return ContactAdminCreate(**values)


class TestDeliveryEndToEnd:
    async def test_a_request_reaches_the_inbox_and_the_mailbox(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin = await _admin(session)
        await _mailbox(session, admin, smtp_server)
        service = AdminMailService(session)
        # Nothing has arrived yet, so there is nothing for the shell to notice.
        assert (await service.summary(admin)).latest_request_at is None

        result = await service.submit_request(_request(), client_ip="203.0.113.5")

        assert result == "sent"
        assert len(smtp_server.envelopes) == 1
        summary = await AdminMailService(session).summary(admin)
        assert summary.has_mailbox is True
        assert summary.unread_count == 1
        # The signal the shell polls to pick up a new request at once.
        assert summary.latest_request_at is not None
        assert summary.health_status == "ok"
        page = await AdminMailService(session).list_inbox(admin, status="all", limit=20, offset=0)
        (item,) = page.items
        assert (item.requester_name, item.delivery_status) == ("Alice", "sent")

    async def test_one_expired_mailbox_does_not_hide_the_request_or_alarm_the_requester(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        healthy, expired = await _admin(session), await _admin(session)
        await _mailbox(session, healthy, smtp_server)
        stale = await _mailbox(session, expired, smtp_server, password="the-old-password")
        # Saved while its password still worked; the failure is only noticed
        # when a request cannot be sent.
        assert stale.health_status == "ok"

        result = await AdminMailService(session).submit_request(_request(), client_ip=None)

        # One administrator was reached, so the requester is not told to chase anyone.
        assert result == "sent"
        expired_inbox = await AdminMailService(session).list_inbox(
            expired, status="all", limit=20, offset=0
        )
        # The expired mailbox's owner still sees the request in the app, marked
        # as not emailed - which is how they learn something is wrong.
        (item,) = expired_inbox.items
        assert item.delivery_status == "failed"
        assert await AdminMailService(session).summary(expired) is not None
        assert (await AdminMailService(session).summary(expired)).health_status == "auth_failed"

    async def test_when_every_mailbox_fails_the_requester_is_told_but_the_request_is_kept(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin = await _admin(session)
        await _mailbox(session, admin, smtp_server, password="wrong")

        result = await AdminMailService(session).submit_request(_request(), client_ip=None)

        assert result == "failed"
        page = await AdminMailService(session).list_inbox(admin, status="all", limit=20, offset=0)
        assert page.total == 1

    async def test_with_no_mailbox_configured_nobody_is_emailed(
        self, session: AsyncSession
    ) -> None:
        assert await AdminMailService(session).submit_request(_request(), client_ip=None) == (
            "no_mailbox"
        )

    async def test_with_no_mailbox_every_administrator_is_still_told(
        self, session: AsyncSession
    ) -> None:
        """No mailbox means no email - but the request must not go unseen:
        every system administrator gets it in the bell and on Requests."""
        admin = await _admin(session)
        result = await AdminMailService(session).submit_request(
            _request(requester_email="waiting@example.org"), client_ip=None
        )
        assert result == "no_mailbox"
        told = (
            await session.execute(
                select(Notification).where(
                    Notification.user_id == admin.id, Notification.kind == "admin_request"
                )
            )
        ).scalar_one()
        assert told.link.startswith("/admin/inbox?request=")
        page = await AdminMailService(session).list_inbox(admin, status="all", limit=20, offset=0)
        assert [item.requester_email for item in page.items] == ["waiting@example.org"]
        assert page.items[0].delivery_status == "none"


class TestWhoReceives:
    async def test_disabling_the_account_stops_its_mailbox_receiving(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin = await _admin(session)
        await _mailbox(session, admin, smtp_server)

        admin.is_active = False
        await session.flush()
        result = await AdminMailService(session).submit_request(_request(), client_ip=None)

        # No second step: the mailbox row never changed, yet it no longer counts.
        assert result == "no_mailbox"
        assert smtp_server.envelopes == []

    async def test_switching_the_mailbox_off_stops_it_receiving(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin = await _admin(session)
        mailbox = await _mailbox(session, admin, smtp_server)

        mailbox.is_enabled = False
        await session.flush()

        assert await AdminMailService(session).submit_request(_request(), client_ip=None) == (
            "no_mailbox"
        )
        # Nothing was emailed, but the administrator still sees and can handle it.
        page = await AdminMailService(session).list_inbox(admin, status="all", limit=20, offset=0)
        assert page.total == 1
        assert smtp_server.envelopes == []

    async def test_every_administrator_sees_every_request_mailbox_or_not(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        """Whoever gets there first handles it - a mailbox only decides where
        the email goes. Both are told in the bell; the one without a mailbox
        sees that it *was* emailed (to the other's mailbox)."""
        with_box, without = await _admin(session), await _admin(session)
        await _mailbox(session, with_box, smtp_server)
        await AdminMailService(session).submit_request(_request(), client_ip=None)

        summary = await AdminMailService(session).summary(without)
        assert summary.has_mailbox is False and summary.has_inbox is True
        assert summary.unread_count == 1
        (item,) = (
            await AdminMailService(session).list_inbox(without, status="all", limit=20, offset=0)
        ).items
        assert item.delivery_status == "sent"
        for admin in (with_box, without):
            told = await session.scalar(
                select(func.count())
                .select_from(Notification)
                .where(Notification.user_id == admin.id, Notification.kind == "admin_request")
            )
            assert told == 1

        # Resolved by one, it is resolved for the other too, and nobody is
        # left with an unread bell notification about it.
        await AdminMailService(session).update_inbox_item(
            without, item.id, InboxUpdate(resolved=True)
        )
        (seen,) = (
            await AdminMailService(session).list_inbox(with_box, status="all", limit=20, offset=0)
        ).items
        assert seen.resolved_at is not None
        unread_bells = await session.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.kind == "admin_request", Notification.read_at.is_(None))
        )
        assert unread_bells == 0

    async def test_someone_who_is_not_an_administrator_sees_no_inbox(
        self, session: AsyncSession
    ) -> None:
        member = await AuthService(session).create_user(
            UserCreate(
                username=unique("member"),
                email=f"{unique('member')}@example.com",
                full_name="Member",
                password="member-password-1",
            )
        )
        await AdminMailService(session).submit_request(_request(), client_ip=None)
        assert (await AdminMailService(session).summary(member)).has_inbox is False
        with pytest.raises(PermissionDeniedError):
            await AdminMailService(session).list_inbox(member, status="all", limit=20, offset=0)


class TestInboxQueries:
    async def _setup(
        self, session: AsyncSession, server: _Server, requests: int
    ) -> tuple[User, User]:
        first, second = await _admin(session), await _admin(session)
        await _mailbox(session, first, server)
        await _mailbox(session, second, server)
        for index in range(requests):
            await AdminMailService(session).submit_request(
                _request(requester_name=f"User {index}"), client_ip=None
            )
        # `now()` is the transaction's start, so requests made inside one test
        # transaction would all tie; real ones each have a transaction of their own.
        base = datetime.now(UTC)
        for row in (await session.execute(select(AdminRequest))).scalars():
            row.created_at = base + timedelta(seconds=int(row.requester_name.split()[-1]))
        await session.flush()
        return first, second

    async def test_read_state_is_per_account_and_resolution_is_shared(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        first, second = await self._setup(session, smtp_server, 1)
        service = AdminMailService(session)
        (item,) = (await service.list_inbox(first, status="all", limit=20, offset=0)).items

        await service.update_inbox_item(first, item.id, InboxUpdate(read=True))

        assert (await service.summary(first)).unread_count == 0
        assert (await service.summary(second)).unread_count == 1

        await service.update_inbox_item(second, item.id, InboxUpdate(resolved=True))

        seen_by_first = await service.get_inbox_item(first, item.id)
        assert seen_by_first.resolved_at is not None

    async def test_filters_and_paging_agree_with_the_totals(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        first, _second = await self._setup(session, smtp_server, 5)
        service = AdminMailService(session)
        everything = await service.list_inbox(first, status="all", limit=20, offset=0)
        await service.update_inbox_item(first, everything.items[0].id, InboxUpdate(resolved=True))

        page = await service.list_inbox(first, status="all", limit=2, offset=2)
        unread = await service.list_inbox(first, status="unread", limit=20, offset=0)
        resolved = await service.list_inbox(first, status="resolved", limit=20, offset=0)
        open_items = await service.list_inbox(first, status="open", limit=20, offset=0)

        assert everything.total == 5
        assert (page.total, len(page.items)) == (5, 2)
        # Newest first: the last request submitted is at the top.
        assert everything.items[0].requester_name == "User 4"
        assert unread.total == 4  # resolving marked one as read
        assert resolved.total == 1
        assert open_items.total == 4

    async def test_the_type_filter_and_the_tab_counts_agree_with_the_list(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        first, _second = await self._setup(session, smtp_server, 4)
        kinds = ["account", "account", "password_reset", "other"]
        for row in (await session.execute(select(AdminRequest))).scalars():
            row.kind = kinds[int(row.requester_name.split()[-1])]
        await session.flush()
        service = AdminMailService(session)
        everything = await service.list_inbox(first, status="all", limit=20, offset=0)
        await service.update_inbox_item(first, everything.items[0].id, InboxUpdate(resolved=True))

        accounts = await service.list_inbox(first, status="all", limit=20, offset=0, kind="account")
        resets_open = await service.list_inbox(
            first, status="open", limit=20, offset=0, kind="password_reset"
        )
        paged = await service.list_inbox(first, status="all", limit=1, offset=1, kind="account")

        assert (accounts.total, {i.kind for i in accounts.items}) == (2, {"account"})
        assert resets_open.total == 1
        assert (paged.total, len(paged.items)) == (2, 1)
        # Every tab's number is what clicking it would list, with or without a type.
        overall = await service.inbox_counts(first)
        assert overall.model_dump() == {"all": 4, "unread": 3, "open": 3, "resolved": 1}
        only_accounts = await service.inbox_counts(first, kind="account")
        assert only_accounts.model_dump() == {"all": 2, "unread": 2, "open": 2, "resolved": 0}
        for status in ("all", "unread", "open", "resolved"):
            listed = await service.list_inbox(first, status=status, limit=20, offset=0)
            assert getattr(overall, status) == listed.total

    async def test_an_administrator_without_a_mailbox_still_gets_counts(
        self,
        session: AsyncSession,
    ) -> None:
        admin = await _admin(session)
        await AdminMailService(session).submit_request(_request(), client_ip=None)
        counts = await AdminMailService(session).inbox_counts(admin)
        assert counts.all == 1 and counts.unread == 1

    async def test_mark_all_read_only_touches_the_callers_rows(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        first, second = await self._setup(session, smtp_server, 3)
        service = AdminMailService(session)

        await service.mark_all_read(first)

        assert (await service.summary(first)).unread_count == 0
        assert (await service.summary(second)).unread_count == 3


class TestHealthAndPassword:
    async def test_the_hourly_check_notices_a_password_that_stopped_working_and_a_new_one_fixes_it(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin = await _admin(session)
        mailbox = await _mailbox(session, admin, smtp_server)
        service = AdminMailService(session, actor=admin)
        assert mailbox.health_status == "ok"

        # The provider forces a password change.
        smtp_server.password = "rotated-by-the-provider"
        summary = await service.run_healthcheck()

        assert summary.needs_attention == 1
        assert (await service.summary(admin)).health_status == "auth_failed"

        # A wrong new password is refused, not saved...
        with pytest.raises(Exception, match="rejected") as caught:
            await service.set_password(mailbox.id, "still-wrong")
        assert getattr(caught.value, "code", None) == "mail_auth_failed"
        assert (await service.summary(admin)).health_status == "auth_failed"

        # ...and the real one clears the banner at once.
        await service.set_password(mailbox.id, "rotated-by-the-provider")
        assert (await service.summary(admin)).health_status == "ok"

    async def test_a_disabled_account_is_not_dialled_by_the_healthcheck(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin = await _admin(session)
        mailbox = await _mailbox(session, admin, smtp_server)
        smtp_server.password = "rotated"
        admin.is_active = False
        await session.flush()

        summary = await AdminMailService(session).run_healthcheck()

        assert summary.checked == 0
        assert mailbox.health_status == "ok"  # untouched


class TestCleanup:
    async def test_deleting_an_account_removes_its_mailbox_and_its_inbox_rows(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        keep, remove = await _admin(session), await _admin(session)
        await _mailbox(session, keep, smtp_server)
        await _mailbox(session, remove, smtp_server)
        await AdminMailService(session).submit_request(_request(), client_ip=None)

        await session.delete(remove)
        await session.flush()

        boxes = (await session.execute(select(func.count()).select_from(AdminMailbox))).scalar_one()
        rows = (
            await session.execute(select(func.count()).select_from(AdminRequestRecipient))
        ).scalar_one()
        assert (boxes, rows) == (1, 1)


class TestMailboxPool:
    """`working_mailboxes()` - the real SQL behind `_resolve_sender`'s pool
    fallback - against a real database: connected accounts only, never the
    actor's own row, and never one whose account was disabled."""

    async def test_an_administrator_with_no_mailbox_sends_through_the_pool(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        relay_owner, sender = await _admin(session), await _admin(session)
        await _mailbox(session, relay_owner, smtp_server)
        service = AdminMailService(session, actor=sender)

        result = await service.send_admin_granted_email(sender, to_user=relay_owner, login_url=None)

        assert result.email_sent is True
        assert len(smtp_server.envelopes) == 1

    async def test_a_disabled_owners_mailbox_is_not_offered_to_the_pool(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        disabled_owner, sender = await _admin(session), await _admin(session)
        await _mailbox(session, disabled_owner, smtp_server)
        disabled_owner.is_active = False
        await session.flush()
        service = AdminMailService(session, actor=sender)

        with pytest.raises(PermissionDeniedError):
            await service.send_admin_granted_email(sender, to_user=disabled_owner, login_url=None)

        assert smtp_server.envelopes == []


class TestMailboxManagementEdges:
    async def test_listing_testing_and_deleting_a_mailbox(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin = await _admin(session)
        mailbox = await _mailbox(session, admin, smtp_server)
        service = AdminMailService(session, actor=admin)

        assert mailbox.id in [read.id for read in await service.list_mailboxes()]
        tested = await service.test_mailbox(mailbox.id)
        assert (tested.ok, tested.health_status) == (True, "ok")

        # A password the server key can no longer read fails the test cleanly.
        mailbox.smtp_password_enc = "not-a-token"
        await session.flush()
        unreadable = await service.test_mailbox(mailbox.id)
        assert unreadable.ok is False

        await service.delete_mailbox(mailbox.id)
        assert mailbox.id not in [read.id for read in await service.list_mailboxes()]

    async def test_a_mailbox_for_a_missing_account_is_refused(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin = await _admin(session)
        with pytest.raises(NotFoundError):
            await AdminMailService(session, actor=admin).create_mailbox(
                MailboxCreate(
                    user_id=uuid.uuid4(),
                    email=USERNAME,
                    smtp_host="127.0.0.1",
                    smtp_port=smtp_server.port,
                    smtp_security="none",
                    smtp_password=PASSWORD,
                )
            )

    async def test_editing_the_sign_in_name_reconnects_with_it(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin = await _admin(session)
        mailbox = await _mailbox(session, admin, smtp_server)
        service = AdminMailService(session, actor=admin)

        # A blank sign-in name means "the address"; an explicit null on a
        # required field is ignored rather than written.
        updated = await service.update_mailbox(
            mailbox.id, MailboxUpdate(smtp_username="", smtp_host=None)
        )

        assert updated.smtp_username == USERNAME
        assert updated.smtp_host == "127.0.0.1"

    async def test_reconnecting_with_an_unreadable_stored_password_asks_for_it(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin = await _admin(session)
        mailbox = await _mailbox(session, admin, smtp_server)
        mailbox.smtp_password_enc = "not-a-token"
        await session.flush()

        with pytest.raises(BadRequestError) as caught:
            await AdminMailService(session, actor=admin).update_mailbox(
                mailbox.id, MailboxUpdate(smtp_port=smtp_server.port)
            )

        assert caught.value.code == "mail_auth_failed"

    async def test_a_password_cannot_be_set_without_someone_to_set_it(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin = await _admin(session)
        mailbox = await _mailbox(session, admin, smtp_server)

        with pytest.raises(PermissionDeniedError):
            await AdminMailService(session).set_password(mailbox.id, PASSWORD)

    async def test_an_unreadable_sender_password_is_a_failed_send(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin = await _admin(session)
        mailbox = await _mailbox(session, admin, smtp_server)
        mailbox.smtp_password_enc = "not-a-token"
        await session.flush()

        result = await AdminMailService(session, actor=admin).send_account_email(
            admin, to_user=admin, password="Secret-pass-1", created=True, login_url=None
        )

        assert result.email_sent is False
        assert smtp_server.envelopes == []


class TestInboxEdges:
    async def test_an_administrator_made_later_still_sees_earlier_requests(
        self, session: AsyncSession
    ) -> None:
        await _admin(session)
        await AdminMailService(session).submit_request(
            _request(requester_email="late@example.org"), client_ip=None
        )
        latecomer = await _admin(session)

        page = await AdminMailService(session).list_inbox(
            latecomer, status="all", limit=100, offset=0
        )

        assert "late@example.org" in [item.requester_email for item in page.items]

    async def test_an_unknown_request_cannot_be_updated(self, session: AsyncSession) -> None:
        admin = await _admin(session)
        with pytest.raises(NotFoundError):
            await AdminMailService(session).update_inbox_item(
                admin, uuid.uuid4(), InboxUpdate(read=True)
            )

    async def test_an_empty_page_has_no_delivery_overview(self, session: AsyncSession) -> None:
        assert await AdminMailService(session)._delivery_overview([]) == {}
