"""Authentication endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Request, Response, status

from app.api.deps import (
    ACCESS_COOKIE_NAME,
    ActingAuthServiceDep,
    AuthServiceDep,
    CurrentUser,
    DbSession,
    Impersonator,
)
from app.core import rate_limit
from app.core.config import settings
from app.core.security import create_access_token
from app.services.site_settings import SiteSettingsService
from app.schemas.user import (
    ImpersonateRequest,
    LoginRequest,
    LoginResponse,
    MeRead,
    UserRead,
)

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
    _set_access_cookie(response, token, max_age=ttl_seconds)

    return LoginResponse(
        access_token=token,
        expires_at=expires_at,
        user=UserRead.model_validate(user),
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
    response: Response, user: CurrentUser, impersonator: Impersonator, session: DbSession
) -> None:
    effective_settings = await SiteSettingsService(session).get_effective()
    ttl_seconds = effective_settings.session_ttl_hours * 3600
    token, _expires_at = create_access_token(
        str(user.id),
        impersonator=str(impersonator.id) if impersonator else None,
        expires_in=ttl_seconds,
    )
    _set_access_cookie(response, token, max_age=ttl_seconds)


@router.get("/me", response_model=MeRead, summary="The authenticated user")
async def me(user: CurrentUser, impersonator: Impersonator) -> MeRead:
    return MeRead(
        **UserRead.model_validate(user).model_dump(),
        impersonator=UserRead.model_validate(impersonator) if impersonator else None,
    )


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
    service: ActingAuthServiceDep,
    session: DbSession,
) -> LoginResponse:
    admin = await service.end_impersonation()
    effective_settings = await SiteSettingsService(session).get_effective()
    ttl_seconds = effective_settings.session_ttl_hours * 3600
    token, expires_at = create_access_token(str(admin.id), expires_in=ttl_seconds)
    _set_access_cookie(response, token, max_age=ttl_seconds)

    return LoginResponse(
        access_token=token,
        expires_at=expires_at,
        user=UserRead.model_validate(admin),
    )
