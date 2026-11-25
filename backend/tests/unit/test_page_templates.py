"""Comprehensive unit and API tests for Page Templates (built-in, global, space, save-as-template, create-page-from-template, backup/restore)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api.v1 import templates as templates_api
from app.core.exceptions import BadRequestError, NotFoundError, PermissionDeniedError
from app.models.page import WikiPage
from app.models.page_template import PageTemplate
from app.models.permission import Permission
from app.models.space import Space, SpaceStatus, SpaceVisibility
from app.models.user import User
from app.modules.backup import exporter as backup_exporter
from app.modules.backup import importer as backup_importer
from app.modules.backup.helpers import _ReportBuilder
from app.modules.document_import.sanitize import sanitize_imported_html
from app.modules.pages.service import PageService
from app.modules.templates import (
    BUILTIN_PREFIX,
    BUILTIN_SLUGS,
    PageTemplateService,
    get_builtin_template,
    is_builtin_template_id,
    list_builtin_templates,
)
from app.modules.templates.service import sanitize_template_content
from app.schemas.backup import BackupDocument, BackupMeta, BackupPageTemplate
from app.schemas.page import PageCreate
from app.schemas.page_template import (
    PageTemplateCreate,
    PageTemplateUpdate,
    SavePageAsTemplateRequest,
)
from app.services.audit import ClientInfo


def _make_user(
    *,
    username: str = "alice",
    is_superuser: bool = False,
) -> User:
    now = datetime.now(UTC)
    return User(
        id=uuid.uuid4(),
        username=username,
        email=f"{username}@example.com",
        full_name=username.title(),
        password_hash=None,
        bio="",
        pronouns="",
        profile_url="",
        social_links=[],
        company="",
        status_emoji="",
        status_text="",
        is_active=True,
        is_superuser=is_superuser,
        is_protected=False,
        totp_enabled=False,
        totp_recovery_codes=[],
        created_at=now,
        updated_at=now,
    )


def _make_space(
    *,
    key: str = "ENG",
    name: str = "Engineering",
    visibility: SpaceVisibility = SpaceVisibility.open,
) -> Space:
    now = datetime.now(UTC)
    return Space(
        id=uuid.uuid4(),
        key=key,
        name=name,
        description="",
        icon="",
        status=SpaceStatus.active,
        visibility=visibility,
        created_at=now,
        updated_at=now,
    )


def _make_page(
    space: Space,
    *,
    title: str = "Architecture Guide",
    content: str = "<h2>Overview</h2><p>Content</p>",
    content_format: str = "html",
) -> WikiPage:
    now = datetime.now(UTC)
    return WikiPage(
        id=uuid.uuid4(),
        space_id=space.id,
        parent_id=None,
        title=title,
        slug="architecture-guide",
        content=content,
        content_format=content_format,
        created_at=now,
        updated_at=now,
    )


def _make_template(
    *,
    scope: str = "global",
    space_id: uuid.UUID | None = None,
    name: str = "Custom Template",
    description: str = "Desc",
    category: str = "general",
    icon: str = "file-text",
    content: str = "<h2>Title</h2><p>Body</p>",
    content_format: str = "html",
    created_by_id: uuid.UUID | None = None,
    updated_by_id: uuid.UUID | None = None,
) -> PageTemplate:
    now = datetime.now(UTC)
    return PageTemplate(
        id=uuid.uuid4(),
        scope=scope,
        space_id=space_id,
        name=name,
        description=description,
        category=category,
        icon=icon,
        content=content,
        content_format=content_format,
        created_by_id=created_by_id,
        updated_by_id=updated_by_id,
        created_at=now,
        updated_at=now,
    )


class _FakeExecuteResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return list(self._rows)

    def scalars(self) -> list[Any]:
        return list(self._rows)

    def scalar_one_or_none(self) -> Any:
        return self._rows[0] if self._rows else None


class _FakeTemplateSession:
    """Lightweight async session double storing users, spaces, pages, and templates."""

    def __init__(self) -> None:
        self.users: dict[uuid.UUID, User] = {}
        self.spaces: dict[uuid.UUID, Space] = {}
        self.pages: dict[uuid.UUID, WikiPage] = {}
        self.templates: dict[uuid.UUID, PageTemplate] = {}
        self.audit_logs: list[Any] = []

    def add_user(self, user: User) -> User:
        self.users[user.id] = user
        return user

    def add_space(self, space: Space) -> Space:
        self.spaces[space.id] = space
        return space

    def add_page(self, page: WikiPage) -> WikiPage:
        self.pages[page.id] = page
        return page

    def add(self, obj: Any) -> None:
        now = datetime.now(UTC)
        if isinstance(obj, PageTemplate):
            if obj.id is None:
                obj.id = uuid.uuid4()
            if obj.created_at is None:
                obj.created_at = now
            if obj.updated_at is None:
                obj.updated_at = now
            self.templates[obj.id] = obj
        else:
            self.audit_logs.append(obj)

    async def flush(self) -> None:
        return None

    async def refresh(self, obj: Any) -> None:
        if isinstance(obj, PageTemplate) and obj.updated_at is None:
            obj.updated_at = datetime.now(UTC)

    async def delete(self, obj: Any) -> None:
        if isinstance(obj, PageTemplate):
            self.templates.pop(obj.id, None)

    async def get(self, model: type[Any], ident: uuid.UUID) -> Any:
        if model is PageTemplate:
            return self.templates.get(ident)
        if model is Space:
            return self.spaces.get(ident)
        if model is WikiPage:
            return self.pages.get(ident)
        if model is User:
            return self.users.get(ident)
        return None

    async def scalars(self, stmt: Any) -> list[Any]:
        sql = str(stmt)
        if "FROM page_templates" in sql:
            params = stmt.compile().params
            scope_filter = next(
                (v for k, v in params.items() if "scope" in k), None
            )
            space_filter = next(
                (v for k, v in params.items() if "space_id" in k), None
            )
            rows = list(self.templates.values())
            if scope_filter is not None:
                rows = [r for r in rows if r.scope == scope_filter]
            if space_filter is not None:
                rows = [r for r in rows if r.space_id == space_filter]
            rows.sort(key=lambda r: (r.name.lower(), r.created_at))
            return rows
        return []

    async def execute(self, stmt: Any) -> _FakeExecuteResult:
        sql = str(stmt)
        if "FROM users" in sql:
            return _FakeExecuteResult(
                [SimpleNamespace(id=u.id, username=u.username) for u in self.users.values()]
            )
        if "FROM spaces" in sql:
            return _FakeExecuteResult(
                [SimpleNamespace(id=s.id, key=s.key) for s in self.spaces.values()]
            )
        return _FakeExecuteResult([])


# ---------------------------------------------------------------------------
# 1. Built-in templates (EN & VI)
# ---------------------------------------------------------------------------


def test_builtin_templates_en_and_vi_complete_and_sanitized() -> None:
    en_templates = list_builtin_templates("en")
    vi_templates = list_builtin_templates("vi")

    assert len(en_templates) == 18
    assert len(vi_templates) == 18
    assert [t.id for t in en_templates] == [f"{BUILTIN_PREFIX}{s}" for s in BUILTIN_SLUGS]
    assert [t.id for t in vi_templates] == [f"{BUILTIN_PREFIX}{s}" for s in BUILTIN_SLUGS]

    for en_tpl, vi_tpl in zip(en_templates, vi_templates, strict=True):
        assert en_tpl.scope == "builtin"
        assert en_tpl.is_builtin is True
        assert en_tpl.space_id is None
        assert en_tpl.content_format == "html"
        assert vi_tpl.scope == "builtin"
        assert vi_tpl.is_builtin is True
        assert en_tpl.name != vi_tpl.name
        assert en_tpl.description != vi_tpl.description
        assert en_tpl.content != vi_tpl.content
        assert "<h2>" in en_tpl.content
        assert "<h2>" in vi_tpl.content
        # Built-in HTML must be safe and survive sanitization without dropping headings.
        assert "<h2>" in sanitize_imported_html(en_tpl.content)
        assert "<h2>" in sanitize_imported_html(vi_tpl.content)


def test_builtin_lookup_helpers() -> None:
    assert is_builtin_template_id("builtin:meeting-notes") is True
    assert is_builtin_template_id(str(uuid.uuid4())) is False

    by_prefixed = get_builtin_template("builtin:adr", lang="en")
    by_slug = get_builtin_template("adr", lang="vi")
    assert by_prefixed is not None
    assert by_prefixed.name == "Architecture Decision Record (ADR)"
    assert by_slug is not None
    assert by_slug.name == "Ghi nhận quyết định kiến trúc (ADR)"
    assert get_builtin_template("builtin:does-not-exist", lang="en") is None


def test_sanitize_template_content_html_and_markdown() -> None:
    dirty = (
        '<script>alert(1)</script>'
        '<h2 onclick="steal()">Safe Heading</h2>'
        '<p><a href="javascript:alert(1)">Click</a></p>'
    )
    cleaned = sanitize_template_content(dirty, "html")
    assert "<script" not in cleaned
    assert "onclick" not in cleaned
    assert "javascript:" not in cleaned
    assert "<h2>Safe Heading</h2>" in cleaned

    md = "  # Heading\n\n- item 1\n  "
    assert sanitize_template_content(md, "markdown") == "# Heading\n\n- item 1"


# ---------------------------------------------------------------------------
# 2. Global & Space template CRUD + Permissions + Sanitization
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_global_template_crud_and_permissions() -> None:
    session = _FakeTemplateSession()
    admin = session.add_user(_make_user(username="admin", is_superuser=True))
    member = session.add_user(_make_user(username="bob", is_superuser=False))
    space = session.add_space(_make_space(key="ENG"))

    service = PageTemplateService(
        session,  # type: ignore[arg-type]
        client=ClientInfo(ip="127.0.0.1", user_agent="pytest"),
    )
    service.permissions.is_system_admin = AsyncMock(  # type: ignore[method-assign]
        side_effect=lambda u: u.is_superuser
    )

    # Empty DB global list returns []
    assert await service.list_global(lang="en", scope="global") == []

    # Non-admin cannot create global template
    with pytest.raises(PermissionDeniedError):
        await service.create_global(PageTemplateCreate(name="Blocked"), member)

    # Blank name rejected
    with pytest.raises(BadRequestError):
        await service.create_global(PageTemplateCreate(name="   "), admin)

    # Admin creates global template with unsafe HTML -> sanitized
    created = await service.create_global(
        PageTemplateCreate(
            name="  Release Checklist  ",
            description="  Pre-release steps  ",
            category="  release ",
            icon=" rocket ",
            content="<script>bad()</script><h2>Release</h2><p>Go!</p>",
            content_format="html",
        ),
        admin,
    )
    assert created.scope == "global"
    assert created.is_builtin is False
    assert created.name == "Release Checklist"
    assert created.description == "Pre-release steps"
    assert created.category == "release"
    assert created.icon == "rocket"
    assert "<script" not in created.content
    assert "<h2>Release</h2>" in created.content
    assert created.created_by_username == "admin"
    assert created.updated_by_username == "admin"

    # List global templates with different scope filters
    all_items = await service.list_global(lang="en")
    assert len(all_items) == 19
    only_global = await service.list_global(lang="en", scope="global")
    assert [t.id for t in only_global] == [created.id]
    only_builtin = await service.list_global(lang="vi", scope="builtin")
    assert len(only_builtin) == 18
    assert all(t.is_builtin for t in only_builtin)

    # Read single template (builtin, global UUID, invalid, missing)
    fetched_builtin = await service.get_template("builtin:rfc", member, lang="vi")
    assert fetched_builtin.name == "Đề xuất kỹ thuật (RFC)"
    fetched_global = await service.get_template(created.id, member)
    assert fetched_global.id == created.id

    with pytest.raises(NotFoundError):
        await service.get_template("builtin:unknown", member)
    with pytest.raises(NotFoundError):
        await service.get_template("not-a-uuid", member)
    with pytest.raises(NotFoundError):
        await service.get_template(str(uuid.uuid4()), member)

    # Update global template (non-admin denied, blank name rejected, markdown -> html re-sanitized)
    tpl_uuid = uuid.UUID(created.id)
    with pytest.raises(PermissionDeniedError):
        await service.update_global(tpl_uuid, PageTemplateUpdate(name="Nope"), member)
    with pytest.raises(BadRequestError):
        await service.update_global(tpl_uuid, PageTemplateUpdate(name="   "), admin)

    updated_md = await service.update_global(
        tpl_uuid,
        PageTemplateUpdate(
            name="Release v2",
            description="Updated",
            category="ops",
            icon="check",
            content="<script>x</script>## Markdown",
            content_format="markdown",
        ),
        admin,
    )
    assert updated_md.name == "Release v2"
    assert updated_md.content_format == "markdown"
    assert updated_md.content == "<script>x</script>## Markdown"

    # Switching format back to html without changing content sanitizes stored content
    updated_html = await service.update_global(
        tpl_uuid,
        PageTemplateUpdate(content_format="html"),
        admin,
    )
    assert updated_html.content_format == "html"
    assert "<script" not in updated_html.content

    # Updating/deleting a space template via global methods raises 404
    space_tpl = _make_template(scope="space", space_id=space.id, name="Space Only")
    session.add(space_tpl)
    with pytest.raises(NotFoundError):
        await service.update_global(space_tpl.id, PageTemplateUpdate(name="X"), admin)
    with pytest.raises(NotFoundError):
        await service.delete_global(space_tpl.id, admin)

    # Template with no author ids still serializes cleanly
    anon_tpl = _make_template(scope="global", name="Anonymous Global")
    session.add(anon_tpl)
    anon_read = await service.get_template(str(anon_tpl.id), member)
    assert anon_read.created_by_username is None
    assert anon_read.updated_by_username is None

    # Delete global template
    with pytest.raises(PermissionDeniedError):
        await service.delete_global(tpl_uuid, member)
    await service.delete_global(tpl_uuid, admin)
    assert tpl_uuid not in session.templates


@pytest.mark.asyncio
async def test_space_template_crud_and_permissions() -> None:
    session = _FakeTemplateSession()
    space_admin = session.add_user(_make_user(username="sadmin"))
    viewer = session.add_user(_make_user(username="viewer"))
    outsider = session.add_user(_make_user(username="outsider"))
    space = session.add_space(_make_space(key="ENG", visibility=SpaceVisibility.restricted))
    other_space = session.add_space(_make_space(key="OPS"))

    service = PageTemplateService(session)  # type: ignore[arg-type]

    async def _require(sp: Space, usr: User, perm: Permission) -> None:
        if usr.id == outsider.id:
            raise PermissionDeniedError("No access")
        if perm is Permission.admin and usr.id != space_admin.id:
            raise PermissionDeniedError("Admin required")

    service.permissions.require = AsyncMock(side_effect=_require)  # type: ignore[method-assign]

    # Viewer cannot create space template
    with pytest.raises(PermissionDeniedError):
        await service.create_for_space(space, PageTemplateCreate(name="Denied"), viewer)

    # Blank name rejected
    with pytest.raises(BadRequestError):
        await service.create_for_space(space, PageTemplateCreate(name="  "), space_admin)

    # Space admin creates space template
    created = await service.create_for_space(
        space,
        PageTemplateCreate(
            name="Service Spec",
            description="Spec for ENG services",
            category="engineering",
            content="<h2>Service</h2><p>Details</p>",
        ),
        space_admin,
    )
    assert created.scope == "space"
    assert created.space_id == space.id
    assert created.space_key == "ENG"

    # Global template also appears in list_for_space
    global_tpl = _make_template(scope="global", name="Global Spec", created_by_id=space_admin.id)
    session.add(global_tpl)

    # Viewer can list space templates (6 builtins + 1 global + 1 space)
    listed = await service.list_for_space(space, viewer, lang="en")
    assert len(listed) == 20
    assert sum(1 for t in listed if t.scope == "builtin") == 18
    assert sum(1 for t in listed if t.scope == "global") == 1
    assert sum(1 for t in listed if t.scope == "space") == 1

    # Outsider cannot list or read space template
    with pytest.raises(PermissionDeniedError):
        await service.list_for_space(space, outsider)
    with pytest.raises(PermissionDeniedError):
        await service.get_template(created.id, outsider)

    # Viewer can read single space template
    fetched = await service.get_template(created.id, viewer)
    assert fetched.space_key == "ENG"

    # Edge cases: space template with missing space_id or deleted space
    broken_no_space = _make_template(scope="space", space_id=None, name="Broken")
    session.add(broken_no_space)
    with pytest.raises(NotFoundError):
        await service.get_template(str(broken_no_space.id), viewer)

    broken_missing_space = _make_template(
        scope="space", space_id=uuid.uuid4(), name="Orphan"
    )
    session.add(broken_missing_space)
    with pytest.raises(NotFoundError):
        await service.get_template(str(broken_missing_space.id), viewer)

    # Update & delete space template
    tpl_uuid = uuid.UUID(created.id)
    with pytest.raises(PermissionDeniedError):
        await service.update_for_space(space, tpl_uuid, PageTemplateUpdate(name="X"), viewer)
    with pytest.raises(NotFoundError):
        await service.update_for_space(
            other_space, tpl_uuid, PageTemplateUpdate(name="Wrong Space"), space_admin
        )
    updated = await service.update_for_space(
        space, tpl_uuid, PageTemplateUpdate(name="Service Spec v2"), space_admin
    )
    assert updated.name == "Service Spec v2"

    with pytest.raises(NotFoundError):
        await service.delete_for_space(other_space, tpl_uuid, space_admin)
    await service.delete_for_space(space, tpl_uuid, space_admin)
    assert tpl_uuid not in session.templates


# ---------------------------------------------------------------------------
# 3. Save existing page as template
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_save_page_as_template_permissions_and_formats() -> None:
    session = _FakeTemplateSession()
    admin = session.add_user(_make_user(username="admin", is_superuser=True))
    space_admin = session.add_user(_make_user(username="sadmin"))
    viewer = session.add_user(_make_user(username="viewer"))
    space = session.add_space(_make_space(key="ENG"))
    html_page = session.add_page(
        _make_page(space, content="<script>x</script><h2>Runbook</h2><p>Step 1</p>")
    )
    md_page = session.add_page(
        _make_page(space, title="MD", content="# Heading", content_format="markdown")
    )

    service = PageTemplateService(session)  # type: ignore[arg-type]
    service.permissions.is_system_admin = AsyncMock(  # type: ignore[method-assign]
        side_effect=lambda u: u.is_superuser
    )

    async def _require(sp: Space, usr: User, perm: Permission) -> None:
        if perm is Permission.admin and usr.id not in {admin.id, space_admin.id}:
            raise PermissionDeniedError("Space admin required")

    service.permissions.require = AsyncMock(side_effect=_require)  # type: ignore[method-assign]
    service.permissions.can_view_page = AsyncMock(  # type: ignore[method-assign]
        side_effect=lambda p, u: u.username != "blocked"
    )

    blocked = session.add_user(_make_user(username="blocked"))
    with pytest.raises(PermissionDeniedError):
        await service.save_page_as_template(
            space,
            html_page,
            SavePageAsTemplateRequest(name="Blocked", scope="space"),
            blocked,
        )

    # Viewer can view page but cannot create space template
    with pytest.raises(PermissionDeniedError):
        await service.save_page_as_template(
            space,
            html_page,
            SavePageAsTemplateRequest(name="No Space Admin", scope="space"),
            viewer,
        )

    # Space admin can save as space template, HTML gets sanitized
    space_tpl = await service.save_page_as_template(
        space,
        html_page,
        SavePageAsTemplateRequest(name="Saved Runbook", scope="space", category="ops"),
        space_admin,
    )
    assert space_tpl.scope == "space"
    assert space_tpl.space_id == space.id
    assert "<script" not in space_tpl.content
    assert "<h2>Runbook</h2>" in space_tpl.content

    # Space admin cannot save as global template
    with pytest.raises(PermissionDeniedError):
        await service.save_page_as_template(
            space,
            md_page,
            SavePageAsTemplateRequest(name="Global MD", scope="global"),
            space_admin,
        )

    # System admin can save markdown page as global template
    global_tpl = await service.save_page_as_template(
        space,
        md_page,
        SavePageAsTemplateRequest(name="Global MD", scope="global"),
        admin,
    )
    assert global_tpl.scope == "global"
    assert global_tpl.content_format == "markdown"
    assert global_tpl.content == "# Heading"


# ---------------------------------------------------------------------------
# 4. Create page from template (PageService.create)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_page_from_template_builtin_and_custom() -> None:
    session = _FakeTemplateSession()
    creator = session.add_user(_make_user(username="alice", is_superuser=True))
    space = session.add_space(_make_space(key="ENG"))

    custom_tpl = _make_template(
        scope="global",
        name="Markdown Spec",
        content="# Custom MD\n\nBody",
        content_format="markdown",
        created_by_id=creator.id,
    )
    session.add(custom_tpl)

    page_service = PageService(session)  # type: ignore[arg-type]
    page_service.require_editor = AsyncMock()  # type: ignore[method-assign]
    page_service.unique_slug = AsyncMock(return_value="new-page")  # type: ignore[method-assign]
    page_service.snapshot_revision = AsyncMock()  # type: ignore[method-assign]
    page_service._notify_watchers = AsyncMock()  # type: ignore[method-assign]
    page_service.pages.add = MagicMock()  # type: ignore[method-assign]

    # 1. Built-in Vietnamese template populates empty content
    page_vi = await page_service.create(
        space,
        PageCreate(title="ADR 001", template_id="builtin:adr", template_lang="vi"),
        creator,
    )
    assert "Bối cảnh" in page_vi.content
    assert page_vi.content_format == "html"

    # 2. Custom markdown template populates content and format
    page_md = await page_service.create(
        space,
        PageCreate(title="Spec", template_id=str(custom_tpl.id)),
        creator,
    )
    assert page_md.content == "# Custom MD\n\nBody"
    assert page_md.content_format == "markdown"

    # 3. Explicit non-empty content overrides template
    page_custom_content = await page_service.create(
        space,
        PageCreate(
            title="Manual",
            content="<p>Explicit</p>",
            template_id="builtin:meeting-notes",
        ),
        creator,
    )
    assert page_custom_content.content == "<p>Explicit</p>"


# ---------------------------------------------------------------------------
# 5. API router handlers & dependency wiring
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_api_handlers_wiring() -> None:
    session = _FakeTemplateSession()
    admin = session.add_user(_make_user(username="admin", is_superuser=True))
    space = session.add_space(_make_space(key="ENG"))
    other_space = session.add_space(_make_space(key="OPS"))
    page = session.add_page(_make_page(space))
    other_page = session.add_page(_make_page(other_space))

    # Dependency factories
    dep_svc = templates_api.get_template_service(
        session,  # type: ignore[arg-type]
        ClientInfo(ip="127.0.0.1", user_agent="test"),
        None,
    )
    assert isinstance(dep_svc, PageTemplateService)
    assert templates_api.get_space_service(session).session is session  # type: ignore[arg-type]

    dep_svc.permissions.is_system_admin = AsyncMock(return_value=True)  # type: ignore[method-assign]
    dep_svc.permissions.require = AsyncMock()  # type: ignore[method-assign]
    dep_svc.permissions.can_view_page = AsyncMock(return_value=True)  # type: ignore[method-assign]

    space_service = MagicMock()
    space_service.get_by_key = AsyncMock(return_value=space)

    # Global endpoints
    g = await templates_api.create_global_template(
        PageTemplateCreate(name="Global API"), admin, dep_svc
    )
    listed = await templates_api.list_global_templates(admin, dep_svc, scope="global", lang="en")
    assert [t.id for t in listed] == [g.id]
    fetched = await templates_api.get_template(g.id, admin, dep_svc, lang="en")
    assert fetched.id == g.id
    updated = await templates_api.update_global_template(
        uuid.UUID(g.id), PageTemplateUpdate(name="Global API v2"), admin, dep_svc
    )
    assert updated.name == "Global API v2"
    await templates_api.delete_global_template(uuid.UUID(g.id), admin, dep_svc)

    # Space endpoints
    s = await templates_api.create_space_template(
        "ENG", PageTemplateCreate(name="Space API"), admin, dep_svc, space_service
    )
    s_list = await templates_api.list_space_templates("ENG", admin, dep_svc, space_service, lang="en")
    assert any(t.id == s.id for t in s_list)
    s_upd = await templates_api.update_space_template(
        "ENG", uuid.UUID(s.id), PageTemplateUpdate(name="Space API v2"), admin, dep_svc, space_service
    )
    assert s_upd.name == "Space API v2"
    await templates_api.delete_space_template("ENG", uuid.UUID(s.id), admin, dep_svc, space_service)

    # Save page as template endpoint
    saved = await templates_api.save_page_as_template(
        "ENG",
        page.id,
        SavePageAsTemplateRequest(name="From Page", scope="space"),
        admin,
        dep_svc,
        space_service,
        session,  # type: ignore[arg-type]
    )
    assert saved.name == "From Page"

    # Page not in space -> 404
    with pytest.raises(NotFoundError):
        await templates_api.save_page_as_template(
            "ENG",
            other_page.id,
            SavePageAsTemplateRequest(name="Wrong Space", scope="space"),
            admin,
            dep_svc,
            space_service,
            session,  # type: ignore[arg-type]
        )


# ---------------------------------------------------------------------------
# 6. Backup & Restore integration
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_backup_export_and_restore_page_templates_roundtrip() -> None:
    admin = _make_user(username="admin", is_superuser=True)
    eng = _make_space(key="ENG", name="Engineering")
    ops = _make_space(key="OPS", name="Operations")

    global_tpl = _make_template(
        scope="global",
        space_id=None,
        name="Company Standard",
        description="Global desc",
        category="general",
        icon="star",
        content="<h2>Standard</h2><p>Hi</p>",
        created_by_id=admin.id,
        updated_by_id=admin.id,
    )
    eng_tpl = _make_template(
        scope="space",
        space_id=eng.id,
        name="ENG Design Doc",
        content="# Design",
        content_format="markdown",
        created_by_id=admin.id,
    )
    ops_tpl = _make_template(
        scope="space",
        space_id=ops.id,
        name="OPS Only Doc",
        content="<p>Ops</p>",
    )

    # Export scoped to ENG only -> includes global_tpl + eng_tpl, excludes ops_tpl
    execute_results = [
        [admin],  # users
        [eng],  # spaces
        [],  # members
        [],  # owners
        [],  # favorites
        [],  # groups
        [],  # group_members
        [],  # group_permissions
        [],  # group_owner_rows
        [],  # permission_overrides
        [],  # space_user_permissions
        [],  # space_group_permissions
        [],  # pages
        [],  # revisions
        [],  # likes
        [],  # shares
        [],  # pins
        [],  # drafts
        [],  # user_tags
        [],  # user_page_labels
        [],  # page_user_restrictions
        [],  # page_group_restrictions
        [global_tpl, eng_tpl, ops_tpl],  # page_templates
    ]
    call_idx = 0

    async def _fake_execute(_stmt: Any) -> _FakeExecuteResult:
        nonlocal call_idx
        res = _FakeExecuteResult(execute_results[call_idx])
        call_idx += 1
        return res

    export_service = MagicMock()
    export_service.session = MagicMock()
    export_service.session.execute = AsyncMock(side_effect=_fake_execute)
    export_service._load_comments = AsyncMock(return_value=([], []))
    export_service._issue_entries = AsyncMock(return_value=([], {}))
    export_service.site_settings.read = AsyncMock(
        return_value=SimpleNamespace(overrides=SimpleNamespace(model_dump=lambda: {}))
    )
    export_service.site_settings.get_effective = AsyncMock(
        return_value=SimpleNamespace(site_name="WikiHub")
    )
    export_service.audit.record = AsyncMock()

    doc = await backup_exporter.export_document(export_service, space_keys=["ENG"])
    assert doc.wikihub_backup.counts["page_templates"] == 2
    assert {t.name for t in doc.page_templates} == {"Company Standard", "ENG Design Doc"}

    # Backward compatibility: archive JSON without `page_templates` still parses
    legacy_payload = doc.model_dump(mode="json")
    legacy_payload.pop("page_templates")
    legacy_doc = BackupDocument.model_validate(legacy_payload)
    assert legacy_doc.page_templates == []

    # Restore into a fresh target session
    stored_templates: dict[uuid.UUID, PageTemplate] = {}

    class _RestoreSession:
        def add(self, obj: Any) -> None:
            if isinstance(obj, PageTemplate):
                stored_templates[obj.id] = obj

        async def flush(self) -> None:
            return None

        async def get(self, model: type[Any], ident: uuid.UUID) -> Any:
            if model is PageTemplate:
                return stored_templates.get(ident)
            return None

        async def execute(self, stmt: Any) -> _FakeExecuteResult:
            params = stmt.compile().params
            name_val = next((v for k, v in params.items() if "name" in k), None)
            scope_val = next((v for k, v in params.items() if "scope" in k), None)
            space_val = next((v for k, v in params.items() if "space_id" in k), None)
            matches = [
                t
                for t in stored_templates.values()
                if t.name == name_val
                and t.scope == scope_val
                and (t.space_id == space_val if scope_val == "space" else t.space_id is None)
            ]
            return _FakeExecuteResult(matches)

    restore_service = MagicMock()
    restore_service.session = _RestoreSession()
    restore_service.users.get_protected = AsyncMock(return_value=None)
    restore_service.users.get_by_username = AsyncMock(
        side_effect=lambda u: admin if u == "admin" else None
    )
    restore_service.spaces.get_by_key = AsyncMock(
        side_effect=lambda k: eng if k == "ENG" else None
    )

    restore_doc = BackupDocument(
        wikihub_backup=BackupMeta(
            exported_at=datetime.now(UTC),
            app_version="1.0.0",
            site_name="WikiHub",
            includes_credentials=False,
        ),
        page_templates=[
            *doc.page_templates,
            # Missing space -> skipped
            BackupPageTemplate(
                id=uuid.uuid4(),
                scope="space",
                space_key="MISSING",
                name="Orphan",
            ),
            # Blank name -> skipped
            BackupPageTemplate(
                id=uuid.uuid4(),
                scope="global",
                name="   ",
            ),
            # Dirty HTML -> sanitized on restore
            BackupPageTemplate(
                id=uuid.uuid4(),
                scope="global",
                name="Dirty HTML",
                content="<script>evil()</script><p>Safe</p>",
                content_format="html",
            ),
        ],
    )

    report = _ReportBuilder()
    await backup_importer.apply_document(restore_service, restore_doc, report, [])
    assert report.created.get("page_template") == 3
    assert report.skipped.get("page_template") == 2
    assert len(stored_templates) == 3

    dirty_restored = next(t for t in stored_templates.values() if t.name == "Dirty HTML")
    assert "<script" not in dirty_restored.content
    assert "<p>Safe</p>" in dirty_restored.content

    # Idempotency: re-applying the same document skips all existing templates (by id and by name)
    second_doc = restore_doc.model_copy(
        update={
            "page_templates": [
                doc.page_templates[0],  # same ID
                doc.page_templates[1].model_copy(update={"id": uuid.uuid4()}),  # same (scope, space, name)
            ]
        }
    )
    report2 = _ReportBuilder()
    await backup_importer.apply_document(restore_service, second_doc, report2, [])
    assert report2.created.get("page_template", 0) == 0
    assert report2.skipped.get("page_template") == 2
