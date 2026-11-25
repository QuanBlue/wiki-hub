"""Authentication endpoints."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Request, Response, status

from app.api.deps import (
    ACCESS_COOKIE_NAME,
    ActingAuthServiceDep,
    AuthServiceDep,
    ClientInfoDep,
    CurrentUser,
    DbSession,
    Impersonator,
    OptionalUser,
)
from app.core import rate_limit
from app.core.config import settings
from app.core.exceptions import AuthenticationError
from app.core.security import (
    TOKEN_TYPE_2FA_CHALLENGE,
    TOKEN_TYPE_2FA_SETUP,
    create_2fa_token,
    create_access_token,
    decode_2fa_token,
    decode_token_identity,
)
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.auth.sessions import SessionService
from app.modules.auth.totp import is_2fa_enforced_for
from app.modules.permissions.service import PermissionService
from app.schemas.user import (
    ImpersonateRequest,
    LoginRequest,
    LoginResponse,
    MeRead,
    SessionRead,
    TwoFactorConfirmRequest,
    TwoFactorConfirmResponse,
    TwoFactorDisableRequest,
    TwoFactorRecoveryCodesResponse,
    TwoFactorRegenerateCodesRequest,
    TwoFactorSetupRequest,
    TwoFactorSetupResponse,
    TwoFactorStatusRead,
    TwoFactorVerifyRequest,
    UserRead,
)
from app.services.audit import ClientInfo
from app.services.site_settings import SiteSettingsService

router = APIRouter(prefix="/auth", tags=["auth"])

_TWO_FACTOR_CHALLENGE_TTL_SECONDS = 300
_TWO_FACTOR_SETUP_TTL_SECONDS = 600


def _set_access_cookie(response: Response, token: str, max_age: int) -> None:
    response.set_cookie(
        key=ACCESS_COOKIE_NAME,
        value=token,
        max_age=max_age,
        httponly=True,  # unreadable from JavaScript, so XSS cannot exfiltrate it
        secure=settings.secure_cookies,  # must be True behind HTTPS in production
        samesite="lax",  # blocks the cookie on cross-site POSTs (CSRF defence)
        path="/",
    )


async def _issue_login_session(
    *,
    user: User,
    response: Response,
    session: DbSession,
    client: ClientInfo,
) -> tuple[str, datetime, UserRead]:
    effective_settings = await SiteSettingsService(session).get_effective()
    ttl_seconds = effective_settings.session_ttl_hours * 3600
    token, expires_at = create_access_token(str(user.id), expires_in=ttl_seconds)
    await SessionService(session).create(
        user_id=user.id,
        token_jti=decode_token_identity(token).jti,
        expires_at=expires_at,
        client=client,
    )
    _set_access_cookie(response, token, max_age=ttl_seconds)

    # `UserRead.model_validate(user)` alone leaves `global_permissions` at its
    # empty default - the ORM `User` has no such attribute, only
    # `PermissionService.global_permissions` can compute it.
    global_permissions = await PermissionService(session).global_permissions(user)
    user_read = UserRead.model_validate(user).model_copy(
        update={"global_permissions": global_permissions}
    )
    return token, expires_at, user_read


async def _resolve_2fa_setup_user(
    *,
    challenge_token: str | None,
    optional_user: User | None,
    service: AuthService,
) -> tuple[User, bool]:
    """Return ``(user, via_challenge)`` for 2FA setup/confirm endpoints."""
    if challenge_token:
        user_id = decode_2fa_token(challenge_token, expected_type=TOKEN_TYPE_2FA_SETUP)
        return await service.get_active_user(user_id), True
    if optional_user is not None:
        return optional_user, False
    raise AuthenticationError("Authentication is required.")


@router.post(
    "/login",
    response_model=LoginResponse,
    summary="Exchange credentials for an access token",
)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    service: AuthServiceDep,
    session: DbSession,
    client: ClientInfoDep,
) -> LoginResponse:
    # Throttle per client address *and* per submitted identifier, so one
    # attacker cannot spray many accounts from one host, nor many hosts at one
    # account.
    client_ip = request.client.host if request.client else "unknown"
    await rate_limit.enforce(f"login:ip:{client_ip}", settings.login_rate_limit)
    await rate_limit.enforce(
        f"login:user:{payload.username.strip().lower()}", settings.login_rate_limit
    )

    user = await service.authenticate(
        payload.username, payload.password, accept_privacy=payload.accept_privacy
    )
    if getattr(user, "totp_enabled", False):
        challenge_token, _ = create_2fa_token(
            str(user.id),
            token_type=TOKEN_TYPE_2FA_CHALLENGE,
            expires_in=_TWO_FACTOR_CHALLENGE_TTL_SECONDS,
        )
        return LoginResponse(
            requires_2fa=True,
            requires_2fa_setup=False,
            challenge_token=challenge_token,
        )

    effective_settings = await SiteSettingsService(session).get_effective()
    require_2fa_mode = getattr(effective_settings, "require_2fa_mode", "off")
    if require_2fa_mode != "off":
        is_admin = await PermissionService(session).is_system_admin(user)
        if is_2fa_enforced_for(user, require_2fa_mode, is_admin=is_admin):
            challenge_token, _ = create_2fa_token(
                str(user.id),
                token_type=TOKEN_TYPE_2FA_SETUP,
                expires_in=_TWO_FACTOR_SETUP_TTL_SECONDS,
            )
            return LoginResponse(
                requires_2fa=True,
                requires_2fa_setup=True,
                challenge_token=challenge_token,
            )

    token, expires_at, user_read = await _issue_login_session(
        user=user, response=response, session=session, client=client
    )
    return LoginResponse(
        access_token=token,
        expires_at=expires_at,
        user=user_read,
    )


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Clear the session cookie",
)
async def logout(response: Response) -> None:
    # Unconditional: logging out must succeed even with an expired token.
    response.delete_cookie(
        key=ACCESS_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
    )


@router.post(
    "/renew",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Renew the current browser session",
)
async def renew(
    response: Response,
    user: CurrentUser,
    impersonator: Impersonator,
    session: DbSession,
    request: Request,
    client: ClientInfoDep,
) -> None:
    effective_settings = await SiteSettingsService(session).get_effective()
    ttl_seconds = effective_settings.session_ttl_hours * 3600
    # Deliberately does *not* revoke the token that authenticated this
    # request. A page keeping a session alive across a many-hour operation
    # (e.g. uploading a multi-gigabyte Confluence archive) fires plenty of
    # other authenticated requests around the same time as each periodic
    # renewal. Revoking the old jti in the same breath as minting the new one
    # used to race those requests: one already in flight with the
    # about-to-be-superseded cookie could land after the revoke and before
    # the browser applied the new Set-Cookie, get a spurious 401, and the UI
    # would read that as "the session expired" - even though the session was
    # in fact still alive, just mid-rotation. Leaving the old jti valid until
    # its own already-recorded `expires_at` closes that race: both cookies
    # work through the handoff, and the old row still disappears on its own
    # schedule exactly as it always would have without a renewal.
    token, expires_at = create_access_token(
        str(user.id),
        impersonator=str(impersonator.id) if impersonator else None,
        expires_in=ttl_seconds,
    )
    await SessionService(session).create(
        user_id=user.id,
        token_jti=decode_token_identity(token).jti,
        expires_at=expires_at,
        client=client,
    )
    _set_access_cookie(response, token, max_age=ttl_seconds)


@router.get("/me", response_model=MeRead, summary="The authenticated user")
async def me(user: CurrentUser, impersonator: Impersonator, session: DbSession) -> MeRead:
    global_permissions = await PermissionService(session).global_permissions(user)
    return MeRead(
        **UserRead.model_validate(user)
        .model_copy(update={"global_permissions": global_permissions})
        .model_dump(),
        impersonator=UserRead.model_validate(impersonator) if impersonator else None,
    )


@router.get("/sessions", response_model=list[SessionRead], summary="List active browser sessions")
async def list_sessions(
    request: Request, user: CurrentUser, session: DbSession
) -> list[SessionRead]:
    identity = decode_token_identity(request.cookies.get(ACCESS_COOKIE_NAME, ""))
    rows = await SessionService(session).list_for_user(user.id, identity.jti)
    return [
        SessionRead(
            id=row.id,
            created_at=row.created_at,
            last_seen_at=row.last_seen_at,
            expires_at=row.expires_at,
            ip_address=row.ip_address,
            user_agent=row.user_agent,
            is_current=row.token_jti == identity.jti,
            is_admin_session=row.impersonator_id is not None,
        )
        for row in rows
    ]


@router.post(
    "/sessions/revoke-others",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Sign out all other browser sessions",
)
async def revoke_other_sessions(request: Request, user: CurrentUser, session: DbSession) -> None:
    identity = decode_token_identity(request.cookies.get(ACCESS_COOKIE_NAME, ""))
    await SessionService(session).revoke_others(user_id=user.id, current_jti=identity.jti)


@router.post(
    "/impersonate",
    response_model=LoginResponse,
    summary="Start acting as another user",
)
async def start_impersonation(
    payload: ImpersonateRequest,
    response: Response,
    service: ActingAuthServiceDep,
    session: DbSession,
    client: ClientInfoDep,
) -> LoginResponse:
    """Swap the session cookie for one that speaks as another account.

    The administrator's own identity is not stored anywhere server-side; it
    rides along in the token's ``act`` claim, so ending impersonation needs no
    lookup table and a stolen token still expires on the normal schedule.

    Note this is a *sideways* move, never an upgrade: the endpoint requires
    administrator rights, which are already the highest in the instance.
    """
    target = await service.begin_impersonation(payload.user_id)

    # begin_impersonation refuses an actor-less service, so by here there is one.
    actor = service.actor
    assert actor is not None
    effective_settings = await SiteSettingsService(session).get_effective()
    ttl_seconds = effective_settings.session_ttl_hours * 3600
    token, expires_at = create_access_token(
        str(target.id), impersonator=str(actor.id), expires_in=ttl_seconds
    )
    await SessionService(session).create(
        user_id=target.id,
        token_jti=decode_token_identity(token).jti,
        expires_at=expires_at,
        client=client,
        impersonator_id=actor.id,
    )
    _set_access_cookie(response, token, max_age=ttl_seconds)

    return LoginResponse(
        access_token=token,
        expires_at=expires_at,
        user=UserRead.model_validate(target),
    )


@router.delete(
    "/impersonate",
    response_model=LoginResponse,
    summary="Return to your own account",
)
async def stop_impersonation(
    response: Response,
    request: Request,
    service: ActingAuthServiceDep,
    session: DbSession,
    client: ClientInfoDep,
) -> LoginResponse:
    admin = await service.end_impersonation()
    identity = decode_token_identity(request.cookies.get(ACCESS_COOKIE_NAME, ""))
    if service.actor is not None:
        await SessionService(session).revoke(
            user_id=service.actor.id,
            token_jti=identity.jti,
        )
    effective_settings = await SiteSettingsService(session).get_effective()
    ttl_seconds = effective_settings.session_ttl_hours * 3600
    token, expires_at = create_access_token(str(admin.id), expires_in=ttl_seconds)
    await SessionService(session).create(
        user_id=admin.id,
        token_jti=decode_token_identity(token).jti,
        expires_at=expires_at,
        client=client,
    )
    _set_access_cookie(response, token, max_age=ttl_seconds)

    return LoginResponse(
        access_token=token,
        expires_at=expires_at,
        user=UserRead.model_validate(admin),
    )


@router.get(
    "/2fa/status",
    response_model=TwoFactorStatusRead,
    summary="Read the current user's two-factor authentication status",
)
async def get_2fa_status(user: CurrentUser, session: DbSession) -> TwoFactorStatusRead:
    effective_settings = await SiteSettingsService(session).get_effective()
    is_admin = await PermissionService(session).is_system_admin(user)
    return TwoFactorStatusRead(
        enabled=bool(user.totp_enabled),
        enabled_at=user.totp_enabled_at,
        recovery_codes_remaining=len(user.totp_recovery_codes or []),
        enforced=is_2fa_enforced_for(
            user, effective_settings.require_2fa_mode, is_admin=is_admin
        ),
    )


@router.post(
    "/2fa/setup",
    response_model=TwoFactorSetupResponse,
    summary="Start two-factor authentication setup",
)
async def setup_2fa(
    service: AuthServiceDep,
    session: DbSession,
    optional_user: OptionalUser,
    payload: TwoFactorSetupRequest | None = None,
) -> TwoFactorSetupResponse:
    challenge_token = payload.challenge_token if payload is not None else None
    target_user, _ = await _resolve_2fa_setup_user(
        challenge_token=challenge_token,
        optional_user=optional_user,
        service=service,
    )
    effective_settings = await SiteSettingsService(session).get_effective()
    secret, otpauth_uri = await service.begin_2fa_setup(
        target_user, issuer=effective_settings.site_name
    )
    return TwoFactorSetupResponse(secret=secret, otpauth_uri=otpauth_uri)


@router.post(
    "/2fa/reconfigure",
    response_model=TwoFactorSetupResponse,
    summary="Verify current credentials and generate a new two-factor QR secret",
)
async def reconfigure_2fa(
    payload: TwoFactorDisableRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
    service: ActingAuthServiceDep,
) -> TwoFactorSetupResponse:
    client_ip = request.client.host if request.client else "unknown"
    await rate_limit.enforce(f"2fa:reconfigure:ip:{client_ip}", settings.login_rate_limit)
    await rate_limit.enforce(f"2fa:reconfigure:user:{user.id}", settings.login_rate_limit)
    effective_settings = await SiteSettingsService(session).get_effective()
    secret, otpauth_uri = await service.begin_2fa_reconfigure(
        user,
        password=payload.password,
        code=payload.code,
        issuer=effective_settings.site_name,
    )
    return TwoFactorSetupResponse(secret=secret, otpauth_uri=otpauth_uri)


@router.post(
    "/2fa/confirm",
    response_model=TwoFactorConfirmResponse,
    summary="Confirm two-factor authentication setup",
)
async def confirm_2fa(
    payload: TwoFactorConfirmRequest,
    request: Request,
    response: Response,
    service: AuthServiceDep,
    session: DbSession,
    client: ClientInfoDep,
    optional_user: OptionalUser,
    impersonator: Impersonator,
) -> TwoFactorConfirmResponse:
    client_ip = request.client.host if request.client else "unknown"
    await rate_limit.enforce(f"2fa:confirm:ip:{client_ip}", settings.login_rate_limit)
    target_user, via_challenge = await _resolve_2fa_setup_user(
        challenge_token=payload.challenge_token,
        optional_user=optional_user,
        service=service,
    )
    await rate_limit.enforce(f"2fa:confirm:user:{target_user.id}", settings.login_rate_limit)
    acting_service = AuthService(
        session,
        actor=target_user,
        client=client,
        impersonator=None if via_challenge else impersonator,
    )
    recovery_codes = await acting_service.confirm_2fa_setup(target_user, payload.code)
    if via_challenge:
        token, expires_at, user_read = await _issue_login_session(
            user=target_user, response=response, session=session, client=client
        )
        return TwoFactorConfirmResponse(
            enabled=True,
            recovery_codes=recovery_codes,
            access_token=token,
            expires_at=expires_at,
            user=user_read,
        )
    return TwoFactorConfirmResponse(enabled=True, recovery_codes=recovery_codes)


@router.post(
    "/2fa/verify",
    response_model=LoginResponse,
    summary="Complete login with a TOTP or recovery code",
)
async def verify_2fa(
    payload: TwoFactorVerifyRequest,
    request: Request,
    response: Response,
    service: AuthServiceDep,
    session: DbSession,
    client: ClientInfoDep,
) -> LoginResponse:
    client_ip = request.client.host if request.client else "unknown"
    await rate_limit.enforce(f"2fa:ip:{client_ip}", settings.login_rate_limit)
    user_id = decode_2fa_token(payload.challenge_token, expected_type=TOKEN_TYPE_2FA_CHALLENGE)
    await rate_limit.enforce(f"2fa:user:{user_id}", settings.login_rate_limit)

    user = await service.get_active_user(user_id)
    acting_service = AuthService(session, actor=user, client=client)
    await acting_service.verify_2fa_login(user, payload.code)
    token, expires_at, user_read = await _issue_login_session(
        user=user, response=response, session=session, client=client
    )
    return LoginResponse(
        access_token=token,
        expires_at=expires_at,
        user=user_read,
    )


@router.post(
    "/2fa/disable",
    response_model=TwoFactorStatusRead,
    summary="Disable two-factor authentication for the current user",
)
async def disable_2fa(
    payload: TwoFactorDisableRequest,
    user: CurrentUser,
    session: DbSession,
    service: ActingAuthServiceDep,
) -> TwoFactorStatusRead:
    effective_settings = await SiteSettingsService(session).get_effective()
    is_admin = await PermissionService(session).is_system_admin(user)
    enforced = is_2fa_enforced_for(
        user, effective_settings.require_2fa_mode, is_admin=is_admin
    )
    await service.disable_2fa(
        user,
        password=payload.password,
        code=payload.code,
        enforced=enforced,
    )
    return TwoFactorStatusRead(
        enabled=False,
        enabled_at=None,
        recovery_codes_remaining=0,
        enforced=False,
    )


@router.post(
    "/2fa/recovery-codes/regenerate",
    response_model=TwoFactorRecoveryCodesResponse,
    summary="Regenerate one-time recovery codes",
)
async def regenerate_2fa_recovery_codes(
    payload: TwoFactorRegenerateCodesRequest,
    user: CurrentUser,
    service: ActingAuthServiceDep,
) -> TwoFactorRecoveryCodesResponse:
    recovery_codes = await service.regenerate_recovery_codes(
        user, password=payload.password, code=payload.code
    )
    return TwoFactorRecoveryCodesResponse(recovery_codes=recovery_codes)
