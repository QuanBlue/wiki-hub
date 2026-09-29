"""SMTP delivery and classification, against a real local SMTP server.

A stub would only prove the code calls the library the way we expect it to; a
real server proves what a mailbox owner actually sees: a wrong or expired
password is reported as needing a new password, a dead port as unreachable, and
a working mailbox delivers a message with the right envelope and headers.
"""

from __future__ import annotations

import socket
from collections.abc import Iterator
from dataclasses import dataclass, field
from email import message_from_bytes

import aiosmtplib
import pytest
from aiosmtpd.controller import Controller
from aiosmtpd.smtp import AuthResult, LoginPassword

from app.models.admin_mail import MailHealth
from app.modules.admin_mail import smtp

USERNAME = "admin@example.test"
PASSWORD = "current-password"


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@dataclass
class _Server:
    port: int
    envelopes: list = field(default_factory=list)
    password: str = PASSWORD


class _Handler:
    def __init__(self, server: _Server) -> None:
        self.server = server

    async def handle_DATA(self, server, session, envelope):
        self.server.envelopes.append(envelope)
        return "250 Message accepted"


@pytest.fixture
def smtp_server() -> Iterator[_Server]:
    state = _Server(port=_free_port())

    def authenticator(server, session, envelope, mechanism, auth_data):
        ok = (
            isinstance(auth_data, LoginPassword)
            and auth_data.login == USERNAME.encode()
            and auth_data.password == state.password.encode()
        )
        return AuthResult(success=ok, handled=False)

    controller = Controller(
        _Handler(state),
        hostname="127.0.0.1",
        port=state.port,
        authenticator=authenticator,
        auth_required=True,
        # The test server has no certificate, so it must accept a plain login.
        auth_require_tls=False,
    )
    controller.start()
    try:
        yield state
    finally:
        controller.stop()


def _config(port: int, *, password: str = PASSWORD, security: str = "none") -> smtp.SmtpConfig:
    return smtp.SmtpConfig(
        host="127.0.0.1",
        port=port,
        security=security,
        username=USERNAME,
        password=password,
        email=USERNAME,
        display_name="Ops Admin",
    )


class TestVerify:
    async def test_a_working_mailbox_is_healthy(self, smtp_server: _Server) -> None:
        outcome = await smtp.verify(_config(smtp_server.port), timeout_seconds=5)

        assert outcome.ok
        assert outcome.health is MailHealth.ok

    async def test_an_expired_or_changed_password_needs_a_new_password(
        self, smtp_server: _Server
    ) -> None:
        # The provider now expects a different password than the one stored.
        smtp_server.password = "rotated-at-the-provider"

        outcome = await smtp.verify(_config(smtp_server.port), timeout_seconds=5)

        assert not outcome.ok
        assert outcome.health is MailHealth.auth_failed
        assert outcome.error

    async def test_a_dead_port_is_unreachable_not_a_password_problem(self) -> None:
        # Nothing is listening: telling the owner to change their password
        # would send them after the wrong problem.
        outcome = await smtp.verify(_config(_free_port()), timeout_seconds=2)

        assert not outcome.ok
        assert outcome.health is MailHealth.unreachable


class TestSend:
    async def test_delivers_from_the_mailbox_to_itself_with_a_reply_to(
        self, smtp_server: _Server
    ) -> None:
        outcome = await smtp.send(
            _config(smtp_server.port),
            subject="[WikiHub] Account request: Alice",
            body="Please create an account.",
            reply_to="alice@example.org",
            timeout_seconds=5,
        )

        assert outcome.ok
        (envelope,) = smtp_server.envelopes
        assert envelope.mail_from == USERNAME
        assert envelope.rcpt_tos == [USERNAME]
        message = message_from_bytes(envelope.original_content)
        assert message["Subject"] == "[WikiHub] Account request: Alice"
        assert message["Reply-To"] == "alice@example.org"
        assert message["To"] == USERNAME
        assert "Ops Admin" in message["From"]

    async def test_a_rejected_password_is_reported_and_nothing_is_delivered(
        self, smtp_server: _Server
    ) -> None:
        outcome = await smtp.send(
            _config(smtp_server.port, password="stale"),
            subject="s",
            body="b",
            timeout_seconds=5,
        )

        assert outcome.health is MailHealth.auth_failed
        assert smtp_server.envelopes == []

    async def test_line_breaks_in_a_typed_name_cannot_inject_headers(
        self, smtp_server: _Server
    ) -> None:
        outcome = await smtp.send(
            _config(smtp_server.port),
            subject="[WikiHub] Request: Eve\r\nBcc: victim@example.org",
            body="b",
            reply_to="eve@example.org\r\nBcc: victim@example.org",
            timeout_seconds=5,
        )

        assert outcome.ok
        message = message_from_bytes(smtp_server.envelopes[0].original_content)
        assert message["Bcc"] is None
        assert "Bcc:" in message["Subject"]  # flattened into the subject text, harmless


class TestVerifyAll:
    async def test_checks_every_mailbox_and_keeps_the_order(self, smtp_server: _Server) -> None:
        good = _config(smtp_server.port)
        bad = _config(smtp_server.port, password="stale")

        outcomes = await smtp.verify_all([bad, good, bad], timeout_seconds=5)

        assert [outcome.ok for outcome in outcomes] == [False, True, False]


class TestClassify:
    @pytest.mark.parametrize(
        ("error", "health"),
        [
            (aiosmtplib.SMTPAuthenticationError(535, "auth failed"), MailHealth.auth_failed),
            (aiosmtplib.SMTPConnectError("refused"), MailHealth.unreachable),
            (aiosmtplib.SMTPServerDisconnected("dropped"), MailHealth.unreachable),
            (TimeoutError(), MailHealth.unreachable),
            (OSError("no route to host"), MailHealth.unreachable),
            (aiosmtplib.SMTPRecipientRefused(550, "no such user", "x@y"), MailHealth.error),
            (ValueError("unexpected"), MailHealth.error),
        ],
    )
    def test_maps_the_failure_to_what_the_owner_should_do(
        self, error: BaseException, health: MailHealth
    ) -> None:
        outcome = smtp.classify(error)

        assert not outcome.ok
        assert outcome.health is health
        assert outcome.error


class TestClientSecurity:
    @pytest.mark.parametrize(
        ("security", "use_tls", "start_tls"),
        [("ssl", True, False), ("starttls", False, True), ("none", False, False)],
    )
    def test_security_choice_sets_the_tls_mode(
        self,
        monkeypatch: pytest.MonkeyPatch,
        security: str,
        use_tls: bool,
        start_tls: bool,
    ) -> None:
        seen: dict[str, object] = {}
        monkeypatch.setattr(smtp.aiosmtplib, "SMTP", lambda **kwargs: seen.update(kwargs))

        smtp._client(_config(587, security=security), 5)

        assert seen["use_tls"] is use_tls
        # Explicit True/False, never None: None means "upgrade if the server
        # offers it", which would let a stripped STARTTLS send the password
        # in the clear.
        assert seen["start_tls"] is start_tls
