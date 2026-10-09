"""Acting on a request straight from the Inbox: create the account, or reset
the password, and email the result to the person who asked.

The two automatic actions are deliberately narrower than the manual ones an
administrator can always do in Users:

* **The requester's address is unverified** - anyone can type anyone's. So a
  password is only ever *reset and emailed* when the address in the request
  matches the address already on the account; otherwise the administrator has
  to check who they are talking to and use the manual route.
* **Accounts an administrator cannot touch by hand stay off limits** (the
  built-in administrator, and peer administrators): the same rules as Users.
* **A request is acted on once.** Once resolved, neither action is offered, so
  a double click cannot create a second account or reset a password twice.

If the email cannot be sent, the account is still created (or the password
still reset) and the new password is handed back once, so the administrator can
pass it on some other way instead of being left with an account nobody can use.
"""

from __future__ import annotations

import re
import secrets
import uuid
from datetime import UTC, datetime

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import BadRequestError, NotFoundError, PermissionDeniedError
from app.core.logging import get_logger
from app.models.admin_mail import AdminMailbox, AdminRequest, AdminRequestRecipient, MailHealth
from app.models.permission import GlobalPermission
from app.models.user import User
from app.modules.admin_mail import email_templates, smtp
from app.modules.admin_mail.crypto import CredentialUnreadableError
from app.modules.admin_mail.email_templates import Brand, Signature
from app.modules.admin_mail.service import AdminMailService, public_link
from app.modules.auth.service import AuthService
from app.modules.permissions.service import PermissionService
from app.schemas.admin_mail import (
    AutoActionResult,
    MatchedAccount,
    RequestActionPreview,
)
from app.schemas.user import UserCreate
from app.services.audit import ClientInfo
from app.services.site_settings import SiteSettingsService

logger = get_logger(__name__)

_USERNAME = re.compile(r"^[a-zA-Z0-9._-]{3,64}$")
_EMAIL = TypeAdapter(EmailStr)

# Letters and digits without look-alikes (0/O, 1/l/I), so a password read off a
# screen or an email is typed correctly the first time.
_LOWER = "abcdefghijkmnopqrstuvwxyz"
_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
_DIGITS = "23456789"


def generate_password(length: int = 16) -> str:
    """Random, and always passes the password-strength rules (upper, lower and a
    digit), so it is accepted anywhere a person could set one by hand."""
    alphabet = _LOWER + _UPPER + _DIGITS
    while True:
        candidate = "".join(secrets.choice(alphabet) for _ in range(length))
        if (
            any(c in _LOWER for c in candidate)
            and any(c in _UPPER for c in candidate)
            and any(c in _DIGITS for c in candidate)
        ):
            return candidate


def _now() -> datetime:
    return datetime.now(UTC)


