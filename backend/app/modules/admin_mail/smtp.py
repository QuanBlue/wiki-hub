"""Talking to an administrator's SMTP server.

Two operations, both returning an :class:`SmtpOutcome` instead of raising: the
callers (a request being delivered, the hourly healthcheck) need to *record*
what went wrong per mailbox and carry on with the others, not unwind.

The outcome's ``health`` is the point. A rejected login means the password has
expired or been changed at the provider - the thing an administrator can fix -
so it is kept apart from "could not connect", which is not theirs to fix.

Nothing here touches the database, so many of these can run concurrently.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr

import aiosmtplib

from app.core.logging import get_logger
from app.models.admin_mail import MailHealth, SmtpSecurity
from app.services.job_logs import concise_error

logger = get_logger(__name__)


@dataclass(frozen=True)
class SmtpConfig:
    host: str
    port: int
    security: str
    username: str
    password: str
    email: str
    display_name: str | None = None


@dataclass(frozen=True)
class SmtpOutcome:
    ok: bool
    health: MailHealth
    error: str | None = None

    @classmethod
    def success(cls) -> SmtpOutcome:
        return cls(ok=True, health=MailHealth.ok)


def _client(config: SmtpConfig, timeout_seconds: float) -> aiosmtplib.SMTP:
    return aiosmtplib.SMTP(
        hostname=config.host,
        port=config.port,
        timeout=timeout_seconds,
        use_tls=config.security == SmtpSecurity.ssl,
        # STARTTLS is *required* when chosen, never opportunistic: a server that
        # stops offering it must fail the connection, not silently send the
        # password in the clear.
        start_tls=config.security == SmtpSecurity.starttls,
    )


def classify(exc: BaseException) -> SmtpOutcome:
    """Map an exception onto what the administrator should do about it."""
    message = concise_error(exc) or type(exc).__name__
    if isinstance(exc, aiosmtplib.SMTPAuthenticationError):
        return SmtpOutcome(ok=False, health=MailHealth.auth_failed, error=message)
    if isinstance(
        exc,
        (
            aiosmtplib.SMTPConnectError,
            aiosmtplib.SMTPConnectTimeoutError,
            aiosmtplib.SMTPTimeoutError,
            aiosmtplib.SMTPServerDisconnected,
            TimeoutError,
            OSError,
        ),
    ):
        return SmtpOutcome(ok=False, health=MailHealth.unreachable, error=message)
    return SmtpOutcome(ok=False, health=MailHealth.error, error=message)


async def verify(config: SmtpConfig, *, timeout_seconds: float) -> SmtpOutcome:
    """Connect and authenticate, without sending anything."""
    try:
        async with _client(config, timeout_seconds) as client:
            if config.username:
                await client.login(config.username, config.password)
            await client.noop()
    except Exception as exc:  # noqa: BLE001 - every failure is classified and recorded
        logger.info("admin_mail_verify_failed", host=config.host, error=str(exc)[:200])
        return classify(exc)
    return SmtpOutcome.success()


def build_message(
    config: SmtpConfig,
    *,
    subject: str,
    body: str,
    reply_to: str | None = None,
    to: str | None = None,
    html: str | None = None,
) -> EmailMessage:
    """A message from the mailbox - to itself unless ``to`` is given.

    Plain text always; with ``html`` it becomes a multipart message so a mail
    client shows the styled version and falls back to the text when it cannot.

    Header values are stripped of line breaks first: the standard library
    refuses them, but failing the send over a stray newline in a name someone
    typed into a public form would be the wrong outcome.
    """
    message = EmailMessage()
    message["From"] = formataddr((_header(config.display_name or "WikiHub"), config.email))
    message["To"] = _header(to) if to else config.email
    message["Subject"] = _header(subject)
    if reply_to:
        message["Reply-To"] = _header(reply_to)
    message.set_content(body)
    if html:
        message.add_alternative(html, subtype="html")
    return message


def _header(value: str) -> str:
    return " ".join(value.split())


async def send(
    config: SmtpConfig,
    *,
    subject: str,
    body: str,
    reply_to: str | None = None,
    to: str | None = None,
    html: str | None = None,
    timeout_seconds: float,
) -> SmtpOutcome:
    try:
        message = build_message(
            config, subject=subject, body=body, reply_to=reply_to, to=to, html=html
        )
        async with _client(config, timeout_seconds) as client:
            if config.username:
                await client.login(config.username, config.password)
            await client.send_message(message)
    except Exception as exc:  # noqa: BLE001 - every failure is classified and recorded
        logger.info("admin_mail_send_failed", host=config.host, error=str(exc)[:200])
        return classify(exc)
    return SmtpOutcome.success()


async def verify_all(
    configs: list[SmtpConfig], *, timeout_seconds: float, concurrency: int = 5
) -> list[SmtpOutcome]:
    """Verify several mailboxes at once, a few at a time."""
    gate = asyncio.Semaphore(concurrency)

    async def one(config: SmtpConfig) -> SmtpOutcome:
        async with gate:
            return await verify(config, timeout_seconds=timeout_seconds)

    return list(await asyncio.gather(*(one(config) for config in configs)))
