"""Shared FastAPI dependencies: database sessions and the current user."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AuthenticationError, PermissionDeniedError
from app.core.security import decode_access_token, decode_token_identity
from app.db.session import get_session_factory
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.permissions.service import PermissionService
from app.services.audit import ClientInfo

#: Name of the httpOnly cookie holding the access token. Cookies ignore the port
#: component, so a token set by the API on :8000 is also sent to the Next.js
#: server on :3000 - which is what lets the frontend middleware gate routes.
ACCESS_COOKIE_NAME = "wikihub_access"


async def get_db() -> AsyncIterator[AsyncSession]:
    """One transaction per request: commit on success, roll back on any error."""
    async with get_session_factory()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


DbSession = Annotated[AsyncSession, Depends(get_db)]


def get_auth_service(session: DbSession) -> AuthService:
    """Actor-less service, for paths that only *verify* a token.

    Using this for a mutation would produce audit rows with no actor, so
    mutating endpoints must depend on :data:`ActingAuthServiceDep` instead.
    """
    return AuthService(session)


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]


def get_client_info(request: Request) -> ClientInfo:
    return ClientInfo(
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("User-Agent"),
    )


ClientInfoDep = Annotated[ClientInfo, Depends(get_client_info)]


def _extract_token(request: Request) -> str | None:
    """Bearer header first (API clients), then the cookie (browser)."""
    header = request.headers.get("Authorization")
    if header:
        scheme, _, value = header.partition(" ")
        if scheme.lower() == "bearer" and value.strip():
            return value.strip()
    cookie = request.cookies.get(ACCESS_COOKIE_NAME)
    return cookie.strip() if cookie else None


async def get_impersonator(request: Request, service: AuthServiceDep) -> User | None:
    """The administrator behind an impersonated session, if there is one.

    Resolved from the signed ``act`` claim, then re-checked against the
    database: an administrator who has since been deactivated stops being able
    to act, and stops being credited in the audit trail as if they could.
    """
    token = _extract_token(request)
    if not token:
        return None
    identity = decode_token_identity(token)
    if identity.impersonator is None:
        return None
    try:
        return await service.get_active_user(identity.impersonator)
    except AuthenticationError:
        # The token names an administrator who is gone or disabled. Fail the
        # whole request rather than quietly degrading to an unattributed
        # session as the impersonated user.
        raise AuthenticationError(
            "The administrator behind this session is no longer active. Please sign in again."
        ) from None


Impersonator = Annotated[User | None, Depends(get_impersonator)]


async def get_current_user(request: Request, service: AuthServiceDep) -> User:
    token = _extract_token(request)
    if not token:
        raise AuthenticationError("Authentication is required.")
    user_id = decode_access_token(token)
    return await service.get_active_user(user_id)


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_current_superuser(user: CurrentUser, session: DbSession) -> User:
    if not await PermissionService(session).is_system_admin(user):
        raise PermissionDeniedError("This action requires administrator privileges.")
    return user


CurrentSuperuser = Annotated[User, Depends(get_current_superuser)]


def get_acting_auth_service(
    session: DbSession,
    user: CurrentUser,
    client: ClientInfoDep,
    impersonator: Impersonator,
) -> AuthService:
    """Auth service bound to the caller, for every mutating endpoint.

    Binding the actor at construction rather than passing it per call is what
    makes audit coverage structural: a service method physically cannot record
    an anonymous mutation - nor an impersonated one that hides who was really
    driving it.
    """
    return AuthService(session, actor=user, client=client, impersonator=impersonator)


ActingAuthServiceDep = Annotated[AuthService, Depends(get_acting_auth_service)]


async def get_optional_user(request: Request, service: AuthServiceDep) -> User | None:
    """Current user when a valid token is present, ``None`` otherwise."""
    token = _extract_token(request)
    if not token:
        return None
    try:
        return await service.get_active_user(decode_access_token(token))
    except AuthenticationError:
        return None


OptionalUser = Annotated[User | None, Depends(get_optional_user)]
