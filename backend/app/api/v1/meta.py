"""Public metadata about this WikiHub instance.

Lets the frontend render the site name and discover enabled capabilities without
hard-coding backend behaviour — the backend stays the single source of truth.

That contract only holds if the flags are honest, so each one below reports what
this build can actually do. Advertising a capability that is not implemented
sends the UI to a dead end and makes the endpoint worse than useless.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.site_settings import SiteSettingsServiceDep
from app.core.config import settings
from app.core.logging import get_logger
from app.services.site_settings import SiteSettingsService

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
        features=InstanceFeatures(
            local_auth=settings.auth_provider == "local",
            oidc_auth=False,  # OIDC provider is a documented stub in this build
            attachments=True,
            comments=False,
            search=True,
            spaces=True,
            audit_log=True,
            backup=True,
            # Content import/export needs the Pages domain, which does not
            # exist yet. Instance backup/restore is reported by `backup` above.
            imports=[],
            exports=[],
        ),
    )
