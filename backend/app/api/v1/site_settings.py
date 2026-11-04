"""Instance settings endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, UploadFile

from app.api.deps import ClientInfoDep, CurrentSuperuser, CurrentUser, DbSession, Impersonator
from app.core.exceptions import BadRequestError, PayloadTooLargeError, UnsupportedMediaTypeError
from app.schemas.site_settings import (
    AnnouncementRead,
    SidebarPermissionsRead,
    SiteSettingsRead,
    SiteSettingsUpdate,
)
from app.services.site_settings import SiteSettingsService
from app.services.storage import ObjectStorage, S3ObjectStorage

router = APIRouter(prefix="/settings", tags=["settings"])

LOGIN_IMAGE_EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
MAX_LOGIN_IMAGE_BYTES = 5 * 1024 * 1024


def get_login_image_storage() -> ObjectStorage:
    return S3ObjectStorage()


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


@router.get(
    "/sidebar-permissions",
    response_model=SidebarPermissionsRead,
    summary="Read effective sidebar permissions",
)
async def read_sidebar_permissions(
    _user: CurrentUser, service: SiteSettingsServiceDep
) -> SidebarPermissionsRead:
    """Expose only navigation visibility to signed-in users, not instance settings."""
    return await service.read_sidebar_permissions()


@router.get(
    "/announcement",
    response_model=AnnouncementRead,
    summary="Read active system announcement",
)
async def read_announcement(
    _user: CurrentUser, service: SiteSettingsServiceDep
) -> AnnouncementRead:
    """Expose the active top-of-page system announcement to signed-in users."""
    return await service.read_announcement()


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


@router.post(
    "/login-image",
    response_model=SiteSettingsRead,
    summary="Upload the sign-in page illustration",
)
async def upload_login_image(
    file: UploadFile,
    service: ActingSiteSettingsServiceDep,
    _admin: CurrentSuperuser,
    storage: ObjectStorage = Depends(get_login_image_storage),
) -> SiteSettingsRead:
    content_type = (file.content_type or "").lower()
    if content_type not in LOGIN_IMAGE_EXTENSIONS:
        raise UnsupportedMediaTypeError("The illustration must be a JPEG, PNG or WebP image.")
    data = await file.read(MAX_LOGIN_IMAGE_BYTES + 1)
    if len(data) > MAX_LOGIN_IMAGE_BYTES:
        raise PayloadTooLargeError("The illustration must be 5 MB or smaller.")
    if not data:
        raise BadRequestError("The illustration is empty.")
    return await service.set_login_image(
        storage,
        data=data,
        content_type=content_type,
        extension=LOGIN_IMAGE_EXTENSIONS[content_type],
    )


@router.delete(
    "/login-image",
    response_model=SiteSettingsRead,
    summary="Remove the uploaded sign-in page illustration",
)
async def delete_login_image(
    service: ActingSiteSettingsServiceDep,
    _admin: CurrentSuperuser,
    storage: ObjectStorage = Depends(get_login_image_storage),
) -> SiteSettingsRead:
    return await service.clear_login_image(storage)
