"""Authentication endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Request, Response, status

from app.api.deps import (
    ACCESS_COOKIE_NAME,
    ActingAuthServiceDep,
    AuthServiceDep,
    ClientInfoDep,
    CurrentUser,
    DbSession,
    Impersonator,
)
from app.core import rate_limit
from app.core.config import settings
from app.core.security import create_access_token, decode_token_identity
from app.modules.auth.sessions import SessionService
from app.modules.permissions.service import PermissionService
from app.schemas.user import (
    ImpersonateRequest,
    LoginRequest,
    LoginResponse,
    MeRead,
    SessionRead,
    UserRead,
)
from app.services.site_settings import SiteSettingsService

router = APIRouter(prefix="/auth", tags=["auth"])


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

    user = await service.authenticate(payload.username, payload.password)
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
    # `PermissionService.global_permissions` can compute it. Nothing in this
    # codebase currently reads it off the login response (the frontend always
    # re-fetches `/auth/me`, which does this correctly), but any other client
    # of this API would otherwise see a freshly-granted group permission as
    # absent until its next explicit `/auth/me` call - the same bug class the
    # People directory's own list endpoint had (see `_read_user` in
    # `app/api/v1/users.py`).
    global_permissions = await PermissionService(session).global_permissions(user)
    return LoginResponse(
        access_token=token,
        expires_at=expires_at,
        user=UserRead.model_validate(user).model_copy(
            update={"global_permissions": global_permissions}
        ),
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