class RequestActionService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        actor: User,
        client: ClientInfo | None = None,
        impersonator: User | None = None,
    ) -> None:
        self.session = session
        self.actor = actor
        self.mail = AdminMailService(session, actor=actor, client=client, impersonator=impersonator)
        self.auth = AuthService(session, actor=actor, client=client, impersonator=impersonator)

    # --- looking things up -------------------------------------------------

    async def _load(self, request_id: uuid.UUID) -> tuple[AdminRequest, AdminRequestRecipient]:
        await self.mail._require_inbox(self.actor)
        row = await self.mail.repo.get_inbox_item(self.actor.id, request_id)
        if row is None:
            raise NotFoundError("Request not found.", code="request_not_found")
        recipient, request = row
        return request, recipient

    async def _require_manage_users(self) -> None:
        await PermissionService(self.session).require_global(
            self.actor, GlobalPermission.manage_users
        )

    async def _free_username(self, request: AdminRequest) -> str:
        preferred = (request.requester_username or "").strip()
        base = preferred if _USERNAME.match(preferred) else ""
        if not base:
            local = re.sub(r"[^a-z0-9._-]", "", request.requester_email.split("@", 1)[0].lower())
            base = local
            if len(base) < 3:
                base = re.sub(r"[^a-z0-9._-]", "", request.requester_name.lower().replace(" ", "."))
            if len(base) < 3:
                base = f"{base}user"
        base = base[:40]
        candidate = base
        for attempt in range(2, 200):
            if await self.auth.users.get_by_username(candidate) is None:
                return candidate
            candidate = f"{base}{attempt}"
        raise BadRequestError("Could not find a free username.", code="auto_no_username")

    async def _matched_account(self, request: AdminRequest) -> User | None:
        """The existing account a request is about. A password reset may name it
        by username; an account request has only the address to go on.

        People often type their email into the sign-in page's "username" box,
        so a username that matches no account is tried as an email too, and
        then the request's own address - otherwise a reset for an account that
        plainly exists would be offered as "create a new account" (which then
        fails on the taken address)."""
        username = (request.requester_username or "").strip()
        if request.kind == "password_reset" and username:
            by_username = await self.auth.users.get_by_username(username)
            if by_username is not None:
                return by_username
            if "@" in username:
                by_typed_email = await self.auth.users.get_by_email(username)
                if by_typed_email is not None:
                    return by_typed_email
        return await self.auth.users.get_by_email(request.requester_email)

    # --- what can be done --------------------------------------------------

    async def preview(self, request_id: uuid.UUID) -> RequestActionPreview:
        request, _recipient = await self._load(request_id)
        return await self._plan(request)

    async def _plan(self, request: AdminRequest) -> RequestActionPreview:
        """What the automatic button would do for this request, or why it cannot.

        Neither kind is a dead end when the account it names does not exist yet:
        an account request whose address already belongs to one most likely lost
        the password, so the automatic action becomes a reset for that account -
        and, the other way round, a password reset that names no account has
        nothing to reset, so the automatic action becomes creating it instead.
        """
        if request.kind == "other":
            return RequestActionPreview(
                kind=request.kind, auto_allowed=False, auto_blocked="not_applicable"
            )

        user = await self._matched_account(request)

        if user is None:
            username = await self._free_username(request)
            try:
                _EMAIL.validate_python(request.requester_email)
                email_ok = True
            except ValidationError:
                email_ok = False
            reason: str | None = None
            if request.resolved_at:
                reason = "already_resolved"
            elif not email_ok:
                reason = "email_invalid"
            return RequestActionPreview(
                kind=request.kind,
                suggested_username=username,
                auto_action="create_account",
                auto_allowed=reason is None,
                auto_blocked=reason,
            )

        matched = MatchedAccount(
            id=user.id,
            username=user.username,
            full_name=user.full_name,
            email=user.email,
            is_active=user.is_active,
        )
        email_matches = user.email.strip().lower() == request.requester_email.strip().lower()
        block: str | None = None
        if request.resolved_at:
            block = "already_resolved"
        elif not user.is_active:
            block = "account_inactive"
        elif user.is_protected:
            block = "account_protected"
        elif not email_matches:
            block = "email_mismatch"
        else:
            try:
                self.auth.assert_peer_admin_editable(user)
            except PermissionDeniedError:
                block = "peer_admin"
        return RequestActionPreview(
            kind=request.kind,
            matched_account=matched,
            # For an account request the account was found *by* this address.
            email_in_use=request.kind == "account",
            email_matches=email_matches,
            auto_action="reset_password",
            auto_allowed=block is None,
            auto_blocked=block,
        )

    # --- the two automatic actions -----------------------------------------

    async def create_account(
        self, request_id: uuid.UUID, *, login_url: str | None
    ) -> AutoActionResult:
        request, recipient = await self._load(request_id)
        await self._require_manage_users()
        plan = await self._plan(request)
        if (
            plan.auto_action != "create_account"
            or not plan.auto_allowed
            or not plan.suggested_username
        ):
            raise BadRequestError(
                "This request cannot be turned into an account automatically.",
                code=f"auto_{plan.auto_blocked or 'not_applicable'}",
            )

        password = generate_password()
        user = await self.auth.create_user(
            UserCreate(
                username=plan.suggested_username,
                email=request.requester_email,
                full_name=request.requester_name[:255],
                password=password,
            )
        )
        return await self._finish(
            request,
            recipient,
            user,
            password,
            created=True,
            login_url=login_url,
            to=request.requester_email,
        )

    async def reset_password(
        self, request_id: uuid.UUID, *, login_url: str | None
    ) -> AutoActionResult:
        request, recipient = await self._load(request_id)
        await self._require_manage_users()
        plan = await self._plan(request)
        if (
            plan.auto_action != "reset_password"
            or not plan.auto_allowed
            or not plan.matched_account
        ):
            raise BadRequestError(
                "This password cannot be reset automatically.",
                code=f"auto_{plan.auto_blocked or 'not_applicable'}",
            )

        password = generate_password()
        # Sent to the address already on the account (which the request matched),
        # never to one that was merely typed into the form.
        user = await self.auth.reset_password(plan.matched_account.id, password)
        return await self._finish(
            request,
            recipient,
            user,
            password,
            created=False,
            login_url=login_url,
            to=user.email,
        )

    # --- shared tail -------------------------------------------------------

    async def _finish(
        self,
        request: AdminRequest,
        recipient: AdminRequestRecipient,
        user: User,
        password: str,
        *,
        created: bool,
        login_url: str | None,
        to: str,
    ) -> AutoActionResult:
        # Any administrator can handle a request, mailbox or not: the details
        # go out through their own mailbox, else one of the shared pool. With
        # no mailbox anywhere the account is still created / reset and the
        # password is handed back instead (see below).
        try:
            mailbox: AdminMailbox | None = (await self.mail._resolve_sender(self.actor))[0]
        except PermissionDeniedError:
            mailbox = None
        effective = await SiteSettingsService(self.session).get_effective()
        site_name = effective.site_name
        brand = Brand.from_settings(
            site_name,
            getattr(effective, "theme_color", None),
            custom_logo_url=getattr(effective, "custom_logo_url", None),
        )
        # Closes the message the way the administrator would: their own name.
        own_mailbox = mailbox is not None and mailbox.user_id == self.actor.id
        signature = Signature(
            name=(mailbox.display_name if own_mailbox and mailbox else None)
            or self.actor.full_name
            or self.actor.username,
            title=f"Administrator, {site_name}",
            email=mailbox.email if own_mailbox and mailbox else None,
            url=public_link(""),
        )
        text, html = email_templates.account_details(
            brand,
            created=created,
            name=request.requester_name,
            username=user.username,
            password=password,
            # The page the administrator is on knows where the app lives; the
            # configured address is only the fallback.
            login_url=login_url or public_link("/login"),
            signature=signature,
        )
        subject_line = (
            "Your account has been created" if created else "Your password has been reset"
        )
        if mailbox is None:
            outcome = smtp.SmtpOutcome(
                ok=False,
                health=MailHealth.unknown,
                error="No administrator mailbox is set up to send this from.",
            )
        else:
            try:
                config = self.mail._config(mailbox)
            except CredentialUnreadableError:
                outcome = self.mail._unreadable()
            else:
                outcome = await smtp.send(
                    config,
                    subject=f"[{site_name}] {subject_line}",
                    body=text,
                    html=html,
                    to=to,
                    timeout_seconds=settings.mail_send_timeout_seconds,
                )
            # A send is as good a health check as the hourly one.
            self.mail._apply(mailbox, outcome)

        # Handled, so it is resolved (and, obviously, read) for everyone.
        now = _now()
        request.resolved_at = now
        request.resolved_by_id = self.actor.id
        recipient.read_at = recipient.read_at or now
        await self.mail.clear_request_notifications_for_everyone(request.id)
        await self.session.flush()

        logger.info(
            "admin_request_actioned",
            kind=request.kind,
            username=user.username,
            emailed=outcome.ok,
        )
        return AutoActionResult(
            item=await self.mail.item_with_delivery(recipient, request),
            username=user.username,
            emailed_to=to,
            email_sent=outcome.ok,
            email_error=None if outcome.ok else outcome.error,
            # Only handed back when it could not be emailed: otherwise it goes
            # to the person it belongs to and nowhere else.
            password=None if outcome.ok else password,
        )
