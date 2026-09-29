"""Request and response shapes for the administrator mail feature.

The SMTP password only ever travels *in*: no read model has a field for it.
``has_password`` is all a client can learn.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

#: A hostname or IP literal, and nothing else - no scheme, path or whitespace.
_HOST_PATTERN = r"^[A-Za-z0-9.\-:\[\]]{1,255}$"
#: Deliberately loose: `EmailStr` rejects reserved domains such as `.local`,
#: which an intranet deployment legitimately uses. This only rules out values
#: that could never be an address.
_EMAIL_PATTERN = r"^[^@\s]{1,64}@[^@\s]{1,255}$"

SmtpSecurityName = Literal["ssl", "starttls", "none"]
MailHealthName = Literal["unknown", "ok", "auth_failed", "unreachable", "error"]
RequestKindName = Literal["account", "password_reset", "other"]
DeliveryName = Literal["sent", "failed", "no_mailbox"]


class MailboxCreate(BaseModel):
    # Stripped *before* the length and pattern checks, so a value made only of
    # spaces is empty rather than long enough to pass.
    model_config = ConfigDict(str_strip_whitespace=True)

    user_id: uuid.UUID
    email: str = Field(pattern=_EMAIL_PATTERN, max_length=320)
    display_name: str | None = Field(default=None, max_length=120)
    smtp_host: str = Field(pattern=_HOST_PATTERN)
    smtp_port: int = Field(ge=1, le=65535)
    smtp_security: SmtpSecurityName = "starttls"
    #: Blank means "same as the email address", which is what most providers want.
    smtp_username: str | None = Field(default=None, max_length=320)
    smtp_password: str = Field(min_length=1, max_length=512)
    is_enabled: bool = True


class MailboxUpdate(BaseModel):
    """Partial update. ``smtp_password`` omitted keeps the stored password."""

    email: str | None = Field(default=None, pattern=_EMAIL_PATTERN, max_length=320)
    display_name: str | None = Field(default=None, max_length=120)
    smtp_host: str | None = Field(default=None, pattern=_HOST_PATTERN)
    smtp_port: int | None = Field(default=None, ge=1, le=65535)
    smtp_security: SmtpSecurityName | None = None
    smtp_username: str | None = Field(default=None, max_length=320)
    smtp_password: str | None = Field(default=None, min_length=1, max_length=512)
    is_enabled: bool | None = None


class MailboxPasswordUpdate(BaseModel):
    password: str = Field(min_length=1, max_length=512)


class MailboxRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    username: str
    user_full_name: str | None = None
    user_is_active: bool
    email: str
    display_name: str | None = None
    smtp_host: str
    smtp_port: int
    smtp_security: SmtpSecurityName
    smtp_username: str
    has_password: bool = True
    is_enabled: bool
    #: ``is_enabled`` *and* the linked account is active: what actually decides
    #: whether the mailbox receives requests.
    effective_enabled: bool
    health_status: MailHealthName
    health_checked_at: datetime | None = None
    health_error: str | None = None
    created_at: datetime


class MailboxTestResult(BaseModel):
    ok: bool
    health_status: MailHealthName
    error: str | None = None


class MailSummary(BaseModel):
    """What the shell needs on every page: whether to show the Inbox and bell,
    how many are unread, and whether the banner should nag."""

    has_mailbox: bool
    mailbox_id: uuid.UUID | None = None
    mailbox_email: str | None = None
    health_status: MailHealthName | None = None
    health_error: str | None = None
    unread_count: int = 0
    #: When the newest request arrived; changes whenever a new one lands.
    latest_request_at: datetime | None = None
    #: Whether Create user / Edit user can email this account's sign-in details
    #: automatically. Independent of `has_mailbox`: a mailbox that has "Receive
    #: requests" switched off still has no Inbox of its own (`has_mailbox` is
    #: False), but it is still a real, connected mailbox and can still send.
    can_send_account_mail: bool = False


class InboxItem(BaseModel):
    id: uuid.UUID
    kind: RequestKindName
    requester_name: str
    requester_email: str
    requester_username: str | None = None
    message: str
    created_at: datetime
    read_at: datetime | None = None
    resolved_at: datetime | None = None
    #: What happened to the email sent to *this* account's mailbox.
    delivery_status: Literal["sent", "failed"]
    delivery_error: str | None = None
    mailbox_email: str


class InboxCounts(BaseModel):
    """How many requests each Inbox tab lists."""

    all: int
    unread: int
    open: int
    resolved: int


class MatchedAccount(BaseModel):
    """The account a password-reset request appears to be about."""

    id: uuid.UUID
    username: str
    full_name: str
    email: str
    is_active: bool


AutoBlockedName = Literal[
    "not_applicable",
    "already_resolved",
    "email_in_use",
    "email_invalid",
    "email_mismatch",
    "account_inactive",
    "account_protected",
    "peer_admin",
]


class RequestActionPreview(BaseModel):
    """What the Inbox can offer for one request, so the buttons say up front what
    will happen (or why the automatic one is not available)."""

    kind: RequestKindName
    #: Account requests: the username the automatic route would use.
    suggested_username: str | None = None
    #: Account requests: the address already belongs to an account.
    email_in_use: bool = False
    #: Password resets: the account the request names, if there is one.
    matched_account: MatchedAccount | None = None
    #: Password resets: the request's address is the one on that account.
    email_matches: bool = False
    #: What the automatic button does: create the account the request asks for, or -
    #: when the address already has one - reset that account's password.
    auto_action: Literal["create_account", "reset_password"] | None = None
    auto_allowed: bool
    auto_blocked: AutoBlockedName | None = None


class AutoActionRequest(BaseModel):
    #: Where the emailed person signs in; supplied by the administrator's browser,
    #: since the server has no public address of its own.
    login_url: str | None = Field(default=None, max_length=300, pattern=r"^https?://\S+$")


class AutoActionResult(BaseModel):
    item: InboxItem
    username: str
    emailed_to: str
    email_sent: bool
    email_error: str | None = None
    #: Present only when the email could not be sent, so the administrator can
    #: pass it on another way. Shown once; never stored or returned again.
    password: str | None = None


class AccountEmailRequest(BaseModel):
    """What Users already has right after creating an account or setting its
    password by hand - sent once more so the acting administrator's own
    mailbox can tell the person, without WikiHub ever storing the plaintext
    password itself."""

    user_id: uuid.UUID
    password: str = Field(min_length=8, max_length=128)
    #: Where the emailed person signs in; supplied by the administrator's
    #: browser, since the server has no public address of its own.
    login_url: str | None = Field(default=None, max_length=300, pattern=r"^https?://\S+$")


class AccountEmailResult(BaseModel):
    email_sent: bool
    email_error: str | None = None


class AdminGrantedEmailRequest(BaseModel):
    """Sent right after `PATCH /users/{id}` makes an account an administrator,
    the same "separate request, never blocks the change" shape as
    `AccountEmailRequest`."""

    user_id: uuid.UUID
    login_url: str | None = Field(default=None, max_length=300, pattern=r"^https?://\S+$")


class SpaceAccessEmailRequest(BaseModel):
    """Sent right after the Access tab's user permission matrix gives someone
    their first permission in a space, or takes their last one away."""

    user_id: uuid.UUID
    space_key: str = Field(min_length=1, max_length=255)
    #: True: they can now see the space. False: they no longer can.
    added: bool
    login_url: str | None = Field(default=None, max_length=300, pattern=r"^https?://\S+$")


class InboxUpdate(BaseModel):
    read: bool | None = None
    resolved: bool | None = None


class ContactAdminCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    kind: RequestKindName
    requester_name: str = Field(min_length=1, max_length=120)
    requester_email: str = Field(pattern=_EMAIL_PATTERN, max_length=320)
    requester_username: str | None = Field(default=None, max_length=64)
    #: Optional: the request type, name and address already say what is needed.
    message: str = Field(default="", max_length=2000)
    #: Honeypot. Real people never see this field, so a value means a bot.
    website: str = Field(default="", max_length=200)


class ContactAdminResult(BaseModel):
    #: ``sent``: at least one administrator was emailed. ``failed``: mailboxes
    #: exist but none could be reached. ``no_mailbox``: none is set up. In the
    #: last two the request is still stored, so the client tells the requester
    #: to let an administrator know directly.
    delivery: DeliveryName
