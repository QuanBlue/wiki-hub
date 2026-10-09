"""Administrator mailboxes: managing them, delivering requests, and the inbox.

Three ideas hold the design together:

* **The Inbox is the durable copy.** A request is stored before any email is
  attempted, so an expired mailbox password can delay an email but never lose a
  request.
* **Each mailbox emails itself.** The requester is only told something went
  wrong when *no* mailbox could be reached; one success means an administrator
  has it.
* **"Active" is computed, not copied.** A mailbox receives requests while it is
  switched on *and* its account is active, evaluated live, so disabling an
  account disables the mailbox with no second step to forget.
"""

from __future__ import annotations

import asyncio
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
)
from app.core.logging import get_logger
from app.models.admin_mail import (
    AdminMailbox,
    AdminRequest,
    AdminRequestRecipient,
    DeliveryStatus,
    MailHealth,
)
from app.models.audit import AuditAction
from app.models.notification import Notification
from app.models.permission import (
    GlobalPermission,
    Group,
    GroupGlobalPermission,
    GroupMember,
    UserGlobalPermissionOverride,
)
from app.models.user import User
from app.modules.admin_mail import email_templates, smtp
from app.modules.admin_mail.crypto import (
    CredentialUnreadableError,
    decrypt_password,
    encrypt_password,
)
from app.modules.admin_mail.email_templates import Brand, Signature
from app.modules.notifications.service import notify
from app.modules.permissions.service import PermissionService
from app.repositories.admin_mail import AdminMailRepository, InboxStatus
from app.schemas.admin_mail import (
    AccountEmailResult,
    ContactAdminCreate,
    InboxCounts,
    InboxItem,
    InboxUpdate,
    MailboxCreate,
    MailboxRead,
    MailboxTestResult,
    MailboxUpdate,
    MailSummary,
)
from app.schemas.pagination import Page
from app.services.audit import AuditService, ClientInfo
from app.services.site_settings import SiteSettingsService

#: Top-level names reserved for local or documentation use: no mail server will
#: ever accept a message for them, so sending only earns a bounce.
_UNROUTABLE_TLDS = {"local", "localhost", "invalid", "test", "example", "internal", "lan", "home"}


def is_deliverable_address(address: str | None) -> bool:
    """Whether mail to ``address`` can reach anyone, going by its domain alone.

    An account created with a placeholder address (``admin@wikihub.local``) is
    fine to sign in with but cannot receive mail; writing to it makes the
    receiving server bounce the message back to the sending mailbox.
    """
    if not address or "@" not in address:
        return False
    domain = address.rsplit("@", 1)[1].strip().lower().rstrip(".")
    if "." not in domain:
        return False
    return domain.rsplit(".", 1)[1] not in _UNROUTABLE_TLDS


logger = get_logger(__name__)

#: Fields whose change is worth showing in the audit trail. The password is
#: deliberately not among them.
AUDITED_FIELDS = (
    "email",
    "display_name",
    "smtp_host",
    "smtp_port",
    "smtp_security",
    "smtp_username",
    "is_enabled",
)

_KIND_LABELS = {
    "account": "Account request",
    "password_reset": "Password reset request",
    "other": "Request",
}


def _now() -> datetime:
    return datetime.now(UTC)


def public_link(path: str) -> str | None:
    """A link into the app for an email, or ``None`` when the operator has not
    said where the app lives (better no link than a guessed one)."""
    base = settings.public_url.strip().rstrip("/")
    return f"{base}{path}" if base else None


@dataclass(frozen=True)
class HealthcheckSummary:
    checked: int
    ok: int
    needs_attention: int


