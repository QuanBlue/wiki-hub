"""Acting on a request from the Inbox, against real PostgreSQL and a real SMTP server.

What matters here is what a person would actually receive and be able to do:
the emailed password really signs them in, an unverified address can never be
used to take over an account, and a request is only ever acted on once.

Requires ``WIKIHUB_TEST_DATABASE_URL``; skipped otherwise.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from email import message_from_bytes
from unittest.mock import AsyncMock, Mock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError, NotFoundError, PermissionDeniedError
from app.core.security import verify_password
from app.models.admin_mail import AdminRequest
from app.models.user import User
from app.modules.admin_mail.actions import RequestActionService, generate_password
from app.modules.admin_mail.crypto import CredentialUnreadableError
from app.modules.admin_mail.service import AdminMailService
from app.modules.auth.service import AuthService
from app.schemas.user import UserCreate
from tests.integration.conftest import unique
from tests.integration.test_admin_mail_service import _admin, _mailbox, _request
from tests.unit.test_admin_mail_smtp import PASSWORD, _Server, smtp_server  # noqa: F401

pytestmark = pytest.mark.integration


async def _submit(session: AsyncSession, admin: User, **overrides: object) -> str:
    payload = _request(**overrides)
    await AdminMailService(session).submit_request(payload, client_ip=None)
    # Every request in a test shares one transaction timestamp, so "the newest"
    # is ambiguous: find the one just made by who it says it is from.
    page = await AdminMailService(session).list_inbox(admin, status="all", limit=100, offset=0)
    (item,) = [row for row in page.items if row.requester_email == payload.requester_email]
    return item.id  # type: ignore[return-value]


def _part(envelope, content_type: str) -> str:
    """One alternative of the (multipart) message the requester was sent."""
    for part in message_from_bytes(envelope.content).walk():
        if part.get_content_type() == content_type:
            return part.get_payload(decode=True).decode()
    raise AssertionError(f"no {content_type} part")


def _body(envelope) -> str:
    return _part(envelope, "text/plain")


def _emailed_password(envelope) -> str:
    match = re.search(r"Temporary password: (\S+)", _body(envelope))
    assert match is not None
    return match.group(1)


async def _setup(session: AsyncSession, server: _Server) -> tuple[User, RequestActionService]:
    admin = await _admin(session)
    await _mailbox(session, admin, server)
    return admin, RequestActionService(session, actor=admin)


async def _member(session: AsyncSession, **overrides: object) -> User:
    values: dict[str, object] = {
        "username": unique("member"),
        "email": f"{unique('member')}@example.org",
        "full_name": "Member",
        "password": "Member-password-1",
    }
    values.update(overrides)
    return await AuthService(session).create_user(UserCreate(**values))


class TestGeneratedPasswords:
    def test_always_meet_the_strength_rules_and_are_not_repeated(self) -> None:
        seen = {generate_password() for _ in range(200)}

        assert len(seen) == 200
        for value in seen:
            assert len(value) >= 12
            assert re.search(r"[a-z]", value)
            assert re.search(r"[A-Z]", value)
            assert re.search(r"[0-9]", value)
            # No look-alikes to mistype from an email.
            assert not re.search(r"[0OIl1]", value)


class TestCreateAccount:
    async def test_creates_the_account_and_emails_the_details_to_the_requester(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin, actions = await _setup(session, smtp_server)
        request_id = await _submit(
            session,
            admin,
            kind="account",
            requester_name="Alice Nguyen",
            requester_email="alice.nguyen@example.org",
        )
        smtp_server.envelopes.clear()

        result = await actions.create_account(
            request_id, login_url="https://wiki.example.test/login"
        )

        assert (result.username, result.email_sent, result.password) == (
            "alice.nguyen",
            True,
            None,
        )
        (envelope,) = smtp_server.envelopes
        assert envelope.rcpt_tos == ["alice.nguyen@example.org"]
        assert "Username: alice.nguyen" in _body(envelope)
        assert "https://wiki.example.test/login" in _body(envelope)
        # Also sent as a styled HTML message, signed by the administrator.
        html = _part(envelope, "text/html")
        assert "Your account is ready" in html
        assert 'href="https://wiki.example.test/login"' in html
        assert "Best regards," in html
        assert _emailed_password(envelope) in html
        # The emailed password is the one that really signs them in.
        user = await AuthService(session).users.get_by_username("alice.nguyen")
        assert user is not None
        assert verify_password(_emailed_password(envelope), user.password_hash)
        assert (user.full_name, user.email) == ("Alice Nguyen", "alice.nguyen@example.org")
        # An ordinary member: never an administrator.
        assert user.is_superuser is False
        # ...and the request is handled for everyone.
        assert result.item.resolved_at is not None
        assert result.item.read_at is not None

    async def test_a_taken_username_gets_a_number_instead_of_failing(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin, actions = await _setup(session, smtp_server)
        await _member(session, username="bob", email="someone.else@example.org")
        request_id = await _submit(session, admin, requester_email="bob@example.org")

        preview = await actions.preview(request_id)
        result = await actions.create_account(request_id, login_url=None)

        assert preview.suggested_username == "bob2"
        assert result.username == "bob2"

    async def test_an_address_that_already_has_an_account_offers_a_reset_instead(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin, actions = await _setup(session, smtp_server)
        existing = await _member(session)
        old_hash = existing.password_hash
        request_id = await _submit(session, admin, requester_email=existing.email)
        smtp_server.envelopes.clear()

        preview = await actions.preview(request_id)
        # Creating a second account is refused...
        with pytest.raises(BadRequestError) as caught:
            await actions.create_account(request_id, login_url=None)
        # ...but the automatic action is now a password reset for the account
        # that address already belongs to.
        result = await actions.reset_password(request_id, login_url=None)

        assert preview.auto_action == "reset_password"
        assert (preview.auto_allowed, preview.email_in_use) == (True, True)
        assert preview.matched_account is not None
        assert preview.matched_account.username == existing.username
        assert caught.value.code.startswith("auto_")
        (envelope,) = smtp_server.envelopes
        assert envelope.rcpt_tos == [existing.email]
        await session.refresh(existing)
        assert existing.password_hash != old_hash
        assert verify_password(_emailed_password(envelope), existing.password_hash)
        assert result.item.resolved_at is not None

    async def test_a_new_address_still_gets_the_create_action(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin, actions = await _setup(session, smtp_server)
        request_id = await _submit(session, admin, requester_email="fresh@example.org")

        preview = await actions.preview(request_id)

        assert (preview.auto_action, preview.auto_allowed) == ("create_account", True)
        assert preview.matched_account is None

    async def test_an_existing_disabled_account_is_not_reset_automatically(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin, actions = await _setup(session, smtp_server)
        existing = await _member(session)
        existing.is_active = False
        await session.flush()
        request_id = await _submit(session, admin, requester_email=existing.email)

        preview = await actions.preview(request_id)

        assert (preview.auto_action, preview.auto_blocked) == (
            "reset_password",
            "account_inactive",
        )

    async def test_when_the_email_cannot_be_sent_the_password_is_handed_back_once(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin, actions = await _setup(session, smtp_server)
        request_id = await _submit(session, admin, requester_email="carol@example.org")
        smtp_server.password = "rotated-by-the-provider"  # the mailbox stops working

        result = await actions.create_account(request_id, login_url=None)

        # Nothing was mailed, but the account exists and can be given out by hand.
        assert (result.email_sent, result.email_error is not None) == (False, True)
        assert result.password is not None
        user = await AuthService(session).users.get_by_username("carol")
        assert user is not None and verify_password(result.password, user.password_hash)

    async def test_a_request_is_only_acted_on_once(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin, actions = await _setup(session, smtp_server)
        request_id = await _submit(session, admin, requester_email="dave@example.org")
        await actions.create_account(request_id, login_url=None)

        preview = await actions.preview(request_id)
        with pytest.raises(BadRequestError) as caught:
            await actions.create_account(request_id, login_url=None)

        assert preview.auto_blocked == "already_resolved"
        assert caught.value.code == "auto_already_resolved"

    async def test_a_request_of_another_kind_is_not_turned_into_an_account(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin, actions = await _setup(session, smtp_server)
        request_id = await _submit(session, admin, kind="other")

        assert (await actions.preview(request_id)).auto_blocked == "not_applicable"
        with pytest.raises(BadRequestError):
            await actions.create_account(request_id, login_url=None)


class TestResetPassword:
    async def test_resets_the_password_and_emails_it_to_the_address_on_the_account(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin, actions = await _setup(session, smtp_server)
        member = await _member(session)
        old_hash = member.password_hash
        request_id = await _submit(
            session,
            admin,
            kind="password_reset",
            requester_email=member.email.upper(),  # case does not matter
            requester_username=member.username,
        )
        smtp_server.envelopes.clear()

        preview = await actions.preview(request_id)
        result = await actions.reset_password(request_id, login_url=None)

        assert preview.auto_allowed and preview.matched_account is not None
        assert preview.matched_account.username == member.username
        assert (result.email_sent, result.password) == (True, None)
        (envelope,) = smtp_server.envelopes
        assert envelope.rcpt_tos == [member.email]
        await session.refresh(member)
        new_password = _emailed_password(envelope)
        assert member.password_hash != old_hash
        assert verify_password(new_password, member.password_hash)
        assert not verify_password("Member-password-1", member.password_hash)
        assert result.item.resolved_at is not None

    async def test_an_address_that_is_not_the_accounts_never_gets_a_password(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        # Anyone can type anyone's username and their own address: the password
        # must not be mailed to a stranger.
        admin, actions = await _setup(session, smtp_server)
        victim = await _member(session)
        old_hash = victim.password_hash
        request_id = await _submit(
            session,
            admin,
            kind="password_reset",
            requester_email="attacker@example.org",
            requester_username=victim.username,
        )
        smtp_server.envelopes.clear()

        preview = await actions.preview(request_id)
        with pytest.raises(BadRequestError) as caught:
            await actions.reset_password(request_id, login_url=None)

        assert preview.auto_blocked == "email_mismatch"
        assert preview.matched_account is not None and preview.email_matches is False
        assert caught.value.code == "auto_email_mismatch"
        await session.refresh(victim)
        assert victim.password_hash == old_hash
        assert smtp_server.envelopes == []

    async def test_an_email_typed_as_the_username_finds_the_account_to_reset(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        """People type their address into the sign-in page's username box. That
        must still find their account and offer a reset - not "create an
        account", which then fails on the taken address."""
        admin, actions = await _setup(session, smtp_server)
        member = await _member(session)
        request_id = await _submit(
            session,
            admin,
            kind="password_reset",
            requester_email=member.email,
            requester_username=member.email.upper(),
        )
        smtp_server.envelopes.clear()

        preview = await actions.preview(request_id)

        assert preview.auto_action == "reset_password"
        assert preview.matched_account is not None
        assert preview.matched_account.username == member.username
        assert preview.auto_allowed is True
        result = await actions.reset_password(request_id, login_url=None)
        assert result.email_sent is True
        (envelope,) = smtp_server.envelopes
        assert envelope.rcpt_tos == [member.email]

    async def test_a_password_reset_for_no_known_account_offers_to_create_one(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        """Nothing to reset for an account that does not exist - so, the same
        as an account request whose address already has one, this is not a
        dead end: the automatic action becomes creating the account instead."""
        admin, actions = await _setup(session, smtp_server)
        request_id = await _submit(
            session,
            admin,
            kind="password_reset",
            requester_email="nobody@example.org",
            requester_username="nobody",
        )

        preview = await actions.preview(request_id)

        assert preview.matched_account is None
        assert preview.auto_action == "create_account"
        assert preview.auto_allowed is True
        assert preview.suggested_username == "nobody"

        outcome = await actions.create_account(request_id, login_url=None)

        assert outcome.username == "nobody"
        assert outcome.emailed_to == "nobody@example.org"

    async def test_a_disabled_account_and_a_peer_administrator_are_left_to_a_person(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin, actions = await _setup(session, smtp_server)
        disabled = await _member(session)
        disabled.is_active = False
        peer = await _admin(session)
        await session.flush()
        blocked = {}
        for label, account in (("disabled", disabled), ("peer", peer)):
            request_id = await _submit(
                session,
                admin,
                kind="password_reset",
                requester_email=account.email,
                requester_username=account.username,
            )
            blocked[label] = (await actions.preview(request_id)).auto_blocked

        assert blocked == {"disabled": "account_inactive", "peer": "peer_admin"}


class TestEdges:
    async def test_an_unknown_request_is_not_found(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        _admin_user, actions = await _setup(session, smtp_server)
        with pytest.raises(NotFoundError):
            await actions.preview(uuid.uuid4())

    @pytest.mark.parametrize(
        ("name", "email", "expected"),
        [
            # A two-letter address falls back to the name...
            ("Jo Ann", "jo@example.org", "jo.ann"),
            # ...and a name too short as well is padded out.
            ("Bo", "b@example.org", "bouser"),
        ],
    )
    async def test_a_short_address_borrows_the_name_for_a_username(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
        name: str,
        email: str,
        expected: str,
    ) -> None:
        admin, actions = await _setup(session, smtp_server)
        request_id = await _submit(session, admin, requester_name=name, requester_email=email)

        assert (await actions.preview(request_id)).suggested_username == expected

    async def test_running_out_of_usernames_is_refused(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin, actions = await _setup(session, smtp_server)
        request_id = await _submit(session, admin, requester_email="zed@example.org")
        taken = await _member(session)

        with (
            patch.object(actions.auth.users, "get_by_username", AsyncMock(return_value=taken)),
            patch.object(actions.auth.users, "get_by_email", AsyncMock(return_value=None)),
            pytest.raises(BadRequestError) as caught,
        ):
            await actions.preview(request_id)

        assert caught.value.code == "auto_no_username"

    async def test_an_address_that_is_not_one_cannot_get_an_account(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin, actions = await _setup(session, smtp_server)
        request_id = await _submit(session, admin, requester_email="erin@example.org")
        # The form validates the address; a row from before that check need not.
        request = await session.get(AdminRequest, uuid.UUID(str(request_id)))
        assert request is not None
        request.requester_email = "erin at example dot org"
        await session.flush()

        assert (await actions.preview(request_id)).auto_blocked == "email_invalid"

        request.resolved_at = datetime.now(UTC)
        await session.flush()
        assert (await actions.preview(request_id)).auto_blocked == "already_resolved"

    async def test_the_protected_account_is_left_to_a_person(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin, actions = await _setup(session, smtp_server)
        protected = await _member(session)
        protected.is_protected = True
        await session.flush()
        request_id = await _submit(session, admin, requester_email=protected.email)

        assert (await actions.preview(request_id)).auto_blocked == "account_protected"

    async def test_with_no_mailbox_to_send_from_the_password_is_handed_back(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin, actions = await _setup(session, smtp_server)
        request_id = await _submit(session, admin, requester_email="fay@example.org")

        with patch.object(
            actions.mail, "_resolve_sender", AsyncMock(side_effect=PermissionDeniedError("none"))
        ):
            result = await actions.create_account(request_id, login_url=None)

        assert result.email_sent is False
        assert result.email_error == "No administrator mailbox is set up to send this from."
        assert result.password is not None

    async def test_an_unreadable_mailbox_password_is_reported_not_raised(
        self,
        session: AsyncSession,
        smtp_server: _Server,  # noqa: F811
    ) -> None:
        admin, actions = await _setup(session, smtp_server)
        request_id = await _submit(session, admin, requester_email="gus@example.org")

        with patch.object(
            actions.mail, "_config", Mock(side_effect=CredentialUnreadableError("key rotated"))
        ):
            result = await actions.create_account(request_id, login_url=None)

        assert result.email_sent is False
        assert result.password is not None
