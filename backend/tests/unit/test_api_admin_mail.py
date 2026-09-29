"""The admin-mail routes' wrapping: throttling, validation and registration.

The rules behind them are in ``test_admin_mail_service.py``; what is worth
pinning here is what only the HTTP layer does - the public form is throttled
twice, hostile input is rejected before it reaches the service, and the
hourly healthcheck is actually scheduled.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError

from app.api.v1 import admin_mail as api
from app.core.exceptions import RateLimitedError
from app.schemas.admin_mail import ContactAdminCreate, MailboxCreate, MailboxUpdate
from app.workers.settings import WorkerSettings
from app.workers.tasks import check_admin_mailboxes


def _payload() -> ContactAdminCreate:
    return ContactAdminCreate(
        kind="account",
        requester_name="Alice",
        requester_email="alice@example.org",
        message="Please create an account for me.",
    )


def _request(host: str = "203.0.113.7") -> SimpleNamespace:
    return SimpleNamespace(client=SimpleNamespace(host=host))


class TestContactAdmin:
    async def test_throttles_per_client_and_across_all_clients(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        enforce = AsyncMock()
        monkeypatch.setattr(api.rate_limit, "enforce", enforce)
        service = MagicMock(submit_request=AsyncMock(return_value="sent"))
        monkeypatch.setattr(api, "AdminMailService", lambda _session: service)

        result = await api.contact_admin(_payload(), _request(), MagicMock())

        assert result.delivery == "sent"
        keys = [call.args[0] for call in enforce.await_args_list]
        assert keys == ["contact-admin:ip:203.0.113.7", "contact-admin:all"]
        service.submit_request.assert_awaited_once()
        assert service.submit_request.await_args.kwargs["client_ip"] == "203.0.113.7"

    async def test_a_throttled_client_reaches_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            api.rate_limit, "enforce", AsyncMock(side_effect=RateLimitedError("slow down"))
        )
        service = MagicMock(submit_request=AsyncMock())
        monkeypatch.setattr(api, "AdminMailService", lambda _session: service)

        with pytest.raises(RateLimitedError):
            await api.contact_admin(_payload(), _request(), MagicMock())

        service.submit_request.assert_not_awaited()

    async def test_passes_the_delivery_result_through_for_the_notice(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(api.rate_limit, "enforce", AsyncMock())
        service = MagicMock(submit_request=AsyncMock(return_value="failed"))
        monkeypatch.setattr(api, "AdminMailService", lambda _session: service)

        result = await api.contact_admin(_payload(), _request(), MagicMock())

        assert result.delivery == "failed"


class TestValidation:
    @pytest.mark.parametrize("email", ["", "no-at-sign", "two@@signs.test", "spaces in@x.test"])
    def test_a_requester_address_that_cannot_be_an_address_is_rejected(self, email: str) -> None:
        with pytest.raises(ValidationError):
            ContactAdminCreate(kind="other", requester_name="A", requester_email=email, message="m")

    def test_an_intranet_address_is_accepted(self) -> None:
        # EmailStr would refuse `.local`, which an intranet legitimately uses.
        ContactAdminCreate(
            kind="other", requester_name="A", requester_email="a@corp.local", message="m"
        )

    def test_a_blank_name_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ContactAdminCreate(kind="other", requester_name="   ", requester_email="a@b.test")

    @pytest.mark.parametrize("message", [None, "", "   "])
    def test_the_message_is_optional(self, message: str | None) -> None:
        values: dict[str, object] = {
            "kind": "account",
            "requester_name": "A",
            "requester_email": "a@b.test",
        }
        if message is not None:
            values["message"] = message

        assert ContactAdminCreate(**values).message == ""

    def test_the_message_is_length_limited(self) -> None:
        with pytest.raises(ValidationError):
            ContactAdminCreate(
                kind="other", requester_name="A", requester_email="a@b.test", message="x" * 2001
            )

    def test_an_unknown_request_kind_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ContactAdminCreate(
                kind="delete-everything",  # type: ignore[arg-type]
                requester_name="A",
                requester_email="a@b.test",
                message="m",
            )

    @pytest.mark.parametrize(
        "host", ["https://mail.example.com", "mail.example.com/path", "a b", "host;rm", ""]
    )
    def test_an_smtp_host_must_be_a_bare_hostname(self, host: str) -> None:
        with pytest.raises(ValidationError):
            MailboxCreate(
                user_id="00000000-0000-0000-0000-000000000001",
                email="a@b.test",
                smtp_host=host,
                smtp_port=587,
                smtp_password="pw",
            )

    @pytest.mark.parametrize("port", [0, 65536, -1])
    def test_an_smtp_port_must_be_a_real_port(self, port: int) -> None:
        with pytest.raises(ValidationError):
            MailboxUpdate(smtp_port=port)

    def test_no_read_model_can_carry_the_smtp_password(self) -> None:
        from app.schemas.admin_mail import MailboxRead

        # `has_password` (a boolean) is the most a client may learn.
        leaks = [name for name in MailboxRead.model_fields if "password" in name]
        assert leaks == ["has_password"]


class TestWorkerSchedule:
    def test_the_healthcheck_runs_hourly(self) -> None:
        job = next(
            entry for entry in WorkerSettings.cron_jobs if entry.coroutine is check_admin_mailboxes
        )

        assert job.minute == 0
        assert job.second == 20
        # Not at startup: the database may not be reachable yet, and the first
        # scheduled pass is at most an hour away.
        assert job.run_at_startup is False


class TestRouting:
    def test_the_routes_are_registered_under_the_api(self, app) -> None:
        paths = set(app.openapi()["paths"])

        assert "/api/v1/contact-admin" in paths
        assert "/api/v1/admin-mail/summary" in paths
        assert "/api/v1/admin-mail/inbox" in paths
        assert "/api/v1/admin-mail/mailboxes" in paths
        assert "/api/v1/admin-mail/mailboxes/{mailbox_id}/password" in paths
        assert "/api/v1/admin-mail/notify-account-created" in paths
        assert "/api/v1/admin-mail/notify-password-reset" in paths
        assert "/api/v1/admin-mail/notify-admin-granted" in paths
        assert "/api/v1/admin-mail/notify-space-access" in paths

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("get", "/api/v1/admin-mail/summary"),
            ("get", "/api/v1/admin-mail/inbox"),
            ("get", "/api/v1/admin-mail/mailboxes"),
            ("post", "/api/v1/admin-mail/mailboxes"),
            ("post", "/api/v1/admin-mail/inbox/read-all"),
            ("post", "/api/v1/admin-mail/notify-account-created"),
            ("post", "/api/v1/admin-mail/notify-password-reset"),
            ("post", "/api/v1/admin-mail/notify-admin-granted"),
            ("post", "/api/v1/admin-mail/notify-space-access"),
        ],
    )
    async def test_everything_except_the_contact_form_needs_a_sign_in(
        self,
        client,
        method: str,
        path: str,
    ) -> None:
        response = await getattr(client, method)(path)

        assert response.status_code == 401

    async def test_the_contact_form_is_reachable_without_signing_in(
        self,
        client,
    ) -> None:
        # An empty body is refused as invalid (422), not as unauthenticated
        # (401): the request got as far as validation.
        response = await client.post("/api/v1/contact-admin", json={})

        assert response.status_code == 422
