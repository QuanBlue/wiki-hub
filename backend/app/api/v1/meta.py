"""Public metadata about this WikiHub instance.

Lets the frontend render the site name and discover enabled capabilities without
hard-coding backend behaviour — the backend stays the single source of truth.

That contract only holds if the flags are honest, so each one below reports what
this build can actually do. Advertising a capability that is not implemented
sends the UI to a dead end and makes the endpoint worse than useless.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.site_settings import SiteSettingsServiceDep, get_login_image_storage
from app.core.config import settings
from app.core.logging import get_logger
from app.schemas.site_settings import LoginPanel, SystemAnnouncement
from app.services.site_settings import SiteSettingsService
from app.services.storage import ObjectStorage

logger = get_logger(__name__)

router = APIRouter(prefix="/meta", tags=["system"])


class InstanceFeatures(BaseModel):
    local_auth: bool
    oidc_auth: bool
    attachments: bool
    comments: bool
    search: bool
    spaces: bool
    audit_log: bool
    backup: bool
    imports: list[str]
    exports: list[str]


class InstanceInfo(BaseModel):
    site_name: str
    theme_color: str = "blue"
    default_font: str = "inter"
    logo_icon: str = "default"
    custom_logo_url: str | None = None
    version: str
    environment: str
    max_upload_size_bytes: int
    allowed_attachment_types: list[str]
    #: How long a deleted page can still be restored from its space's Trash.
    trash_retention_days: int = 30
    #: Whether external/public read-only page share links are enabled system-wide.
    public_shares_enabled: bool = True
    #: Active announcement shown on public pages (/login, /contact-admin) when enabled.
    announcement: SystemAnnouncement | None = None
    #: Administrator copy for the sign-in page's left panel (per language).
    login_panel: LoginPanel = LoginPanel()
    #: Public URL of the uploaded sign-in illustration, if one was uploaded.
    login_image_url: str | None = None
    features: InstanceFeatures


@router.get("", response_model=InstanceInfo, summary="Instance metadata")
async def instance_info(settings_service: SiteSettingsServiceDep) -> InstanceInfo:
    # Site name and upload limits are runtime-editable, so they come from the
    # database (falling back to the environment when unset), not from the
    # import-time config snapshot.
    #
    # A database outage must not take this endpoint down with it: the frontend
    # renders its shell from /meta, and answering with environment defaults is
    # far better than a 500 that leaves the UI unable to draw anything. The
    # admin settings endpoints have no such fallback - there, a failure to read
    # the stored values genuinely is an error.
    # OSError as well as SQLAlchemyError: a DNS failure resolving the database
    # host surfaces as socket.gaierror straight out of the driver, without ever
    # being wrapped in a SQLAlchemy exception.
    try:
        effective = await settings_service.get_effective()
    except (SQLAlchemyError, OSError):
        logger.warning("meta_settings_unavailable", fallback="environment")
        effective = SiteSettingsService.env_defaults()

    return InstanceInfo(
        site_name=effective.site_name,
        theme_color=effective.theme_color,
        default_font=effective.default_font,
        logo_icon=effective.logo_icon,
        custom_logo_url=effective.custom_logo_url,
        version=settings.project_version,
        environment=str(settings.env),
        max_upload_size_bytes=effective.max_upload_size_bytes,
        allowed_attachment_types=effective.allowed_attachment_types,
        trash_retention_days=effective.trash_retention_days,
        public_shares_enabled=effective.public_shares_enabled,
        login_panel=effective.login_panel,
        login_image_url=effective.login_image_url,
        announcement=(
            effective.announcement
            if effective.announcement is not None
            and effective.announcement.is_currently_active()
            and effective.announcement.show_on_login
            else None
        ),
        features=InstanceFeatures(
            local_auth=settings.auth_provider == "local",
            oidc_auth=False,  # OIDC provider is a documented stub in this build
            attachments=True,
            comments=False,
            search=True,
            spaces=True,
            audit_log=True,
            backup=True,
            # Whole-instance backup/restore is reported by `backup` above,
            # not here - these two are per-page/per-space content transfer.
            imports=["confluence"],
            exports=["pdf", "html", "docx"],
        ),
    )


@router.get("/login-image", summary="The sign-in page illustration (public)")
async def read_login_image(
    service: SiteSettingsServiceDep,
    storage: ObjectStorage = Depends(get_login_image_storage),
) -> Response:
    """Public: the sign-in page is shown before anyone is authenticated."""
    found = await service.read_login_image(storage)
    if found is None:
        return Response(status_code=status.HTTP_404_NOT_FOUND)
    data, content_type = found
    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )
