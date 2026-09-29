"""Administrator mail rules: delivery, health, and who may do what.

SMTP itself is covered against a real server in ``test_admin_mail_smtp.py``;
here the network is replaced so the rules around it can be pinned down: one
success is enough to tell the requester nothing is wrong, an expired password
is recorded against the right mailbox, and a request is never lost.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, Mock

import pytest

from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
)
from app.models.admin_mail import (
    AdminMailbox,
    AdminRequest,
    AdminRequestRecipient,
    MailHealth,
)
from app.modules.admin_mail import service as service_module
from app.modules.admin_mail import smtp
from app.modules.admin_mail.crypto import encrypt_password
from app.modules.admin_mail.service import AdminMailService
from app.schemas.admin_mail import (
    ContactAdminCreate,
    InboxUpdate,
    MailboxCreate,
    MailboxUpdate,
)
from app.services.audit import AuditService

OK = smtp.SmtpOutcome.success()
AUTH_FAILED = smtp.SmtpOutcome(ok=False, health=MailHealth.auth_failed, error="535 expired")
UNREACHABLE = smtp.SmtpOutcome(ok=False, health=MailHealth.unreachable, error="connection refused")


def _mailbox(email: str = "a@example.test", **overrides: object) -> AdminMailbox:
    values: dict[str, object] = {
        "id": uuid.uuid4(),
        "user_id": uuid.uuid4(),
        "email": email,
        "smtp_host": "mail.example.test",
        "smtp_port": 587,
        "smtp_security": "starttls",
        "smtp_username": email,
        "smtp_password_enc": encrypt_password("pw"),
        "is_enabled": True,
        "health_status": "unknown",
        "created_at": datetime.now(UTC),
    }
    values.update(overrides)
    return AdminMailbox(**values)


def _user(**overrides: object) -> SimpleNamespace:
    values: dict[str, object] = {
        "id": uuid.uuid4(),
        "username": "admin",
        "full_name": "Ada Admin",
        "is_active": True,
        "is_protected": False,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _payload(**overrides: object) -> ContactAdminCreate:
    values: dict[str, object] = {
        "kind": "password_reset",
        "requester_name": "Alice",
        "requester_email": "alice@example.org",
        "message": "I forgot my password.",
    }
    values.update(overrides)
    return ContactAdminCreate(**values)


@pytest.fixture
def svc(monkeypatch: pytest.MonkeyPatch) -> AdminMailService:
    session = MagicMock()
    session.flush = AsyncMock()
    session.get = AsyncMock()
    session.delete = AsyncMock()
    session.refresh = AsyncMock()
    # Bulk updates (clearing a request's bell notification, "mark all read"):
    # no rows to report back, since nothing here inspects the result.
    session.execute = AsyncMock()
    # The built-in super administrator by default: most of these tests are
    # about mailbox behaviour (passwords, reconnection, audit trails), not
    # about who may touch someone else's mailbox - see `TestMailboxOwnership`
    # for that. A non-owner, non-protected actor would fail every one of
    # them at the ownership guard before reaching what they actually test.
    service = AdminMailService(session, actor=_user(is_protected=True))
    service.repo = Mock()
    service.repo.active_mailboxes = AsyncMock(return_value=[])
    service.repo.working_mailboxes = AsyncMock(return_value=[])
    service.repo.get_mailbox = AsyncMock(return_value=None)
    service.repo.get_mailbox_for_user = AsyncMock(return_value=None)
    service.repo.unread_count = AsyncMock(return_value=0)
    service.repo.latest_request_at = AsyncMock(return_value=None)
    service.audit = SimpleNamespace(record=AsyncMock(), changes=AuditService.changes)

    admin_check = AsyncMock(return_value=True)
    monkeypatch.setattr(
        service_module,
        "PermissionService",
        lambda _session: SimpleNamespace(is_system_admin=admin_check),
    )
    monkeypatch.setattr(
        service_module,
        "SiteSettingsService",
        lambda _session: SimpleNamespace(
            get_effective=AsyncMock(return_value=SimpleNamespace(site_name="WikiHub"))
        ),
    )
    service.is_admin = admin_check  # type: ignore[attr-defined]
    return service


def _added(svc: AdminMailService, kind: type) -> list:
    return [c.args[0] for c in svc.repo.add.call_args_list if isinstance(c.args[0], kind)]


class TestSubmitRequest:
    async def test_with_no_mailbox_the_request_is_kept_and_the_requester_is_told(
        self, svc: AdminMailService
    ) -> None:
        result = await svc.submit_request(_payload(), client_ip="203.0.113.9")

        assert result == "no_mailbox"
        (stored,) = _added(svc, AdminRequest)
        assert stored.requester_email == "alice@example.org"
        assert stored.client_ip == "203.0.113.9"

    async def test_one_working_mailbox_is_enough_to_say_nothing_went_wrong(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        good, expired = _mailbox("good@example.test"), _mailbox("expired@example.test")
        svc.repo.active_mailboxes.return_value = [expired, good]

        async def fake_send(config: smtp.SmtpConfig, **_kwargs: object) -> smtp.SmtpOutcome:
            return OK if config.email == "good@example.test" else AUTH_FAILED

        monkeypatch.setattr(smtp, "send", fake_send)

        result = await svc.submit_request(_payload(), client_ip=None)

        assert result == "sent"
        by_email = {r.mailbox_email: r for r in _added(svc, AdminRequestRecipient)}
        assert by_email["good@example.test"].delivery_status == "sent"
        assert by_email["expired@example.test"].delivery_status == "failed"
        assert by_email["expired@example.test"].delivery_error == "535 expired"
        # The failure is what makes the owner's banner appear, without waiting
        # for the hourly check.
        assert expired.health_status == "auth_failed"
        assert good.health_status == "ok"

    async def test_the_requester_is_told_only_when_every_mailbox_failed(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        svc.repo.active_mailboxes.return_value = [_mailbox("a@example.test"), _mailbox("b@x.test")]
        monkeypatch.setattr(smtp, "send", AsyncMock(return_value=UNREACHABLE))

        result = await svc.submit_request(_payload(), client_ip=None)

        assert result == "failed"
        # Still stored: the Inbox is the durable copy.
        assert len(_added(svc, AdminRequest)) == 1
        assert {r.delivery_status for r in _added(svc, AdminRequestRecipient)} == {"failed"}

    async def test_an_undecryptable_password_counts_as_failed_without_dialling_out(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        broken = _mailbox(smtp_password_enc="v1:corrupted")
        svc.repo.active_mailboxes.return_value = [broken]
        send = AsyncMock(return_value=OK)
        monkeypatch.setattr(smtp, "send", send)

        result = await svc.submit_request(_payload(), client_ip=None)

        assert result == "failed"
        send.assert_not_awaited()
        assert broken.health_status == "auth_failed"

    async def test_mailboxes_are_emailed_concurrently_not_one_after_another(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        svc.repo.active_mailboxes.return_value = [_mailbox(f"m{i}@example.test") for i in range(4)]

        async def slow_send(*_args: object, **_kwargs: object) -> smtp.SmtpOutcome:
            await asyncio.sleep(0.2)
            return OK

        monkeypatch.setattr(smtp, "send", slow_send)

        started = time.monotonic()
        await svc.submit_request(_payload(), client_ip=None)

        # Four sequential 0.2s sends would take 0.8s, and the requester waits.
        assert time.monotonic() - started < 0.6

    async def test_the_mail_names_the_requester_and_replies_go_to_them(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        svc.repo.active_mailboxes.return_value = [_mailbox()]
        send = AsyncMock(return_value=OK)
        monkeypatch.setattr(smtp, "send", send)

        await svc.submit_request(_payload(requester_username="alice"), client_ip=None)

        kwargs = send.await_args.kwargs
        assert kwargs["subject"] == "[WikiHub] Password reset request: Alice"
        assert kwargs["reply_to"] == "alice@example.org"
        assert "I forgot my password." in kwargs["body"]
        assert "Username: alice" in kwargs["body"]

    async def test_a_request_without_a_message_is_still_sent_and_says_so(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        svc.repo.active_mailboxes.return_value = [_mailbox()]
        send = AsyncMock(return_value=OK)
        monkeypatch.setattr(smtp, "send", send)

        result = await svc.submit_request(_payload(message=""), client_ip=None)

        assert result == "sent"
        assert "Message:\n(No message was written.)" in send.await_args.kwargs["body"]
        (request,) = _added(svc, AdminRequest)
        assert request.message == ""

    async def test_a_filled_honeypot_is_answered_like_success_and_stores_nothing(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        send = AsyncMock(return_value=OK)
        monkeypatch.setattr(smtp, "send", send)

        result = await svc.submit_request(_payload(website="http://spam.example"), client_ip=None)

        assert result == "sent"
        svc.repo.add.assert_not_called()
        send.assert_not_awaited()


class TestHealthcheck:
    async def test_records_each_mailbox_result_and_reports_the_counts(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        good, expired, unreadable = (
            _mailbox("g@example.test"),
            _mailbox("e@example.test"),
            _mailbox("u@example.test", smtp_password_enc="v1:corrupted"),
        )
        svc.repo.active_mailboxes.return_value = [good, unreadable, expired]

        async def fake_verify_all(
            configs: list[smtp.SmtpConfig], **_kwargs: object
        ) -> list[smtp.SmtpOutcome]:
            return [OK if c.email == "g@example.test" else AUTH_FAILED for c in configs]

        monkeypatch.setattr(smtp, "verify_all", fake_verify_all)

        summary = await svc.run_healthcheck()

        assert (summary.checked, summary.ok, summary.needs_attention) == (3, 1, 2)
        assert good.health_status == "ok"
        assert good.health_error is None
        assert good.health_checked_at is not None
        assert expired.health_status == "auth_failed"
        assert expired.health_error == "535 expired"
        assert unreadable.health_status == "auth_failed"

    async def test_a_recovered_mailbox_clears_its_old_error(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        recovered = _mailbox(health_status="auth_failed", health_error="535 expired")
        svc.repo.active_mailboxes.return_value = [recovered]
        monkeypatch.setattr(smtp, "verify_all", AsyncMock(return_value=[OK]))

        await svc.run_healthcheck()

        assert recovered.health_status == "ok"
        assert recovered.health_error is None

    async def test_with_no_active_mailbox_nothing_is_dialled(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        verify_all = AsyncMock(return_value=[])
        monkeypatch.setattr(smtp, "verify_all", verify_all)

        summary = await svc.run_healthcheck()

        assert (summary.checked, summary.ok, summary.needs_attention) == (0, 0, 0)


class TestSetPassword:
    async def test_a_password_the_server_refuses_is_not_saved(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mailbox, owner = _mailbox(), svc.actor
        mailbox.user_id = owner.id
        stored = mailbox.smtp_password_enc
        svc.repo.get_mailbox.return_value = (mailbox, owner)
        monkeypatch.setattr(smtp, "verify", AsyncMock(return_value=AUTH_FAILED))

        with pytest.raises(BadRequestError) as caught:
            await svc.set_password(mailbox.id, "wrong-again")

        assert caught.value.code == "mail_auth_failed"
        assert mailbox.smtp_password_enc == stored

    async def test_the_owner_can_replace_an_expired_password_and_the_banner_clears(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        owner = svc.actor
        mailbox = _mailbox(user_id=owner.id, health_status="auth_failed", health_error="535")
        svc.repo.get_mailbox.return_value = (mailbox, owner)
        verify = AsyncMock(return_value=OK)
        monkeypatch.setattr(smtp, "verify", verify)
        old = mailbox.smtp_password_enc

        read = await svc.set_password(mailbox.id, "brand-new")

        assert verify.await_args.args[0].password == "brand-new"
        assert mailbox.smtp_password_enc != old
        assert read.health_status == "ok"
        assert mailbox.health_error is None

    async def test_a_peer_administrator_cannot_change_someone_elses_mailbox_password(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mailbox = _mailbox()  # owned by a different account
        svc.actor = _user(is_protected=False)  # a plain administrator, not the owner
        svc.repo.get_mailbox.return_value = (mailbox, _user(id=mailbox.user_id))
        verify = AsyncMock(return_value=OK)
        monkeypatch.setattr(smtp, "verify", verify)

        with pytest.raises(PermissionDeniedError):
            await svc.set_password(mailbox.id, "x")

        verify.assert_not_awaited()

    async def test_an_unreachable_server_still_saves_the_password(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A password cannot be proven while the server is down; refusing it would
        # leave the owner stuck with the banner until the provider recovers.
        owner = svc.actor
        mailbox = _mailbox(user_id=owner.id)
        svc.repo.get_mailbox.return_value = (mailbox, owner)
        monkeypatch.setattr(smtp, "verify", AsyncMock(return_value=UNREACHABLE))
        old = mailbox.smtp_password_enc

        await svc.set_password(mailbox.id, "new-pw")

        assert mailbox.smtp_password_enc != old
        assert mailbox.health_status == "unreachable"


class TestManagingMailboxes:
    def _create(self, user_id: uuid.UUID) -> MailboxCreate:
        return MailboxCreate(
            user_id=user_id,
            email="ops@example.test",
            smtp_host="mail.example.test",
            smtp_port=587,
            smtp_security="starttls",
            smtp_password="pw",
        )

    async def test_only_an_administrator_account_can_be_linked(self, svc: AdminMailService) -> None:
        target = _user()
        svc.session.get.return_value = target
        svc.is_admin.return_value = False

        with pytest.raises(BadRequestError) as caught:
            await svc.create_mailbox(self._create(target.id))

        assert caught.value.code == "mailbox_user_not_admin"
        svc.repo.add.assert_not_called()

    async def test_an_account_gets_only_one_mailbox(self, svc: AdminMailService) -> None:
        target = _user()
        svc.session.get.return_value = target
        svc.repo.get_mailbox_for_user.return_value = (_mailbox(), target)

        with pytest.raises(ConflictError):
            await svc.create_mailbox(self._create(target.id))

    async def test_a_new_mailbox_is_checked_first_and_username_defaults_to_the_email(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        target = _user()
        svc.session.get.return_value = target
        verify = AsyncMock(return_value=OK)
        monkeypatch.setattr(smtp, "verify", verify)

        async def database_fills_defaults(mailbox: AdminMailbox) -> None:
            mailbox.id = uuid.uuid4()
            mailbox.created_at = datetime.now(UTC)

        svc.session.refresh.side_effect = database_fills_defaults

        read = await svc.create_mailbox(self._create(target.id))

        # What was tested is what was typed, before it was stored.
        tested = verify.await_args.args[0]
        assert (tested.username, tested.password) == ("ops@example.test", "pw")
        (mailbox,) = _added(svc, AdminMailbox)
        assert mailbox.smtp_username == "ops@example.test"
        # The password is stored encrypted, never as typed.
        assert mailbox.smtp_password_enc != "pw"
        assert "pw" not in read.model_dump_json()
        assert read.health_status == "ok"
        assert read.has_password is True

    @pytest.mark.parametrize(
        ("outcome", "code"),
        [
            (AUTH_FAILED, "mail_auth_failed"),
            (UNREACHABLE, "mail_unreachable"),
            (
                smtp.SmtpOutcome(
                    ok=False, health=MailHealth.error, error="530 must issue STARTTLS"
                ),
                "mail_check_failed",
            ),
        ],
    )
    async def test_a_mailbox_that_fails_the_check_is_not_saved(
        self,
        svc: AdminMailService,
        monkeypatch: pytest.MonkeyPatch,
        outcome: smtp.SmtpOutcome,
        code: str,
    ) -> None:
        target = _user()
        svc.session.get.return_value = target
        monkeypatch.setattr(smtp, "verify", AsyncMock(return_value=outcome))

        with pytest.raises(BadRequestError) as caught:
            await svc.create_mailbox(self._create(target.id))

        assert caught.value.code == code
        assert caught.value.details["reason"] == outcome.error
        svc.repo.add.assert_not_called()
        svc.audit.record.assert_not_awaited()

    async def test_an_edit_that_fails_the_check_changes_nothing(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mailbox, user = _mailbox(), _user()
        svc.repo.get_mailbox.return_value = (mailbox, user)
        verify = AsyncMock(return_value=UNREACHABLE)
        monkeypatch.setattr(smtp, "verify", verify)
        old_password = mailbox.smtp_password_enc

        with pytest.raises(BadRequestError) as caught:
            await svc.update_mailbox(
                mailbox.id,
                MailboxUpdate(smtp_host="wrong.example.test", smtp_password="typo"),
            )

        assert caught.value.code == "mail_unreachable"
        # The candidate was tested, and none of it was applied.
        tested = verify.await_args.args[0]
        assert (tested.host, tested.password) == ("wrong.example.test", "typo")
        assert mailbox.smtp_host == "mail.example.test"
        assert mailbox.smtp_password_enc == old_password
        svc.audit.record.assert_not_awaited()

    async def test_an_edit_keeps_the_stored_password_when_none_is_given(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mailbox, user = _mailbox(), _user()
        svc.repo.get_mailbox.return_value = (mailbox, user)
        verify = AsyncMock(return_value=OK)
        monkeypatch.setattr(smtp, "verify", verify)

        await svc.update_mailbox(mailbox.id, MailboxUpdate(smtp_host="new.example.test"))

        tested = verify.await_args.args[0]
        assert (tested.host, tested.password) == ("new.example.test", "pw")
        assert mailbox.smtp_host == "new.example.test"
        assert mailbox.health_status == "ok"

    async def test_a_disabled_account_makes_the_mailbox_ineffective(
        self, svc: AdminMailService
    ) -> None:
        mailbox, inactive = _mailbox(), _user(is_active=False)
        svc.repo.get_mailbox.return_value = (mailbox, inactive)

        (read,) = [svc._read(mailbox, inactive)]

        assert read.is_enabled is True
        assert read.effective_enabled is False

    async def test_changing_the_connection_re_checks_it_but_renaming_does_not(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mailbox, user = _mailbox(), _user()
        svc.repo.get_mailbox.return_value = (mailbox, user)
        verify = AsyncMock(return_value=OK)
        monkeypatch.setattr(smtp, "verify", verify)

        await svc.update_mailbox(mailbox.id, MailboxUpdate(display_name="Ops"))
        verify.assert_not_awaited()

        await svc.update_mailbox(mailbox.id, MailboxUpdate(smtp_port=465))
        verify.assert_awaited_once()

    async def test_the_audit_trail_records_that_a_password_was_replaced_but_not_what_it_was(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mailbox, user = _mailbox(), _user()
        svc.repo.get_mailbox.return_value = (mailbox, user)
        monkeypatch.setattr(smtp, "verify", AsyncMock(return_value=OK))

        await svc.update_mailbox(mailbox.id, MailboxUpdate(smtp_password="new-secret-value"))

        details = svc.audit.record.await_args.kwargs["details"]
        assert details["reauthenticated"] is True
        assert "new-secret-value" not in repr(details)

    async def test_an_unknown_mailbox_is_a_404(self, svc: AdminMailService) -> None:
        with pytest.raises(NotFoundError):
            await svc.test_mailbox(uuid.uuid4())


class TestMailboxOwnership:
    """`system_admin` alone (checked at the route as `CurrentSuperuser`) is not
    enough to reconfigure, re-key, test or delete someone else's mailbox -
    only that mailbox's own account or the protected super administrator may.
    `set_password` is covered separately in `TestSetPassword`."""

    async def test_a_peer_administrator_cannot_update_someone_elses_mailbox(
        self, svc: AdminMailService
    ) -> None:
        mailbox = _mailbox()
        svc.actor = _user(is_protected=False)
        svc.repo.get_mailbox.return_value = (mailbox, _user(id=mailbox.user_id))

        with pytest.raises(PermissionDeniedError):
            await svc.update_mailbox(mailbox.id, MailboxUpdate(display_name="Ops"))

    async def test_a_peer_administrator_cannot_test_someone_elses_mailbox(
        self, svc: AdminMailService
    ) -> None:
        mailbox = _mailbox()
        svc.actor = _user(is_protected=False)
        svc.repo.get_mailbox.return_value = (mailbox, _user(id=mailbox.user_id))

        with pytest.raises(PermissionDeniedError):
            await svc.test_mailbox(mailbox.id)

    async def test_a_peer_administrator_cannot_delete_someone_elses_mailbox(
        self, svc: AdminMailService
    ) -> None:
        mailbox = _mailbox()
        svc.actor = _user(is_protected=False)
        svc.repo.get_mailbox.return_value = (mailbox, _user(id=mailbox.user_id))

        with pytest.raises(PermissionDeniedError):
            await svc.delete_mailbox(mailbox.id)

        svc.repo.delete.assert_not_called()

    async def test_the_owner_can_update_their_own_mailbox(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        owner = _user(is_protected=False)
        mailbox = _mailbox(user_id=owner.id)
        svc.actor = owner
        svc.repo.get_mailbox.return_value = (mailbox, owner)
        monkeypatch.setattr(smtp, "verify", AsyncMock(return_value=OK))

        result = await svc.update_mailbox(mailbox.id, MailboxUpdate(display_name="Ops"))

        assert result.display_name == "Ops"

    async def test_the_protected_super_administrator_can_touch_any_mailbox(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mailbox = _mailbox()
        svc.actor = _user(is_protected=True)  # not the owner
        svc.repo.get_mailbox.return_value = (mailbox, _user(id=mailbox.user_id))
        monkeypatch.setattr(smtp, "verify", AsyncMock(return_value=OK))

        result = await svc.update_mailbox(mailbox.id, MailboxUpdate(display_name="Ops"))

        assert result.display_name == "Ops"


class TestInbox:
    async def test_an_account_without_a_mailbox_has_no_inbox_and_no_error_on_the_summary(
        self, svc: AdminMailService
    ) -> None:
        user = _user()

        summary = await svc.summary(user)

        assert summary.has_mailbox is False
        with pytest.raises(PermissionDeniedError) as caught:
            await svc.list_inbox(user, status="all", limit=20, offset=0)
        assert caught.value.code == "no_admin_mailbox"

    async def test_a_switched_off_mailbox_hides_the_inbox_too(self, svc: AdminMailService) -> None:
        user = _user()
        svc.repo.get_mailbox_for_user.return_value = (_mailbox(is_enabled=False), user)

        assert (await svc.summary(user)).has_mailbox is False

    async def test_a_switched_off_but_connected_mailbox_can_still_send_account_mail(
        self, svc: AdminMailService
    ) -> None:
        user = _user()
        svc.repo.get_mailbox_for_user.return_value = (
            _mailbox(is_enabled=False, health_status="ok"),
            user,
        )

        summary = await svc.summary(user)

        assert summary.has_mailbox is False
        assert summary.can_send_account_mail is True

    async def test_the_summary_carries_what_the_banner_and_bell_need(
        self, svc: AdminMailService
    ) -> None:
        user = _user()
        mailbox = _mailbox(health_status="auth_failed", health_error="535 expired")
        svc.repo.get_mailbox_for_user.return_value = (mailbox, user)
        svc.repo.unread_count.return_value = 3

        summary = await svc.summary(user)

        assert summary.has_mailbox is True
        assert summary.health_status == "auth_failed"
        assert summary.health_error == "535 expired"
        assert summary.unread_count == 3
        assert summary.can_send_account_mail is False

    async def test_the_pool_covers_an_account_with_no_mailbox_at_all(
        self, svc: AdminMailService
    ) -> None:
        user = _user()
        svc.repo.working_mailboxes.return_value = [_mailbox()]

        summary = await svc.summary(user)

        assert summary.has_mailbox is False
        assert summary.can_send_account_mail is True
        # No mailbox of their own to name - `health_status` stays unset, the
        # frontend's signal that any send here would go through the pool.
        assert summary.health_status is None

    async def test_the_pool_covers_an_unhealthy_mailbox_of_their_own_too(
        self, svc: AdminMailService
    ) -> None:
        user = _user()
        svc.repo.get_mailbox_for_user.return_value = (
            _mailbox(health_status="auth_failed"),
            user,
        )
        svc.repo.working_mailboxes.return_value = [_mailbox("relay@example.test")]

        summary = await svc.summary(user)

        assert summary.can_send_account_mail is True
        assert summary.health_status == "auth_failed"  # still reported, just not relied on

    def _row(self) -> tuple[AdminRequestRecipient, AdminRequest]:
        request = AdminRequest(
            id=uuid.uuid4(),
            kind="account",
            requester_name="Bob",
            requester_email="bob@example.org",
            message="hi",
            created_at=datetime.now(UTC),
        )
        recipient = AdminRequestRecipient(
            request_id=request.id,
            user_id=uuid.uuid4(),
            mailbox_email="a@example.test",
            delivery_status="sent",
        )
        return recipient, request

    async def test_resolving_marks_it_read_and_records_who_handled_it(
        self, svc: AdminMailService
    ) -> None:
        user = _user()
        svc.repo.get_mailbox_for_user.return_value = (_mailbox(), user)
        recipient, request = self._row()
        svc.repo.get_inbox_item = AsyncMock(return_value=(recipient, request))

        item = await svc.update_inbox_item(user, request.id, InboxUpdate(resolved=True))

        assert request.resolved_by_id == user.id
        assert recipient.read_at is not None
        assert item.resolved_at is not None

    async def test_reopening_clears_the_resolution_and_unread_can_be_restored(
        self, svc: AdminMailService
    ) -> None:
        user = _user()
        svc.repo.get_mailbox_for_user.return_value = (_mailbox(), user)
        recipient, request = self._row()
        request.resolved_at = datetime.now(UTC)
        recipient.read_at = datetime.now(UTC)
        svc.repo.get_inbox_item = AsyncMock(return_value=(recipient, request))

        await svc.update_inbox_item(user, request.id, InboxUpdate(resolved=False, read=False))

        assert request.resolved_at is None
        assert recipient.read_at is None

    async def test_someone_elses_request_is_a_404(self, svc: AdminMailService) -> None:
        user = _user()
        svc.repo.get_mailbox_for_user.return_value = (_mailbox(), user)
        svc.repo.get_inbox_item = AsyncMock(return_value=None)

        with pytest.raises(NotFoundError):
            await svc.get_inbox_item(user, uuid.uuid4())


class TestSendAccountEmail:
    """Emailing someone the sign-in details for an account created, or a
    password reset, by hand in Users - not from a request in the Inbox, so the
    only thing standing between an administrator and sending it is having
    their own mailbox, exactly like every other mail this feature sends."""

    async def test_without_a_mailbox_the_actor_cannot_send_anything(
        self, svc: AdminMailService
    ) -> None:
        actor = _user()

        with pytest.raises(PermissionDeniedError):
            await svc.send_account_email(
                actor,
                to_user=_user(username="newbie", full_name="New Person"),
                password="Zx7kQm2Rt9WpAb4c",
                created=True,
                login_url=None,
            )

    async def test_a_mailbox_with_receive_requests_off_can_still_send(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """"Receive requests" only says whether this account wants an Inbox -
        it must not also silently stop it from emailing someone it just
        created an account for or reset the password of."""
        actor = _user()
        mailbox = _mailbox(is_enabled=False)
        svc.repo.get_mailbox_for_user.return_value = (mailbox, actor)
        send = AsyncMock(return_value=OK)
        monkeypatch.setattr(smtp, "send", send)

        result = await svc.send_account_email(
            actor,
            to_user=_user(username="newbie", email="newbie@example.org"),
            password="Zx7kQm2Rt9WpAb4c",
            created=True,
            login_url=None,
        )

        assert result.email_sent is True

    async def test_a_created_account_is_emailed_from_the_actors_own_mailbox(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        actor = _user(username="ada", full_name="Ada Admin")
        mailbox = _mailbox("ada@example.test")
        svc.repo.get_mailbox_for_user.return_value = (mailbox, actor)
        send = AsyncMock(return_value=OK)
        monkeypatch.setattr(smtp, "send", send)
        target = _user(username="newbie", full_name="New Person", email="newbie@example.org")

        result = await svc.send_account_email(
            actor,
            to_user=target,
            password="Zx7kQm2Rt9WpAb4c",
            created=True,
            login_url="https://wiki.example.test/login",
        )

        assert result.email_sent is True
        assert result.email_error is None
        assert send.await_args.kwargs["to"] == "newbie@example.org"
        assert send.await_args.args[0].email == "ada@example.test"
        assert "Zx7kQm2Rt9WpAb4c" in send.await_args.kwargs["html"]
        assert "Your account has been created" in send.await_args.kwargs["subject"]
        # A send is as good a health check as the hourly one.
        assert mailbox.health_status == "ok"

    async def test_a_reset_password_says_reset_not_created(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        actor = _user()
        svc.repo.get_mailbox_for_user.return_value = (_mailbox(), actor)
        send = AsyncMock(return_value=OK)
        monkeypatch.setattr(smtp, "send", send)

        await svc.send_account_email(
            actor,
            to_user=_user(username="newbie", email="newbie@example.org"),
            password="Zx7kQm2Rt9WpAb4c",
            created=False,
            login_url=None,
        )

        assert "Your password has been reset" in send.await_args.kwargs["subject"]

    async def test_a_failed_send_is_reported_but_not_raised(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        actor = _user()
        mailbox = _mailbox()
        svc.repo.get_mailbox_for_user.return_value = (mailbox, actor)
        monkeypatch.setattr(smtp, "send", AsyncMock(return_value=AUTH_FAILED))

        result = await svc.send_account_email(
            actor,
            to_user=_user(username="newbie", email="newbie@example.org"),
            password="Zx7kQm2Rt9WpAb4c",
            created=True,
            login_url=None,
        )

        assert result.email_sent is False
        assert result.email_error == "535 expired"
        assert mailbox.health_status == "auth_failed"


class TestSendAdminGrantedEmail:
    async def test_without_a_mailbox_the_actor_cannot_send_anything(
        self, svc: AdminMailService
    ) -> None:
        actor = _user()

        with pytest.raises(PermissionDeniedError):
            await svc.send_admin_granted_email(
                actor,
                to_user=_user(username="newbie", full_name="New Person"),
                login_url=None,
            )

    async def test_the_email_says_administrator_and_comes_from_the_actors_mailbox(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        actor = _user(username="ada", full_name="Ada Admin")
        mailbox = _mailbox("ada@example.test")
        svc.repo.get_mailbox_for_user.return_value = (mailbox, actor)
        send = AsyncMock(return_value=OK)
        monkeypatch.setattr(smtp, "send", send)
        target = _user(username="newbie", full_name="New Person", email="newbie@example.org")

        result = await svc.send_admin_granted_email(
            actor, to_user=target, login_url="https://wiki.example.test/login"
        )

        assert result.email_sent is True
        assert send.await_args.kwargs["to"] == "newbie@example.org"
        assert send.await_args.args[0].email == "ada@example.test"
        assert "You're now an administrator" in send.await_args.kwargs["subject"]
        assert mailbox.health_status == "ok"

    async def test_a_failed_send_is_reported_but_not_raised(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        actor = _user()
        mailbox = _mailbox()
        svc.repo.get_mailbox_for_user.return_value = (mailbox, actor)
        monkeypatch.setattr(smtp, "send", AsyncMock(return_value=AUTH_FAILED))

        result = await svc.send_admin_granted_email(
            actor,
            to_user=_user(username="newbie", email="newbie@example.org"),
            login_url=None,
        )

        assert result.email_sent is False
        assert result.email_error == "535 expired"


class TestSendSpaceAccessEmail:
    async def test_without_a_mailbox_the_actor_cannot_send_anything(
        self, svc: AdminMailService
    ) -> None:
        actor = _user()

        with pytest.raises(PermissionDeniedError):
            await svc.send_space_access_email(
                actor,
                to_user=_user(username="newbie"),
                space_name="Engineering",
                added=True,
                login_url=None,
            )

    async def test_being_added_says_added_and_offers_a_way_in(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        actor = _user(username="ada", full_name="Ada Admin")
        mailbox = _mailbox("ada@example.test")
        svc.repo.get_mailbox_for_user.return_value = (mailbox, actor)
        send = AsyncMock(return_value=OK)
        monkeypatch.setattr(smtp, "send", send)
        target = _user(username="newbie", full_name="New Person", email="newbie@example.org")

        result = await svc.send_space_access_email(
            actor,
            to_user=target,
            space_name="Engineering",
            added=True,
            login_url="https://wiki.example.test/login",
        )

        assert result.email_sent is True
        assert send.await_args.kwargs["to"] == "newbie@example.org"
        assert "added to" in send.await_args.kwargs["subject"]
        assert "Engineering" in send.await_args.kwargs["subject"]
        assert ">Open WikiHub<" in send.await_args.kwargs["html"]

    async def test_being_removed_says_removed_and_offers_nothing_to_open(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        actor = _user()
        svc.repo.get_mailbox_for_user.return_value = (_mailbox(), actor)
        send = AsyncMock(return_value=OK)
        monkeypatch.setattr(smtp, "send", send)

        result = await svc.send_space_access_email(
            actor,
            to_user=_user(username="newbie", email="newbie@example.org"),
            space_name="Engineering",
            added=False,
            login_url="https://wiki.example.test/login",
        )

        assert result.email_sent is True
        assert "removed from" in send.await_args.kwargs["subject"]
        assert ">Open WikiHub<" not in send.await_args.kwargs["html"]


class TestMailboxPool:
    """An administrator with no mailbox configured at all is not stuck unable
    to email anyone: `_resolve_sender` falls back to another administrator's
    mailbox that is actually connected, provided the message still names -
    and can still be replied to at - the administrator who really sent it."""

    async def test_falls_back_to_a_connected_mailbox_when_the_actor_has_none(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        actor = _user(username="noboxada", full_name="No Box Ada", email="ada@example.org")
        pool_mailbox = _mailbox("relay@example.test", display_name="Ops Relay")
        svc.repo.working_mailboxes.return_value = [pool_mailbox]
        send = AsyncMock(return_value=OK)
        monkeypatch.setattr(smtp, "send", send)

        result = await svc.send_admin_granted_email(
            actor,
            to_user=_user(username="newbie", email="newbie@example.org"),
            login_url=None,
        )

        assert result.email_sent is True
        # Sent through the pool mailbox's real SMTP config...
        assert send.await_args.args[0].email == "relay@example.test"
        # ...but signed and replied-to as the administrator who actually did
        # this, never the pool mailbox owner's own display name.
        assert "No Box Ada" in send.await_args.kwargs["html"]
        assert "Ops Relay" not in send.await_args.kwargs["html"]
        assert send.await_args.kwargs["reply_to"] == "ada@example.org"

    async def test_never_picks_the_actors_own_mailbox_as_a_pool_candidate(
        self, svc: AdminMailService, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Belt and braces: the actor already has their own mailbox branch
        above `_resolve_sender`'s pool fallback, but the pool query itself
        must also never hand back the actor's own row (e.g. a stale/expired
        `get_mailbox_for_user` result should never widen who this sends as)."""
        actor = _user()
        own_mailbox = _mailbox("self@example.test", user_id=actor.id, health_status="ok")
        svc.repo.working_mailboxes.return_value = [own_mailbox]
        send = AsyncMock(return_value=OK)
        monkeypatch.setattr(smtp, "send", send)
        # No mailbox of their own via the normal lookup, only via the pool
        # listing above - exercises the exclusion inside `_resolve_sender`.
        svc.repo.get_mailbox_for_user.return_value = None

        with pytest.raises(PermissionDeniedError):
            await svc.send_admin_granted_email(
                actor, to_user=_user(username="newbie"), login_url=None
            )

        send.assert_not_awaited()

    async def test_no_mailbox_anywhere_is_still_reported_clearly(
        self, svc: AdminMailService
    ) -> None:
        with pytest.raises(PermissionDeniedError) as caught:
            await svc.send_space_access_email(
                _user(),
                to_user=_user(username="newbie"),
                space_name="Engineering",
                added=True,
                login_url=None,
            )

        assert caught.value.code == "no_admin_mailbox"