class AdminMailService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        actor: User | None = None,
        client: ClientInfo | None = None,
        impersonator: User | None = None,
    ) -> None:
        self.session = session
        self.actor = actor
        self.repo = AdminMailRepository(session)
        self.audit = AuditService(session, actor=actor, client=client, impersonator=impersonator)

    # --- helpers ---------------------------------------------------------

    @staticmethod
    def _config(mailbox: AdminMailbox) -> smtp.SmtpConfig:
        """Raises :class:`CredentialUnreadableError` if the password cannot be decrypted."""
        return smtp.SmtpConfig(
            host=mailbox.smtp_host,
            port=mailbox.smtp_port,
            security=mailbox.smtp_security,
            username=mailbox.smtp_username,
            password=decrypt_password(mailbox.smtp_password_enc),
            email=mailbox.email,
            display_name=mailbox.display_name,
        )

    @staticmethod
    def _unreadable() -> smtp.SmtpOutcome:
        return smtp.SmtpOutcome(
            ok=False,
            health=MailHealth.auth_failed,
            error="The stored password could not be decrypted; enter it again.",
        )

    @staticmethod
    def _apply(mailbox: AdminMailbox, outcome: smtp.SmtpOutcome) -> None:
        mailbox.health_status = outcome.health.value
        mailbox.health_checked_at = _now()
        mailbox.health_error = None if outcome.ok else outcome.error

    async def _verify(self, mailbox: AdminMailbox) -> smtp.SmtpOutcome:
        try:
            config = self._config(mailbox)
        except CredentialUnreadableError:
            return self._unreadable()
        return await smtp.verify(config, timeout_seconds=settings.mail_verify_timeout_seconds)

    @staticmethod
    def _prospective(
        mailbox: AdminMailbox, changes: dict[str, object], new_password: str | None
    ) -> smtp.SmtpConfig:
        """The connection settings the mailbox would have after ``changes``."""

        def pick(field: str, current: object) -> object:
            value = changes.get(field)
            return current if value is None else value

        if "smtp_username" in changes:
            username = str(changes["smtp_username"] or changes.get("email") or mailbox.email)
        else:
            username = mailbox.smtp_username
        if new_password is not None:
            password = new_password
        else:
            try:
                password = decrypt_password(mailbox.smtp_password_enc)
            except CredentialUnreadableError:
                raise BadRequestError(
                    "The stored password could not be decrypted; enter it again.",
                    code="mail_auth_failed",
                    details={"reason": "stored password unreadable", "health": "auth_failed"},
                ) from None
        # An explicit null clears the sender name, unlike the other fields.
        display_name = changes.get("display_name", mailbox.display_name)
        return smtp.SmtpConfig(
            host=str(pick("smtp_host", mailbox.smtp_host)),
            port=int(str(pick("smtp_port", mailbox.smtp_port))),
            security=str(pick("smtp_security", mailbox.smtp_security)),
            username=username.strip(),
            password=password,
            email=str(pick("email", mailbox.email)),
            display_name=str(display_name) if display_name else None,
        )

    @staticmethod
    async def _require_working(config: smtp.SmtpConfig) -> smtp.SmtpOutcome:
        """Prove the settings work before anything is saved.

        A mailbox that cannot sign in would only ever produce a failed row and
        a banner, so a bad host, port, security mode, username or password is
        rejected here and nothing is stored.
        """
        outcome = await smtp.verify(config, timeout_seconds=settings.mail_verify_timeout_seconds)
        if outcome.ok:
            return outcome
        code = {
            MailHealth.auth_failed: "mail_auth_failed",
            MailHealth.unreachable: "mail_unreachable",
        }.get(outcome.health, "mail_check_failed")
        raise BadRequestError(
            "The mail server check failed, so nothing was saved.",
            code=code,
            details={"reason": outcome.error, "health": outcome.health.value},
        )

    @staticmethod
    def _read(mailbox: AdminMailbox, user: User) -> MailboxRead:
        return MailboxRead(
            id=mailbox.id,
            user_id=mailbox.user_id,
            username=user.username,
            user_full_name=user.full_name,
            user_is_active=user.is_active,
            email=mailbox.email,
            display_name=mailbox.display_name,
            smtp_host=mailbox.smtp_host,
            smtp_port=mailbox.smtp_port,
            smtp_security=mailbox.smtp_security,
            smtp_username=mailbox.smtp_username,
            has_password=bool(mailbox.smtp_password_enc),
            is_enabled=mailbox.is_enabled,
            effective_enabled=mailbox.is_enabled and user.is_active,
            health_status=mailbox.health_status,
            health_checked_at=mailbox.health_checked_at,
            health_error=mailbox.health_error,
            created_at=mailbox.created_at,
        )

    async def _get(self, mailbox_id: uuid.UUID) -> tuple[AdminMailbox, User]:
        found = await self.repo.get_mailbox(mailbox_id)
        if found is None:
            raise NotFoundError("Mailbox not found.", code="mailbox_not_found")
        return found

    def _assert_mailbox_editable(self, mailbox: AdminMailbox) -> None:
        """Reject a write to another administrator's mailbox unless the actor
        is that mailbox's own account or the protected super administrator.

        `CurrentSuperuser` only means "some effective system administrator" -
        without this, any of them could reconfigure, re-key, test or delete
        *any other* administrator's mailbox, `system_admin` alone being the
        only thing checked at the route. Nothing about that requires being
        that mailbox's owner, so a mistaken (or deliberately hostile) edit by
        a peer administrator would break someone else's mail with no warning
        to the person who actually owns it. Mirrors `AuthService`'s
        `assert_peer_admin_editable`: an ordinary Administrator manages every
        Member's account, but not a peer Administrator's - here, not their
        mailbox either. Excludes the mailbox's own account and a system-level
        call with no actor at all, the same as that guard.
        """
        if self.actor is None or self.actor.id == mailbox.user_id:
            return
        if self.actor.is_protected:
            return
        raise PermissionDeniedError(
            "Only this mailbox's own account or the built-in super administrator can change it.",
            code="mailbox_peer_admin_protected",
        )

    # --- managing mailboxes (administrators) ------------------------------

    async def list_mailboxes(self) -> list[MailboxRead]:
        return [self._read(mailbox, user) for mailbox, user in await self.repo.list_mailboxes()]

    async def create_mailbox(self, payload: MailboxCreate) -> MailboxRead:
        user = await self.session.get(User, payload.user_id)
        if user is None:
            raise NotFoundError("Account not found.", code="user_not_found")
        # Requests contain people's contact details and are meant for
        # administrators, so the linked account has to be one.
        if not await PermissionService(self.session).is_system_admin(user):
            raise BadRequestError(
                "Only administrator accounts can have an administrator mailbox.",
                code="mailbox_user_not_admin",
            )
        if await self.repo.get_mailbox_for_user(user.id) is not None:
            raise ConflictError(
                "This account already has a mailbox.", code="mailbox_already_exists"
            )

        username = (payload.smtp_username or payload.email).strip()
        # Test the connection first: a mailbox is only created if it works.
        outcome = await self._require_working(
            smtp.SmtpConfig(
                host=payload.smtp_host,
                port=payload.smtp_port,
                security=payload.smtp_security,
                username=username,
                password=payload.smtp_password,
                email=payload.email,
                display_name=payload.display_name,
            )
        )

        mailbox = AdminMailbox(
            user_id=user.id,
            email=payload.email,
            display_name=payload.display_name,
            smtp_host=payload.smtp_host,
            smtp_port=payload.smtp_port,
            smtp_security=payload.smtp_security,
            smtp_username=username,
            smtp_password_enc=encrypt_password(payload.smtp_password),
            is_enabled=payload.is_enabled,
        )
        self.repo.add(mailbox)
        self._apply(mailbox, outcome)
        await self.session.flush()
        # `created_at` is filled in by the database; reading it without loading
        # it first would lazy-load inside async code and fail.
        await self.session.refresh(mailbox)
        await self.audit.record(
            AuditAction.admin_mailbox_created,
            entity_type="admin_mailbox",
            entity_id=mailbox.id,
            entity_label=mailbox.email,
            details={"user": user.username, "smtp_host": mailbox.smtp_host},
        )
        return self._read(mailbox, user)

    async def update_mailbox(self, mailbox_id: uuid.UUID, payload: MailboxUpdate) -> MailboxRead:
        mailbox, user = await self._get(mailbox_id)
        self._assert_mailbox_editable(mailbox)
        data = payload.model_dump(exclude_unset=True)
        before = {field: getattr(mailbox, field) for field in AUDITED_FIELDS}

        new_password = data.pop("smtp_password", None)

        # Changing how the mailbox connects (or its password) is tested against
        # the values as they *would* be, before anything is changed: a failed
        # test leaves the stored mailbox exactly as it was.
        reconnect = new_password is not None or any(
            field in data for field in ("smtp_host", "smtp_port", "smtp_security", "smtp_username")
        )
        outcome: smtp.SmtpOutcome | None = None
        if reconnect:
            outcome = await self._require_working(self._prospective(mailbox, data, new_password))

        for field, value in data.items():
            # An explicit null on a required column would make no sense; a blank
            # username means "the email address".
            if value is None and field not in ("display_name", "smtp_username"):
                continue
            if field == "smtp_username":
                value = (value or data.get("email") or mailbox.email).strip()
            setattr(mailbox, field, value)
        if new_password is not None:
            mailbox.smtp_password_enc = encrypt_password(new_password)

        if outcome is not None:
            self._apply(mailbox, outcome)
        await self.session.flush()

        after = {field: getattr(mailbox, field) for field in AUDITED_FIELDS}
        details: dict[str, object] = dict(self.audit.changes(before, after, AUDITED_FIELDS))
        if new_password is not None:
            details["reauthenticated"] = True
        await self.audit.record(
            AuditAction.admin_mailbox_updated,
            entity_type="admin_mailbox",
            entity_id=mailbox.id,
            entity_label=mailbox.email,
            details=details,
        )
        return self._read(mailbox, user)

    async def set_password(self, mailbox_id: uuid.UUID, password: str) -> MailboxRead:
        """Store a new password after proving it works.

        Open to the mailbox's own account, and otherwise only to the built-in
        super administrator, not to every administrator: the account that
        owns the mailbox is the one who receives the "password expired"
        banner and is the one who knows the new password, and a peer
        administrator reaching in to set it is exactly the kind of mistaken
        or hostile change `_assert_mailbox_editable` guards against elsewhere.
        """
        mailbox, user = await self._get(mailbox_id)
        if self.actor is None:
            raise PermissionDeniedError("You cannot change this mailbox's password.")
        self._assert_mailbox_editable(mailbox)

        candidate = smtp.SmtpConfig(
            host=mailbox.smtp_host,
            port=mailbox.smtp_port,
            security=mailbox.smtp_security,
            username=mailbox.smtp_username,
            password=password,
            email=mailbox.email,
            display_name=mailbox.display_name,
        )
        outcome = await smtp.verify(candidate, timeout_seconds=settings.mail_verify_timeout_seconds)
        if outcome.health == MailHealth.auth_failed:
            # Saving a password the server just refused would only replace one
            # broken state with another.
            raise BadRequestError(
                "The mail server rejected this password.",
                code="mail_auth_failed",
                details={"reason": outcome.error},
            )
        mailbox.smtp_password_enc = encrypt_password(password)
        self._apply(mailbox, outcome)
        await self.session.flush()
        await self.audit.record(
            AuditAction.admin_mailbox_password_updated,
            entity_type="admin_mailbox",
            entity_id=mailbox.id,
            entity_label=mailbox.email,
            details={"health": outcome.health.value},
        )
        return self._read(mailbox, user)

    async def test_mailbox(self, mailbox_id: uuid.UUID) -> MailboxTestResult:
        mailbox, _user = await self._get(mailbox_id)
        self._assert_mailbox_editable(mailbox)
        outcome = await self._verify(mailbox)
        self._apply(mailbox, outcome)
        await self.session.flush()
        return MailboxTestResult(
            ok=outcome.ok, health_status=outcome.health.value, error=outcome.error
        )

    async def delete_mailbox(self, mailbox_id: uuid.UUID) -> None:
        mailbox, _user = await self._get(mailbox_id)
        self._assert_mailbox_editable(mailbox)
        label, mailbox_pk = mailbox.email, mailbox.id
        await self.repo.delete(mailbox)
        await self.session.flush()
        await self.audit.record(
            AuditAction.admin_mailbox_deleted,
            entity_type="admin_mailbox",
            entity_id=mailbox_pk,
            entity_label=label,
        )

    # --- the hourly healthcheck ------------------------------------------

    async def run_healthcheck(self) -> HealthcheckSummary:
        """Verify every active mailbox and record the result.

        Disabled mailboxes are skipped: nobody is meant to be reading their
        banner, and a mailbox someone switched off on purpose should not keep
        making outbound connections.
        """
        mailboxes = await self.repo.active_mailboxes()
        readable: list[tuple[AdminMailbox, smtp.SmtpConfig]] = []
        outcomes: dict[uuid.UUID, smtp.SmtpOutcome] = {}
        for mailbox in mailboxes:
            try:
                readable.append((mailbox, self._config(mailbox)))
            except CredentialUnreadableError:
                outcomes[mailbox.id] = self._unreadable()

        results = await smtp.verify_all(
            [config for _mailbox, config in readable],
            timeout_seconds=settings.mail_verify_timeout_seconds,
        )
        for (mailbox, _config), outcome in zip(readable, results, strict=True):
            outcomes[mailbox.id] = outcome

        for mailbox in mailboxes:
            self._apply(mailbox, outcomes[mailbox.id])
        await self.session.flush()

        ok = sum(1 for outcome in outcomes.values() if outcome.ok)
        return HealthcheckSummary(
            checked=len(mailboxes), ok=ok, needs_attention=len(mailboxes) - ok
        )

    # --- a user asking for help (public) ---------------------------------

    async def _system_administrators(self) -> list[User]:
        """Every active account that is a system administrator - a superuser,
        or granted `system_admin` by a group or its own override (and not
        denied it by an override)."""
        candidate_ids = set(
            await self.session.scalars(
                select(User.id).where(User.is_active.is_(True), User.is_superuser.is_(True))
            )
        )
        candidate_ids |= set(
            await self.session.scalars(
                select(GroupMember.user_id)
                .join(Group, Group.id == GroupMember.group_id)
                .join(GroupGlobalPermission, GroupGlobalPermission.group_id == Group.id)
                .where(
                    Group.is_active.is_(True),
                    GroupGlobalPermission.permission == GlobalPermission.system_admin,
                )
            )
        )
        candidate_ids |= set(
            await self.session.scalars(
                select(UserGlobalPermissionOverride.user_id).where(
                    UserGlobalPermissionOverride.permission == GlobalPermission.system_admin,
                    UserGlobalPermissionOverride.enabled.is_(True),
                )
            )
        )
        permissions = PermissionService(self.session)
        admins: list[User] = []
        for user_id in candidate_ids:
            user = await self.session.get(User, user_id)
            if user is not None and user.is_active and await permissions.is_system_admin(user):
                admins.append(user)
        return admins

    async def submit_request(self, payload: ContactAdminCreate, *, client_ip: str | None) -> str:
        """Store the request, then email every active mailbox. Returns
        ``sent``, ``failed`` or ``no_mailbox``."""
        if payload.website.strip():
            # Honeypot tripped. Answer as if it worked so a bot learns nothing.
            return "sent"

        request = AdminRequest(
            kind=payload.kind,
            requester_name=payload.requester_name,
            requester_email=payload.requester_email,
            requester_username=(payload.requester_username or "").strip() or None,
            message=payload.message,
            client_ip=client_ip,
        )
        self.repo.add(request)
        await self.session.flush()

        # Every system administrator sees every request and any of them can
        # handle it - whoever gets there first. Mailboxes only decide where
        # the email goes, not who may see or act on the request.
        mailboxes = await self.repo.active_mailboxes()
        mailbox_by_user = {mailbox.user_id: mailbox for mailbox in mailboxes}
        audience = {admin.id for admin in await self._system_administrators()}
        audience |= set(mailbox_by_user)
        rows: dict[uuid.UUID, AdminRequestRecipient] = {}
        for user_id in audience:
            mailbox = mailbox_by_user.get(user_id)
            rows[user_id] = AdminRequestRecipient(
                request_id=request.id,
                user_id=user_id,
                mailbox_email=mailbox.email if mailbox else "",
                delivery_status=(
                    DeliveryStatus.failed.value if mailbox else DeliveryStatus.none.value
                ),
            )
            self.repo.add(rows[user_id])
            await notify(
                self.session,
                user_id,
                "admin_request",
                params={"name": request.requester_name, "type": request.kind},
                link=f"/admin/inbox?request={request.id}",
            )
        await self.session.flush()
        if not mailboxes:
            return "no_mailbox"
        recipients = {mailbox.id: rows[mailbox.user_id] for mailbox in mailboxes}

        effective = await SiteSettingsService(self.session).get_effective()
        site_name = effective.site_name
        brand = Brand.from_settings(
            site_name,
            getattr(effective, "theme_color", None),
            custom_logo_url=getattr(effective, "custom_logo_url", None),
        )
        subject = f"[{site_name}] {_KIND_LABELS[payload.kind]}: {payload.requester_name}"
        body, html_body = self._render_body(brand, request)

        async def deliver(mailbox: AdminMailbox) -> smtp.SmtpOutcome:
            try:
                config = self._config(mailbox)
            except CredentialUnreadableError:
                return self._unreadable()
            return await smtp.send(
                config,
                subject=subject,
                body=body,
                html=html_body,
                reply_to=request.requester_email,
                timeout_seconds=settings.mail_send_timeout_seconds,
            )

        # Concurrent, and only over plain data: an AsyncSession must never be
        # used by two tasks at once, so results are applied afterwards, in order.
        outcomes = await asyncio.gather(*(deliver(mailbox) for mailbox in mailboxes))

        delivered = 0
        for mailbox, outcome in zip(mailboxes, outcomes, strict=True):
            recipient = recipients[mailbox.id]
            recipient.delivery_status = (
                DeliveryStatus.sent.value if outcome.ok else DeliveryStatus.failed.value
            )
            recipient.delivery_error = None if outcome.ok else outcome.error
            # A send is as good a check as the hourly one, and shows the
            # banner now instead of up to an hour later.
            self._apply(mailbox, outcome)
            delivered += int(outcome.ok)
        await self.session.flush()

        if delivered == 0:
            logger.warning("admin_request_not_delivered", mailboxes=len(mailboxes))
        return "sent" if delivered else "failed"

    @staticmethod
    def _render_body(brand: Brand, request: AdminRequest) -> tuple[str, str]:
        """The notification as ``(plain text, HTML)``."""
        return email_templates.request_notification(
            brand,
            kind=request.kind,
            name=request.requester_name,
            email=request.requester_email,
            username=request.requester_username,
            message=request.message,
            received_at=_now(),
            # Straight to this request (the Inbox opens it from `?request=`),
            # so the administrator lands on the reset / create actions.
            inbox_url=public_link(f"/admin/inbox?request={request.id}"),
        )

    # --- the inbox (every system administrator) ----------------------------

    async def _require_inbox(self, user: User) -> None:
        """Requests are shared by every active system administrator: any of
        them may read and handle one. Also gives this account a row for any
        request it has none for yet (it became an administrator later), so
        the Inbox - which reads per-account rows for unread state - lists
        everything."""
        if not user.is_active or not await PermissionService(self.session).is_system_admin(user):
            raise PermissionDeniedError(
                "Only system administrators can see requests.", code="no_admin_inbox"
            )
        await self._backfill_inbox(user)

    async def _backfill_inbox(self, user: User) -> None:
        """Give an administrator a row (unread state) for every request they
        have none for yet - they became an administrator after it arrived."""
        addressed = select(AdminRequestRecipient.request_id).where(
            AdminRequestRecipient.user_id == user.id
        )
        missing = list(
            await self.session.scalars(
                select(AdminRequest.id).where(AdminRequest.id.not_in(addressed))
            )
        )
        for request_id in missing:
            self.repo.add(
                AdminRequestRecipient(
                    request_id=request_id,
                    user_id=user.id,
                    mailbox_email="",
                    delivery_status=DeliveryStatus.none.value,
                )
            )
        if missing:
            await self.session.flush()

    async def _delivery_overview(
        self, request_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, AdminRequestRecipient]:
        """For each request, the row that best says whether it was emailed:
        a delivered one if any mailbox got it, else a failed attempt. Shown on
        every administrator's view, since most have no mailbox of their own."""
        if not request_ids:
            return {}
        rows = await self.session.scalars(
            select(AdminRequestRecipient).where(
                AdminRequestRecipient.request_id.in_(request_ids),
                AdminRequestRecipient.delivery_status != DeliveryStatus.none.value,
            )
        )
        best: dict[uuid.UUID, AdminRequestRecipient] = {}
        for row in rows:
            current = best.get(row.request_id)
            if current is None or (
                row.delivery_status == DeliveryStatus.sent.value
                and current.delivery_status != DeliveryStatus.sent.value
            ):
                best[row.request_id] = row
        return best

    async def _resolve_sender(self, actor: User) -> tuple[AdminMailbox, bool]:
        """The mailbox to send `actor`'s account mail from, and whether it is
        actually theirs.

        Prefers their own mailbox whenever they have one at all - exactly
        `_require_sendable_mailbox`'s old rule, kept rather than also
        requiring `health_status == "ok"` here: a mailbox nobody has checked
        yet (`unknown`, fresh off being created) deserves the same real send
        attempt it would have gotten before the pool existed, not an early
        detour around it. Only an administrator with no mailbox configured
        at all falls back to a mailbox picked at random from every *other*
        administrator's that is connected right now, so they are not
        silently unable to tell anyone anything just because they never got
        round to setting one up. Random rather than a persistent rotating
        cursor: the simplest way to spread sends across the pool over time
        without coordinating state across worker processes, and at the
        volume this feature sends, nothing needs it to be exact.

        Deliberately ignores `is_enabled` ("Receive requests") on the actor's
        own mailbox: that switch only says whether this account wants
        incoming admin requests, and has nothing to do with whether its own
        mailbox can send a message it is composing right now. Gating sending
        on it as well meant an administrator who had merely turned requests
        off - not broken, not disconnected - silently never emailed anyone
        they created or reset a password for.
        """
        found = await self.repo.get_mailbox_for_user(actor.id)
        if found is not None and found[1].is_active:
            return found[0], True
        pool = [box for box in await self.repo.working_mailboxes() if box.user_id != actor.id]
        if not pool:
            raise PermissionDeniedError(
                "No administrator mailbox is available to send from.", code="no_admin_mailbox"
            )
        return secrets.choice(pool), False

    async def _brand_and_signature(
        self, actor: User, mailbox: AdminMailbox, *, own: bool
    ) -> tuple[str, Brand, Signature]:
        """The workspace's identity and who a message is signed by - the part
        every mail this method sends (an account's sign-in details, an
        administrator grant, a space's access changing) builds the same way,
        from whichever mailbox is actually sending it.

        `own` is False when `mailbox` came from the pool in `_resolve_sender`
        rather than belonging to `actor`: the signature and the reply
        address must still name the administrator who actually did this, not
        whichever mailbox happened to relay it - a pool mailbox's own
        display name is someone else's, and would put the wrong person's
        name on a message `actor` sent.
        """
        effective = await SiteSettingsService(self.session).get_effective()
        site_name = effective.site_name
        brand = Brand.from_settings(
            site_name,
            getattr(effective, "theme_color", None),
            custom_logo_url=getattr(effective, "custom_logo_url", None),
        )
        signature = Signature(
            name=(mailbox.display_name or actor.full_name or actor.username)
            if own
            else (actor.full_name or actor.username),
            title=f"Administrator, {site_name}",
            email=mailbox.email if own else actor.email,
            url=public_link(""),
        )
        return site_name, brand, signature

    async def _deliver(
        self,
        mailbox: AdminMailbox,
        *,
        subject: str,
        text: str,
        html: str,
        to: str,
        reply_to: str | None = None,
    ) -> AccountEmailResult:
        try:
            config = self._config(mailbox)
        except CredentialUnreadableError:
            outcome = self._unreadable()
        else:
            outcome = await smtp.send(
                config,
                subject=subject,
                body=text,
                html=html,
                to=to,
                reply_to=reply_to,
                timeout_seconds=settings.mail_send_timeout_seconds,
            )
        # A send is as good a health check as the hourly one.
        self._apply(mailbox, outcome)
        return AccountEmailResult(
            email_sent=outcome.ok, email_error=None if outcome.ok else outcome.error
        )

    async def send_account_email(
        self, actor: User, *, to_user: User, password: str, created: bool, login_url: str | None
    ) -> AccountEmailResult:
        """Email someone the sign-in details for an account an administrator
        just created, or a password they just reset, by hand in Users - not
        from a request in the Inbox, so there is no `AdminRequest` behind this
        one. Sent from the acting administrator's own mailbox where they have
        a working one, and from the pool otherwise - see `_resolve_sender`."""
        mailbox, own = await self._resolve_sender(actor)
        site_name, brand, signature = await self._brand_and_signature(actor, mailbox, own=own)
        text, html = email_templates.account_details(
            brand,
            created=created,
            name=to_user.full_name or to_user.username,
            username=to_user.username,
            password=password,
            login_url=login_url or public_link("/login"),
            signature=signature,
        )
        subject_line = (
            "Your account has been created" if created else "Your password has been reset"
        )
        result = await self._deliver(
            mailbox,
            subject=f"[{site_name}] {subject_line}",
            text=text,
            html=html,
            to=to_user.email,
            reply_to=None if own else actor.email,
        )
        logger.info(
            "account_email_sent",
            created=created,
            username=to_user.username,
            emailed=result.email_sent,
            via_pool=not own,
        )
        return result

    async def send_admin_granted_email(
        self, actor: User, *, to_user: User, login_url: str | None
    ) -> AccountEmailResult:
        """Email someone that their account was just made a WikiHub
        administrator, by hand in Users. Same sender rule as every other mail
        this feature sends - see `_resolve_sender`."""
        mailbox, own = await self._resolve_sender(actor)
        site_name, brand, signature = await self._brand_and_signature(actor, mailbox, own=own)
        text, html = email_templates.admin_granted(
            brand,
            name=to_user.full_name or to_user.username,
            username=to_user.username,
            login_url=login_url or public_link("/login"),
            signature=signature,
        )
        result = await self._deliver(
            mailbox,
            subject=f"[{site_name}] You're now an administrator",
            text=text,
            html=html,
            to=to_user.email,
            reply_to=None if own else actor.email,
        )
        logger.info(
            "admin_granted_email_sent",
            username=to_user.username,
            emailed=result.email_sent,
            via_pool=not own,
        )
        return result

    async def send_issue_created_email(
        self,
        *,
        reporter: User,
        issue_id: uuid.UUID,
        issue_title: str,
        description: str,
        recipients: list[User],
    ) -> int:
        """Email everyone who manages issues that one was just reported.

        The reporter is an ordinary user with no mailbox of their own, so this
        sends from any administrator mailbox that is connected right now - and
        is signed as the workspace, not as a person. Returns how many were
        sent; zero when nobody has an email address or no mailbox works, which
        is not an error: the bell still told them.
        """
        targets = [
            user
            for user in recipients
            if is_deliverable_address(user.email) and user.id != reporter.id
        ]
        if not targets:
            return 0
        pool = await self.repo.working_mailboxes()
        if not pool:
            logger.info("issue_created_email_skipped", reason="no_working_mailbox")
            return 0
        mailbox = secrets.choice(pool)
        effective = await SiteSettingsService(self.session).get_effective()
        brand = Brand.from_settings(
            effective.site_name,
            getattr(effective, "theme_color", None),
            custom_logo_url=getattr(effective, "custom_logo_url", None),
        )
        reporter_name = " ".join((reporter.full_name or reporter.username).split())

        async def send(user: User) -> bool:
            text, html = email_templates.issue_created(
                brand,
                name=user.full_name or user.username,
                username=user.username,
                reporter=reporter_name,
                issue_title=issue_title,
                description=description,
                issue_url=public_link(f"/admin/issues?issue={issue_id}"),
            )
            result = await self._deliver(
                mailbox,
                subject=f"[{effective.site_name}] New issue: {issue_title}",
                text=text,
                html=html,
                to=user.email,
                reply_to=reporter.email,
            )
            return result.email_sent

        outcomes = await asyncio.gather(*(send(user) for user in targets), return_exceptions=True)
        sent = sum(1 for outcome in outcomes if outcome is True)
        logger.info("issue_created_email_sent", recipients=len(targets), sent=sent)
        return sent

    async def send_issue_closed_email(
        self,
        actor: User,
        *,
        to_user: User,
        issue_title: str,
        taken_by: str | None,
        note: str | None,
    ) -> AccountEmailResult:
        """Email the person who reported an issue that it has been closed - by
        whoever closed it (``actor``), from their mailbox where they have one
        and from the pool otherwise. Same sender rule as every other mail here
        - see `_resolve_sender`."""
        mailbox, own = await self._resolve_sender(actor)
        site_name, brand, signature = await self._brand_and_signature(actor, mailbox, own=own)
        closed_by = " ".join((actor.full_name or actor.username).split())
        text, html = email_templates.issue_closed(
            brand,
            name=to_user.full_name or to_user.username,
            username=to_user.username,
            issue_title=issue_title,
            closed_by=closed_by,
            taken_by=taken_by,
            note=note,
            issues_url=public_link("/issues"),
            signature=signature,
        )
        result = await self._deliver(
            mailbox,
            subject=f"[{site_name}] Your issue was closed: {issue_title}",
            text=text,
            html=html,
            to=to_user.email,
            reply_to=None if own else actor.email,
        )
        logger.info(
            "issue_closed_email_sent",
            username=to_user.username,
            emailed=result.email_sent,
            via_pool=not own,
        )
        return result

    async def send_space_access_email(
        self,
        actor: User,
        *,
        to_user: User,
        space_name: str,
        added: bool,
        login_url: str | None,
    ) -> AccountEmailResult:
        """Email someone that they were added to, or removed from, a space -
        from the access matrix in a space's Access tab, not the Inbox."""
        mailbox, own = await self._resolve_sender(actor)
        site_name, brand, signature = await self._brand_and_signature(actor, mailbox, own=own)
        text, html = email_templates.space_access_changed(
            brand,
            name=to_user.full_name or to_user.username,
            username=to_user.username,
            space_name=space_name,
            added=added,
            login_url=login_url or public_link("/login"),
            signature=signature,
        )
        subject_line = (
            f'You were added to "{space_name}"'
            if added
            else f'You were removed from "{space_name}"'
        )
        result = await self._deliver(
            mailbox,
            subject=f"[{site_name}] {subject_line}",
            text=text,
            html=html,
            reply_to=None if own else actor.email,
            to=to_user.email,
        )
        logger.info(
            "space_access_email_sent",
            username=to_user.username,
            space=space_name,
            added=added,
            emailed=result.email_sent,
            via_pool=not own,
        )
        return result

    async def _pool_has_candidate(self, user: User) -> bool:
        """Whether `_resolve_sender` would find someone else's mailbox to
        relay through for `user` - see its own docstring for the pool rule
        this mirrors."""
        return any(box.user_id != user.id for box in await self.repo.working_mailboxes())

    async def summary(self, user: User) -> MailSummary:
        has_inbox = user.is_active and await PermissionService(self.session).is_system_admin(user)
        inbox_fields: dict[str, object] = {"has_inbox": has_inbox}
        if has_inbox:
            # So the sidebar/bell count is right before the page is opened.
            await self._backfill_inbox(user)
            inbox_fields["unread_count"] = await self.repo.unread_count(user.id)
            inbox_fields["latest_request_at"] = await self.repo.latest_request_at(user.id)
        found = await self.repo.get_mailbox_for_user(user.id)
        if found is None or not user.is_active:
            return MailSummary(
                has_mailbox=False,
                can_send_account_mail=user.is_active and await self._pool_has_candidate(user),
                **inbox_fields,
            )
        mailbox = found[0]
        # A connected mailbox can send account mail whether or not it also
        # receives requests - see `_require_sendable_mailbox`. `has_mailbox`
        # itself stays tied to "Receive requests": it gates the Inbox and bell,
        # which a mailbox that opted out of requests has nothing to show in.
        receives = mailbox.is_enabled
        # `_resolve_sender` accepts this mailbox outright, whatever its
        # health - but the summary only promises "will actually work" when
        # it is genuinely connected, falling back to "some pool mailbox will
        # do it instead" otherwise, so the frontend notice never claims a
        # broken mailbox of the account's own will be the one sending.
        own_ok = mailbox.health_status == "ok"
        return MailSummary(
            has_mailbox=receives,
            mailbox_id=mailbox.id if receives else None,
            mailbox_email=mailbox.email,
            health_status=mailbox.health_status,
            health_error=mailbox.health_error,
            can_send_account_mail=own_ok or await self._pool_has_candidate(user),
            **inbox_fields,
        )

    @staticmethod
    def _item(
        recipient: AdminRequestRecipient,
        request: AdminRequest,
        delivery: AdminRequestRecipient | None = None,
    ) -> InboxItem:
        # Whether it was emailed is a fact about the request, not about this
        # administrator - most have no mailbox and their own row says "none".
        shown = delivery if recipient.delivery_status == DeliveryStatus.none.value else None
        source = shown or recipient
        return InboxItem(
            id=request.id,
            kind=request.kind,
            requester_name=request.requester_name,
            requester_email=request.requester_email,
            requester_username=request.requester_username,
            message=request.message,
            created_at=request.created_at,
            read_at=recipient.read_at,
            resolved_at=request.resolved_at,
            delivery_status=source.delivery_status,
            delivery_error=source.delivery_error,
            mailbox_email=source.mailbox_email,
        )

    async def inbox_counts(self, user: User, *, kind: str | None = None) -> InboxCounts:
        await self._require_inbox(user)
        return InboxCounts(**await self.repo.inbox_counts(user.id, kind=kind))

    async def list_inbox(
        self,
        user: User,
        *,
        status: InboxStatus,
        limit: int,
        offset: int,
        kind: str | None = None,
    ) -> Page[InboxItem]:
        await self._require_inbox(user)
        rows, total = await self.repo.list_inbox(
            user.id, status=status, limit=limit, offset=offset, kind=kind
        )
        overview = await self._delivery_overview([request.id for _, request in rows])
        return Page.of(
            [
                self._item(recipient, request, overview.get(request.id))
                for recipient, request in rows
            ],
            total,
            limit=limit,
            offset=offset,
        )

    async def get_inbox_item(self, user: User, request_id: uuid.UUID) -> InboxItem:
        await self._require_inbox(user)
        row = await self.repo.get_inbox_item(user.id, request_id)
        if row is None:
            raise NotFoundError("Request not found.", code="request_not_found")
        return await self.item_with_delivery(*row)

    async def item_with_delivery(
        self, recipient: AdminRequestRecipient, request: AdminRequest
    ) -> InboxItem:
        overview = await self._delivery_overview([request.id])
        return self._item(recipient, request, overview.get(request.id))

    async def update_inbox_item(
        self, user: User, request_id: uuid.UUID, payload: InboxUpdate
    ) -> InboxItem:
        await self._require_inbox(user)
        row = await self.repo.get_inbox_item(user.id, request_id)
        if row is None:
            raise NotFoundError("Request not found.", code="request_not_found")
        recipient, request = row
        now = _now()
        was_unread = recipient.read_at is None
        if payload.read is not None:
            recipient.read_at = now if payload.read else None
        if payload.resolved is True and request.resolved_at is None:
            request.resolved_at = now
            request.resolved_by_id = user.id
            # Handling a request implies having read it.
            recipient.read_at = recipient.read_at or now
        elif payload.resolved is False:
            request.resolved_at = None
            request.resolved_by_id = None
        # Reading (or resolving) it here is exactly the "new request" bell
        # notification being acted on, so that clears too - whichever one the
        # administrator actually opened it from.
        if was_unread and recipient.read_at is not None:
            await self._clear_request_notification(user.id, request.id)
        if payload.resolved is True:
            # Handled by someone: nobody else needs nudging about it.
            await self.clear_request_notifications_for_everyone(request.id)
        await self.session.flush()
        return await self.item_with_delivery(recipient, request)

    async def mark_all_read(self, user: User) -> None:
        await self._require_inbox(user)
        await self.repo.mark_all_read(user.id, _now())
        # Every admin-request notification this account had is now stale too -
        # otherwise the bell would keep counting requests the Inbox no longer
        # shows as unread.
        await self.session.execute(
            sa_update(Notification)
            .where(
                Notification.user_id == user.id,
                Notification.kind == "admin_request",
                Notification.read_at.is_(None),
            )
            .values(read_at=_now())
        )

    async def clear_request_notifications_for_everyone(self, request_id: uuid.UUID) -> None:
        await self.session.execute(
            sa_update(Notification)
            .where(
                Notification.kind == "admin_request",
                Notification.link == f"/admin/inbox?request={request_id}",
                Notification.read_at.is_(None),
            )
            .values(read_at=_now())
        )

    async def _clear_request_notification(self, user_id: uuid.UUID, request_id: uuid.UUID) -> None:
        await self.session.execute(
            sa_update(Notification)
            .where(
                Notification.user_id == user_id,
                Notification.kind == "admin_request",
                Notification.link == f"/admin/inbox?request={request_id}",
                Notification.read_at.is_(None),
            )
            .values(read_at=_now())
        )
