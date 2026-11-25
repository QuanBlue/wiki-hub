"""Business rules for global, space, and built-in page templates."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Literal, cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError, NotFoundError, PermissionDeniedError
from app.core.logging import get_logger
from app.models.audit import AuditAction
from app.models.page import WikiPage
from app.models.page_template import PageTemplate
from app.models.permission import Permission
from app.models.space import Space
from app.models.user import User
from app.modules.document_import.sanitize import sanitize_imported_html
from app.modules.permissions.service import PermissionService
from app.modules.templates.builtins import (
    get_builtin_template,
    is_builtin_template_id,
    list_builtin_templates,
)
from app.schemas.page_template import (
    PageTemplateCreate,
    PageTemplateRead,
    PageTemplateUpdate,
    SavePageAsTemplateRequest,
    TemplateContentFormat,
    TemplateLang,
    TemplateScope,
)
from app.services.audit import AuditService, ClientInfo

logger = get_logger(__name__)


def sanitize_template_content(content: str, content_format: str) -> str:
    """Sanitize HTML template content with nh3; preserve markdown text."""
    if content_format == "html":
        return sanitize_imported_html(content).strip()
    return content.strip()


class PageTemplateService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        client: ClientInfo | None = None,
        impersonator: User | None = None,
    ) -> None:
        self.session = session
        self.client = client
        self.impersonator = impersonator
        self.permissions = PermissionService(session, client=client, impersonator=impersonator)

    def _audit(self, actor: User) -> AuditService:
        return AuditService(
            self.session, actor=actor, client=self.client, impersonator=self.impersonator
        )

    async def _require_system_admin(self, user: User) -> None:
        if not await self.permissions.is_system_admin(user):
            raise PermissionDeniedError("Only system administrators can manage global templates.")

    async def _require_space_manage(self, space: Space, user: User) -> None:
        await self.permissions.require(space, user, Permission.admin)

    async def _require_space_view(self, space: Space, user: User) -> None:
        await self.permissions.require(space, user, Permission.view)

    async def _usernames_for(self, templates: Sequence[PageTemplate]) -> dict[uuid.UUID, str]:
        user_ids: set[uuid.UUID] = set()
        for tpl in templates:
            if tpl.created_by_id is not None:
                user_ids.add(tpl.created_by_id)
            if tpl.updated_by_id is not None:
                user_ids.add(tpl.updated_by_id)
        if not user_ids:
            return {}
        rows = await self.session.execute(
            select(User.id, User.username).where(User.id.in_(user_ids))
        )
        return {row.id: row.username for row in rows.all()}

    async def _space_keys_for(self, templates: Sequence[PageTemplate]) -> dict[uuid.UUID, str]:
        space_ids = {tpl.space_id for tpl in templates if tpl.space_id is not None}
        if not space_ids:
            return {}
        rows = await self.session.execute(
            select(Space.id, Space.key).where(Space.id.in_(space_ids))
        )
        return {row.id: row.key for row in rows.all()}

    def _to_read(
        self,
        tpl: PageTemplate,
        *,
        usernames: dict[uuid.UUID, str],
        space_keys: dict[uuid.UUID, str],
    ) -> PageTemplateRead:
        fmt: TemplateContentFormat = (
            "markdown" if tpl.content_format == "markdown" else "html"
        )
        return PageTemplateRead(
            id=str(tpl.id),
            scope=cast(TemplateScope, tpl.scope),
            is_builtin=False,
            space_id=tpl.space_id,
            space_key=space_keys.get(tpl.space_id) if tpl.space_id is not None else None,
            name=tpl.name,
            description=tpl.description,
            category=tpl.category,
            icon=tpl.icon,
            content=tpl.content,
            content_format=fmt,
            created_by_username=(
                usernames.get(tpl.created_by_id) if tpl.created_by_id is not None else None
            ),
            updated_by_username=(
                usernames.get(tpl.updated_by_id) if tpl.updated_by_id is not None else None
            ),
            created_at=tpl.created_at,
            updated_at=tpl.updated_at,
        )

    async def _to_read_many(
        self, templates: Sequence[PageTemplate], *, space: Space | None = None
    ) -> list[PageTemplateRead]:
        if not templates:
            return []
        usernames = await self._usernames_for(templates)
        if space is not None:
            space_keys = {space.id: space.key}
        else:
            space_keys = await self._space_keys_for(templates)
        return [
            self._to_read(tpl, usernames=usernames, space_keys=space_keys) for tpl in templates
        ]

    async def _list_db_global(self) -> list[PageTemplate]:
        return list(
            await self.session.scalars(
                select(PageTemplate)
                .where(PageTemplate.scope == "global")
                .order_by(func.lower(PageTemplate.name), PageTemplate.created_at)
            )
        )

    async def _list_db_space(self, space_id: uuid.UUID) -> list[PageTemplate]:
        return list(
            await self.session.scalars(
                select(PageTemplate)
                .where(PageTemplate.scope == "space", PageTemplate.space_id == space_id)
                .order_by(func.lower(PageTemplate.name), PageTemplate.created_at)
            )
        )

    async def list_global(
        self,
        *,
        lang: TemplateLang = "en",
        scope: Literal["all", "global", "builtin"] | None = None,
    ) -> list[PageTemplateRead]:
        results: list[PageTemplateRead] = []
        if scope in (None, "all", "builtin"):
            results.extend(list_builtin_templates(lang))
        if scope in (None, "all", "global"):
            global_rows = await self._list_db_global()
            results.extend(await self._to_read_many(global_rows))
        return results

    async def list_for_space(
        self,
        space: Space,
        user: User,
        *,
        lang: TemplateLang = "en",
    ) -> list[PageTemplateRead]:
        await self._require_space_view(space, user)
        builtins = list_builtin_templates(lang)
        global_rows = await self._list_db_global()
        space_rows = await self._list_db_space(space.id)
        db_items = await self._to_read_many([*global_rows, *space_rows])
        return [*builtins, *db_items]

    async def get_template(
        self,
        template_id: str,
        user: User,
        *,
        lang: TemplateLang = "en",
    ) -> PageTemplateRead:
        if is_builtin_template_id(template_id):
            builtin = get_builtin_template(template_id, lang=lang)
            if builtin is None:
                raise NotFoundError("Template not found.")
            return builtin

        try:
            parsed_id = uuid.UUID(template_id)
        except ValueError:
            raise NotFoundError("Template not found.") from None

        tpl = await self.session.get(PageTemplate, parsed_id)
        if tpl is None:
            raise NotFoundError("Template not found.")

        space: Space | None = None
        if tpl.scope == "space":
            if tpl.space_id is None:
                raise NotFoundError("Template not found.")
            space = await self.session.get(Space, tpl.space_id)
            if space is None:
                raise NotFoundError("Template not found.")
            await self._require_space_view(space, user)

        items = await self._to_read_many([tpl], space=space)
        return items[0]

    async def resolve_for_page_creation(
        self,
        template_id: str,
        user: User,
        *,
        lang: TemplateLang = "en",
    ) -> tuple[str, TemplateContentFormat]:
        tpl = await self.get_template(template_id, user, lang=lang)
        return tpl.content, tpl.content_format

    async def create_global(
        self, payload: PageTemplateCreate, actor: User
    ) -> PageTemplateRead:
        await self._require_system_admin(actor)
        name = payload.name.strip()
        if not name:
            raise BadRequestError("Template name cannot be blank.")
        tpl = PageTemplate(
            scope="global",
            space_id=None,
            name=name,
            description=payload.description.strip(),
            category=payload.category.strip() or "general",
            icon=payload.icon.strip(),
            content=sanitize_template_content(payload.content, payload.content_format),
            content_format=payload.content_format,
            created_by_id=actor.id,
            updated_by_id=actor.id,
        )
        self.session.add(tpl)
        await self.session.flush()
        await self.session.refresh(tpl)
        await self._audit(actor).record(
            AuditAction.template_created,
            entity_type="page_template",
            entity_id=tpl.id,
            entity_label=tpl.name,
            details={"scope": "global", "category": tpl.category},
        )
        logger.info("template_created", scope="global", name=tpl.name, by=actor.username)
        return (await self._to_read_many([tpl]))[0]

    async def update_global(
        self, template_id: uuid.UUID, payload: PageTemplateUpdate, actor: User
    ) -> PageTemplateRead:
        await self._require_system_admin(actor)
        tpl = await self.session.get(PageTemplate, template_id)
        if tpl is None or tpl.scope != "global":
            raise NotFoundError("Template not found.")
        return await self._apply_update(tpl, payload, actor, space=None)

    async def delete_global(self, template_id: uuid.UUID, actor: User) -> None:
        await self._require_system_admin(actor)
        tpl = await self.session.get(PageTemplate, template_id)
        if tpl is None or tpl.scope != "global":
            raise NotFoundError("Template not found.")
        name = tpl.name
        await self.session.delete(tpl)
        await self.session.flush()
        await self._audit(actor).record(
            AuditAction.template_deleted,
            entity_type="page_template",
            entity_id=template_id,
            entity_label=name,
            details={"scope": "global"},
        )
        logger.info("template_deleted", scope="global", name=name, by=actor.username)

    async def create_for_space(
        self, space: Space, payload: PageTemplateCreate, actor: User
    ) -> PageTemplateRead:
        await self._require_space_manage(space, actor)
        name = payload.name.strip()
        if not name:
            raise BadRequestError("Template name cannot be blank.")
        tpl = PageTemplate(
            scope="space",
            space_id=space.id,
            name=name,
            description=payload.description.strip(),
            category=payload.category.strip() or "general",
            icon=payload.icon.strip(),
            content=sanitize_template_content(payload.content, payload.content_format),
            content_format=payload.content_format,
            created_by_id=actor.id,
            updated_by_id=actor.id,
        )
        self.session.add(tpl)
        await self.session.flush()
        await self.session.refresh(tpl)
        await self._audit(actor).record(
            AuditAction.template_created,
            entity_type="page_template",
            entity_id=tpl.id,
            entity_label=tpl.name,
            details={"scope": "space", "space_key": space.key, "category": tpl.category},
        )
        logger.info(
            "template_created",
            scope="space",
            space_key=space.key,
            name=tpl.name,
            by=actor.username,
        )
        return (await self._to_read_many([tpl], space=space))[0]

    async def update_for_space(
        self,
        space: Space,
        template_id: uuid.UUID,
        payload: PageTemplateUpdate,
        actor: User,
    ) -> PageTemplateRead:
        await self._require_space_manage(space, actor)
        tpl = await self.session.get(PageTemplate, template_id)
        if tpl is None or tpl.scope != "space" or tpl.space_id != space.id:
            raise NotFoundError("Template not found.")
        return await self._apply_update(tpl, payload, actor, space=space)

    async def delete_for_space(
        self, space: Space, template_id: uuid.UUID, actor: User
    ) -> None:
        await self._require_space_manage(space, actor)
        tpl = await self.session.get(PageTemplate, template_id)
        if tpl is None or tpl.scope != "space" or tpl.space_id != space.id:
            raise NotFoundError("Template not found.")
        name = tpl.name
        await self.session.delete(tpl)
        await self.session.flush()
        await self._audit(actor).record(
            AuditAction.template_deleted,
            entity_type="page_template",
            entity_id=template_id,
            entity_label=name,
            details={"scope": "space", "space_key": space.key},
        )
        logger.info(
            "template_deleted",
            scope="space",
            space_key=space.key,
            name=name,
            by=actor.username,
        )

    async def save_page_as_template(
        self,
        space: Space,
        page: WikiPage,
        payload: SavePageAsTemplateRequest,
        actor: User,
    ) -> PageTemplateRead:
        if not await self.permissions.can_view_page(page, actor):
            raise PermissionDeniedError("You do not have access to this page.")

        fmt: TemplateContentFormat = (
            "markdown" if page.content_format == "markdown" else "html"
        )
        create_payload = PageTemplateCreate(
            name=payload.name,
            description=payload.description,
            category=payload.category,
            icon=payload.icon,
            content=page.content,
            content_format=fmt,
        )
        if payload.scope == "global":
            return await self.create_global(create_payload, actor)
        return await self.create_for_space(space, create_payload, actor)

    async def _apply_update(
        self,
        tpl: PageTemplate,
        payload: PageTemplateUpdate,
        actor: User,
        *,
        space: Space | None,
    ) -> PageTemplateRead:
        data = payload.model_dump(exclude_unset=True)
        if "name" in data and data["name"] is not None:
            name = str(data["name"]).strip()
            if not name:
                raise BadRequestError("Template name cannot be blank.")
            tpl.name = name
        if "description" in data and data["description"] is not None:
            tpl.description = str(data["description"]).strip()
        if "category" in data and data["category"] is not None:
            tpl.category = str(data["category"]).strip() or "general"
        if "icon" in data and data["icon"] is not None:
            tpl.icon = str(data["icon"]).strip()

        new_format = (
            str(data["content_format"])
            if "content_format" in data and data["content_format"] is not None
            else tpl.content_format
        )
        if "content_format" in data and data["content_format"] is not None:
            tpl.content_format = new_format
        if "content" in data and data["content"] is not None:
            tpl.content = sanitize_template_content(str(data["content"]), new_format)
        elif "content_format" in data and new_format == "html":
            tpl.content = sanitize_template_content(tpl.content, "html")

        tpl.updated_by_id = actor.id
        await self.session.flush()
        await self.session.refresh(tpl)
        details: dict[str, object] = {"scope": tpl.scope, "category": tpl.category}
        if space is not None:
            details["space_key"] = space.key
        await self._audit(actor).record(
            AuditAction.template_updated,
            entity_type="page_template",
            entity_id=tpl.id,
            entity_label=tpl.name,
            details=details,
        )
        logger.info("template_updated", scope=tpl.scope, name=tpl.name, by=actor.username)
        return (await self._to_read_many([tpl], space=space))[0]
