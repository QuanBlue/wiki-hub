"""The internal endpoint the headless-browser print route calls to get a
page's render bundle.

Deliberately separate from every other page endpoint: it is authenticated by
a narrow, single-page export token (never the session cookie - the headless
browser holds no cookie at all), and it re-verifies the caller's identity and
permissions against the live database rather than trusting the token's claims
as authorization. The token only proves *which* page/user/format a render was
minted for; whether that user may still see that page is decided here, fresh,
every time.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from app.api.deps import DbSession
from app.core.exceptions import AuthenticationError, NotFoundError
from app.core.security import ExportTokenIdentity, decode_export_token
from app.models.page import WikiPage
from app.models.permission import Permission
from app.models.space import Space
from app.modules.auth.service import AuthService
from app.modules.pages.export_content import prepare_export_html
from app.modules.pages.service import PageService
from app.modules.spaces.service import SpaceService
from app.schemas.export import ExportBundle, ExportBundlePage, ExportBundleSite, ExportBundleSpace
from app.services.site_settings import SiteSettingsService
from app.services.storage import get_storage

router = APIRouter(prefix="/export-render", tags=["exports"])


def _bearer_token(request: Request) -> str | None:
    """Authorization: Bearer only - this endpoint has no cookie-based caller,
    and must not accidentally accept one (a real browser session cookie must
    never grant it anything: it decodes with `decode_export_token`, which
    already rejects a session's `type`, but the extraction itself staying
    Bearer-only keeps that invariant obvious from the route alone)."""
    header = request.headers.get("Authorization")
    if not header:
        return None
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return None
    return value.strip()


async def get_export_identity(request: Request) -> ExportTokenIdentity:
    token = _bearer_token(request)
    if not token:
        raise AuthenticationError("An export token is required.")
    return decode_export_token(token)


ExportIdentityDep = Annotated[ExportTokenIdentity, Depends(get_export_identity)]


@router.get(
    "/bundle", response_model=ExportBundle, summary="Internal: page render bundle for export"
)
async def export_bundle(
    identity: ExportIdentityDep,
    response: Response,
    session: DbSession,
) -> ExportBundle:
    user = await AuthService(session).get_active_user(identity.subject)

    space = await session.get(Space, identity.space_id)
    if space is None:
        raise NotFoundError("Space not found.")
    page = await session.get(WikiPage, identity.page_id)
    if page is None or page.space_id != space.id:
        raise NotFoundError("Page not found.")

    # Re-run the full authorization chain against the live database. The
    # token's claims name a page, never a permission - a revocation inside the
    # token's short TTL must still take effect immediately.
    space_service = SpaceService(session)
    page_service = PageService(session)
    await space_service.require_view(space, user)
    await page_service.require_page_view(page, user)
    await space_service.permissions.require(space, user, Permission.export)

    content = await prepare_export_html(page, storage=get_storage(), session=session)
    site = await SiteSettingsService(session).get_effective()

    response.headers["Cache-Control"] = "no-store"
    return ExportBundle(
        page=ExportBundlePage(id=page.id, title=page.title, slug=page.slug, content=content),
        space=ExportBundleSpace(key=space.key, name=space.name, font_family=space.font_family),
        site=ExportBundleSite(
            site_name=site.site_name,
            theme_color=site.theme_color,
            default_font=site.default_font,
        ),
    )
