"""Instance settings endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import ClientInfoDep, CurrentSuperuser, DbSession, Impersonator
from app.schemas.site_settings import SiteSettingsRead, SiteSettingsUpdate
from app.services.site_settings import SiteSettingsService

router = APIRouter(prefix="/settings", tags=["settings"])


def get_site_settings_service(session: DbSession) -> SiteSettingsService:
    """Read-only instance, for paths that never mutate."""
    return SiteSettingsService(session)


SiteSettingsServiceDep = Annotated[SiteSettingsService, Depends(get_site_settings_service)]


def get_acting_site_settings_service(
    session: DbSession,
    user: CurrentSuperuser,
    client: ClientInfoDep,
    impersonator: Impersonator,
) -> SiteSettingsService:
    return SiteSettingsService(session, actor=user, client=client, impersonator=impersonator)


ActingSiteSettingsServiceDep = Annotated[
    SiteSettingsService, Depends(get_acting_site_settings_service)
]


@router.get("", response_model=SiteSettingsRead, summary="Read instance settings")
async def read_settings(
    _admin: CurrentSuperuser, service: SiteSettingsServiceDep
) -> SiteSettingsRead:
    return await service.read()


@router.patch("", response_model=SiteSettingsRead, summary="Update instance settings")
async def update_settings(
    payload: SiteSettingsUpdate,
    service: ActingSiteSettingsServiceDep,
    _admin: CurrentSuperuser,
) -> SiteSettingsRead:
    """Partial update. Send an explicit ``null`` to reset a setting to its
    environment default."""
    return await service.update(payload)
