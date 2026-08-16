"""Instance backup and restore.

The headline behaviours: a round trip must reproduce the instance, a dry run
must change nothing yet predict the real run exactly, conflicts must be skipped
rather than overwritten, and a backup must never be able to introduce a
protected account.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AuthenticationError, BadRequestError
from app.models.attachment import PageAttachment
from app.models.page import PageLike, WikiPage
from app.models.permission import (
    GlobalPermission,
    Group,
    GroupGlobalPermission,
    GroupMember,
    Permission,
    SpaceGroupPermission,
)
from app.models.restriction import PageGroupRestriction, PageRestrictionPermission
from app.models.revision import PageRevision
from app.models.space import Space, SpaceRole, SpaceVisibility
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.backup.service import BackupService
from app.modules.spaces.service import SpaceService
from app.schemas.backup import BackupDocument
from app.schemas.space import SpaceCreate
from app.schemas.user import UserCreate
from app.services.storage import ObjectStorage
from tests.integration.conftest import unique

pytestmark = pytest.mark.integration


async def _seed_instance(session: AsyncSession) -> dict[str, object]:
    """Two users, one protected admin, one space with a member and a favourite."""
    auth = AuthService(session)
    spaces = SpaceService(session)

    admin, _ = await auth.ensure_bootstrap_admin(
        username="admin", password="admin123", email="admin@wikihub.local", full_name="Admin"
    )
    alice = await auth.create_user(
        UserCreate(
            username="alice", email="alice@example.com", full_name="Alice", password="alice-pass-1"
        )
    )
    bob = await auth.create_user(
        UserCreate(username="bob", email="bob@example.com", full_name="Bob", password="bob-pass-12")
    )

    space = await spaces.create(SpaceCreate(key="ENG", name="Engineering"), alice)
    await spaces.set_member(space, alice, bob.id, SpaceRole.editor)
    await spaces.set_favorite(space, alice, True)

    return {"admin": admin, "alice": alice, "bob": bob, "space": space}


async def _count(session: AsyncSession, model: type) -> int:
    return len((await session.execute(select(model))).scalars().all())


async def _wipe(session: AsyncSession) -> None:
    """Empty the instance, child tables first."""
    for table in (
        "page_group_restrictions",
        "page_user_restrictions",
        "page_likes",
        "page_revisions",
        "pages",
        "space_group_permissions",
        "space_user_permissions",
        "group_global_permissions",
        "group_members",
        "groups",
        "space_favorites",
        "space_members",
        "spaces",
        "users",
    ):
        await session.execute(text(f"DELETE FROM {table}"))
    await session.flush()
    session.expunge_all()


class TestExport:
    async def test_excludes_password_hashes_by_default(self, session: AsyncSession) -> None:
        seeded = await _seed_instance(session)
        service = BackupService(session, actor=seeded["admin"])  # type: ignore[arg-type]

        doc = await service.export_document()

        assert doc.wikihub_backup.includes_credentials is False
        assert all(u.password_hash is None for u in doc.users)
        # Belt and braces: no hash may survive anywhere in the serialised file.
        assert "$argon2" not in doc.model_dump_json()

    async def test_includes_hashes_when_opted_in(self, session: AsyncSession) -> None:
        seeded = await _seed_instance(session)
        service = BackupService(session, actor=seeded["admin"])  # type: ignore[arg-type]

        doc = await service.export_document(include_credentials=True)

        assert doc.wikihub_backup.includes_credentials is True
        assert any(u.password_hash and u.password_hash.startswith("$argon2") for u in doc.users)

    async def test_counts_match_the_payload(self, session: AsyncSession) -> None:
        seeded = await _seed_instance(session)
        doc = await BackupService(session, actor=seeded["admin"]).export_document()  # type: ignore[arg-type]

        counts = doc.wikihub_backup.counts
        assert counts["users"] == len(doc.users) == 3
        assert counts["spaces"] == len(doc.spaces) == 1
        assert counts["space_members"] == len(doc.space_members)
        assert counts["space_favorites"] == len(doc.space_favorites) == 1


class TestRoundTrip:
    async def test_full_zip_restores_attachment_and_internal_avatar(
        self, session: AsyncSession, tmp_path: Path
    ) -> None:
        seeded = await _seed_instance(session)
        alice: User = seeded["alice"]  # type: ignore[assignment]
        space: Space = seeded["space"]  # type: ignore[assignment]
        page = WikiPage(space_id=space.id, title="Files", slug="files", content="<p>files</p>")
        session.add(page)
        await session.flush()
        session.add(
            PageAttachment(
                page_id=page.id,
                filename="guide.txt",
                content_type="text/plain",
                object_key="attachments/source-guide.txt",
            )
        )
        alice.avatar_object_key = "avatars/source-alice.png"
        alice.avatar_content_type = "image/png"
        alice.avatar_url = "/api/v1/users/source/avatar"
        objects = {
            "attachments/source-guide.txt": b"important file bytes",
            "avatars/source-alice.png": b"avatar bytes",
        }

        async def get(key: str) -> bytes:
            return objects[key]

        async def put(key: str, data: bytes, **_kwargs: object) -> None:
            objects[key] = data

        async def delete(key: str) -> None:
            objects.pop(key, None)

        storage = cast(ObjectStorage, SimpleNamespace(get=get, put=put, delete=delete))
        archive = str(tmp_path / "full.zip")
        await BackupService(session, actor=seeded["admin"]).export_full_package(archive, storage)  # type: ignore[arg-type]
        await _wipe(session)

        report = await BackupService(session).restore_full_package(archive, storage, dry_run=False)
        restored_page = (
            await session.execute(select(WikiPage).where(WikiPage.slug == "files"))
        ).scalar_one()
        restored_attachment = (
            await session.execute(
                select(PageAttachment).where(PageAttachment.page_id == restored_page.id)
            )
        ).scalar_one()
        restored_alice = await AuthService(session).users.get_by_username("alice")
        assert objects[restored_attachment.object_key] == b"important file bytes"
        assert restored_alice is not None
        assert restored_alice.avatar_object_key is not None
        assert objects[restored_alice.avatar_object_key] == b"avatar bytes"
        assert report.created["attachment"] == 1
        assert report.created["avatar"] == 1

    async def test_full_zip_overwrite_replaces_pages_but_keeps_space_membership(
        self, session: AsyncSession, tmp_path: Path
    ) -> None:
        seeded = await _seed_instance(session)
        space: Space = seeded["space"]  # type: ignore[assignment]
        source_page = WikiPage(
            space_id=space.id, title="Source", slug="home", content="source content"
        )
        session.add(source_page)
        await session.flush()
        session.add(
            PageAttachment(
                page_id=source_page.id,
                filename="source.txt",
                content_type="text/plain",
                object_key="attachments/source.txt",
            )
        )
        objects = {"attachments/source.txt": b"source"}

        async def get(key: str) -> bytes:
            return objects[key]

        async def put(key: str, data: bytes, **_kwargs: object) -> None:
            objects[key] = data

        async def delete_object(key: str) -> None:
            objects.pop(key, None)

        storage = cast(ObjectStorage, SimpleNamespace(get=get, put=put, delete=delete_object))
        archive = str(tmp_path / "overwrite.zip")
        await BackupService(session, actor=seeded["admin"]).export_full_package(archive, storage)  # type: ignore[arg-type]

        await session.execute(
            delete(PageAttachment).where(PageAttachment.page_id == source_page.id)
        )
        await session.execute(delete(WikiPage).where(WikiPage.id == source_page.id))
        target_page = WikiPage(
            space_id=space.id, title="Target", slug="home", content="target content"
        )
        session.add(target_page)
        await session.flush()
        session.add(
            PageAttachment(
                page_id=target_page.id,
                filename="old.txt",
                content_type="text/plain",
                object_key="attachments/old.txt",
            )
        )
        objects["attachments/old.txt"] = b"old"

        await BackupService(session).restore_full_package(
            archive, storage, dry_run=False, overwrite_space_keys={"ENG"}
        )
        restored = (
            await session.execute(
                select(WikiPage).where(WikiPage.space_id == space.id, WikiPage.slug == "home")
            )
        ).scalar_one()
        assert restored.content == "source content"
        assert await SpaceService(session).role_of(space, seeded["bob"]) is SpaceRole.editor  # type: ignore[arg-type]
        attachment = (
            await session.execute(
                select(PageAttachment).where(PageAttachment.page_id == restored.id)
            )
        ).scalar_one()
        assert objects[attachment.object_key] == b"source"
        assert "attachments/old.txt" not in objects

    async def test_restores_pages_groups_permissions_and_profile_fields(
        self, session: AsyncSession
    ) -> None:
        seeded = await _seed_instance(session)
        alice: User = seeded["alice"]  # type: ignore[assignment]
        bob: User = seeded["bob"]  # type: ignore[assignment]
        space = seeded["space"]
        space.visibility = SpaceVisibility.restricted
        alice.bio = "Knowledge keeper"
        alice.pronouns = "she/her"
        alice.profile_url = "https://example.com/alice"
        alice.social_links = ["https://example.com/alice/social"]
        alice.company = "WikiHub"

        group = Group(name="Authors", description="Writers", owner_id=alice.id)
        session.add(group)
        await session.flush()
        session.add_all(
            [
                GroupMember(group_id=group.id, user_id=bob.id),
                GroupGlobalPermission(group_id=group.id, permission=GlobalPermission.manage_groups),
                SpaceGroupPermission(
                    space_id=space.id, group_id=group.id, permission=Permission.view
                ),
            ]
        )
        parent = WikiPage(
            space_id=space.id,
            title="Overview",
            slug="overview",
            content="Parent content",
            created_by_id=alice.id,
            updated_by_id=alice.id,
        )
        session.add(parent)
        await session.flush()
        child = WikiPage(
            space_id=space.id,
            parent_id=parent.id,
            title="Child",
            slug="child",
            content="Child content",
            created_by_id=bob.id,
            updated_by_id=bob.id,
        )
        session.add(child)
        await session.flush()
        session.add_all(
            [
                PageRevision(
                    page_id=child.id,
                    version=1,
                    title="Child",
                    content="Child content",
                    created_by_id=bob.id,
                    change_summary="Initial version",
                ),
                PageLike(page_id=child.id, user_id=alice.id),
                PageGroupRestriction(
                    page_id=child.id,
                    group_id=group.id,
                    permission=PageRestrictionPermission.view,
                ),
            ]
        )
        await session.flush()

        document = await BackupService(session, actor=seeded["admin"]).export_document()  # type: ignore[arg-type]
        assert document.wikihub_backup.version == 2
        assert len(document.pages) >= 2
        assert document.groups[0].name == "Authors"
        await _wipe(session)

        report = await BackupService(session).import_document(document, dry_run=False)

        restored_alice = await AuthService(session).users.get_by_username("alice")
        assert restored_alice is not None and restored_alice.bio == "Knowledge keeper"
        restored_space = await SpaceService(session).get_by_key("ENG")
        assert restored_space.visibility is SpaceVisibility.restricted
        restored_child = (
            await session.execute(select(WikiPage).where(WikiPage.slug == "child"))
        ).scalar_one()
        restored_parent = (
            await session.execute(select(WikiPage).where(WikiPage.slug == "overview"))
        ).scalar_one()
        assert restored_child.parent_id == restored_parent.id
        assert report.created["group"] == 1
        assert report.created["page"] == len(document.pages)
        assert report.created["page_revision"] == 1
        assert report.created["page_like"] == 1
        assert report.created["page_group_restriction"] == 1

    async def test_restores_into_an_empty_instance(self, session: AsyncSession) -> None:
        """The behaviour the whole feature exists for."""
        seeded = await _seed_instance(session)
        doc = await BackupService(session, actor=seeded["admin"]).export_document(  # type: ignore[arg-type]
            include_credentials=True
        )
        original_space_id = doc.spaces[0].id

        # Wipe everything, then restore from the document.
        await _wipe(session)

        report = await BackupService(session).import_document(doc, dry_run=False)

        assert report.created["user"] == 3
        assert report.created["space"] == 1
        assert report.created["space_favorite"] == 1

        auth = AuthService(session)
        restored_alice = await auth.users.get_by_username("alice")
        assert restored_alice is not None
        # Identity is preserved, so an operator's existing references still line up.
        spaces = SpaceService(session)
        restored_space = await spaces.get_by_key("ENG")
        assert restored_space.id == original_space_id
        # Membership survived, resolved through natural keys.
        assert await spaces.role_of(restored_space, restored_alice) is SpaceRole.admin

    async def test_credentials_survive_when_exported(self, session: AsyncSession) -> None:
        seeded = await _seed_instance(session)
        doc = await BackupService(session, actor=seeded["admin"]).export_document(  # type: ignore[arg-type]
            include_credentials=True
        )
        await _wipe(session)

        await BackupService(session).import_document(doc, dry_run=False)

        assert (
            await AuthService(session).authenticate("alice", "alice-pass-1")
        ).username == "alice"

    async def test_restored_user_without_a_hash_cannot_sign_in_until_reset(
        self, session: AsyncSession
    ) -> None:
        """The documented consequence of the credential-free default."""
        seeded = await _seed_instance(session)
        doc = await BackupService(session, actor=seeded["admin"]).export_document()  # type: ignore[arg-type]
        await _wipe(session)

        report = await BackupService(session).import_document(doc, dry_run=False)

        assert "alice" in report.users_without_password

        auth = AuthService(session)
        with pytest.raises(AuthenticationError):
            await auth.authenticate("alice", "alice-pass-1")

        # The admin reset endpoint is the recovery path.
        restored = await auth.users.get_by_username("alice")
        assert restored is not None
        await auth.reset_password(restored.id, "a-fresh-password-1")
        assert (await auth.authenticate("alice", "a-fresh-password-1")).id == restored.id


class TestDryRun:
    async def test_late_restore_error_rolls_back_every_written_row(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seeded = await _seed_instance(session)
        document = await BackupService(session, actor=seeded["admin"]).export_document()  # type: ignore[arg-type]
        await _wipe(session)
        service = BackupService(session)

        async def write_then_fail(*_args: object) -> None:
            session.add(
                User(
                    username="partial",
                    email="partial@example.com",
                    full_name="Partial",
                    is_active=True,
                    is_superuser=False,
                    is_protected=False,
                )
            )
            await session.flush()
            raise RuntimeError("forced late restore failure")

        monkeypatch.setattr(service, "_apply", write_then_fail)
        with pytest.raises(RuntimeError, match="forced late restore failure"):
            await service.import_document(document, dry_run=False)

        assert await _count(session, User) == 0

    async def test_changes_nothing(self, session: AsyncSession) -> None:
        seeded = await _seed_instance(session)
        doc = await BackupService(session, actor=seeded["admin"]).export_document()  # type: ignore[arg-type]
        await _wipe(session)

        report = await BackupService(session).import_document(doc, dry_run=True)

        assert report.created["user"] == 3
        # ...but nothing was actually written.
        assert await _count(session, User) == 0

    async def test_predicts_the_real_run_exactly(self, session: AsyncSession) -> None:
        """What makes the preview trustworthy."""
        seeded = await _seed_instance(session)
        doc = await BackupService(session, actor=seeded["admin"]).export_document()  # type: ignore[arg-type]
        await _wipe(session)

        preview = await BackupService(session).import_document(doc, dry_run=True)
        applied = await BackupService(session).import_document(doc, dry_run=False)

        assert preview.created == applied.created
        assert preview.skipped == applied.skipped
        assert preview.errors == applied.errors


class TestConflicts:
    async def test_existing_username_is_skipped_not_overwritten(
        self, session: AsyncSession
    ) -> None:
        seeded = await _seed_instance(session)
        doc = await BackupService(session, actor=seeded["admin"]).export_document(  # type: ignore[arg-type]
            include_credentials=True
        )

        auth = AuthService(session)
        before = await auth.users.get_by_username("alice")
        assert before is not None
        original_hash, original_email = before.password_hash, before.email

        report = await BackupService(session).import_document(doc, dry_run=False)

        assert report.skipped["user"] == 3
        assert "user" not in report.created
        after = await auth.users.get_by_username("alice")
        assert after is not None
        assert after.password_hash == original_hash
        assert after.email == original_email

    async def test_existing_space_key_is_skipped(self, session: AsyncSession) -> None:
        seeded = await _seed_instance(session)
        doc = await BackupService(session, actor=seeded["admin"]).export_document()  # type: ignore[arg-type]

        report = await BackupService(session).import_document(doc, dry_run=False)

        assert report.skipped["space"] == 1
        reasons = {e.reason for e in report.entries if e.kind == "space"}
        assert reasons == {"key_exists"}


class TestProtectedAccountShielding:
    async def test_backup_user_never_becomes_protected(self, session: AsyncSession) -> None:
        """The single most important guarantee in the importer."""
        seeded = await _seed_instance(session)
        doc = await BackupService(session, actor=seeded["admin"]).export_document()  # type: ignore[arg-type]

        # A hostile/foreign document claiming a protected account.
        rogue = doc.users[0].model_copy(
            update={
                "username": unique("rogue"),
                "email": f"{unique('rogue')}@example.com",
                "is_protected": True,
                "is_superuser": True,
                "id": uuid.uuid4(),
            }
        )
        doc.users = [rogue]

        await BackupService(session).import_document(doc, dry_run=False)

        created = await AuthService(session).users.get_by_username(rogue.username)
        assert created is not None
        assert created.is_protected is False

    async def test_collision_with_the_local_protected_admin_is_skipped(
        self, session: AsyncSession
    ) -> None:
        seeded = await _seed_instance(session)
        admin: User = seeded["admin"]  # type: ignore[assignment]
        original_hash = admin.password_hash

        doc = await BackupService(session, actor=admin).export_document(include_credentials=True)

        report = await BackupService(session).import_document(doc, dry_run=False)

        reasons = {e.reason for e in report.entries if e.label == "admin"}
        assert reasons == {"conflicts_with_protected_account"}
        # The local protected account is untouched.
        assert admin.password_hash == original_hash
        assert admin.is_protected is True


class TestMalformedInput:
    async def test_unsupported_version_is_rejected(self, session: AsyncSession) -> None:
        seeded = await _seed_instance(session)
        doc = await BackupService(session, actor=seeded["admin"]).export_document()  # type: ignore[arg-type]
        payload = json.loads(doc.model_dump_json())
        payload["wikihub_backup"]["version"] = 99

        # Version is a Literal, so the schema itself refuses to build.
        with pytest.raises(Exception) as excinfo:
            BackupDocument.model_validate(payload)
        assert "version" in str(excinfo.value)

    async def test_service_rejects_a_mismatched_version(self, session: AsyncSession) -> None:
        seeded = await _seed_instance(session)
        doc = await BackupService(session, actor=seeded["admin"]).export_document()  # type: ignore[arg-type]
        # Bypass schema validation to reach the service-level guard.
        object.__setattr__(doc.wikihub_backup, "version", 99)

        with pytest.raises(BadRequestError, match="Unsupported backup version"):
            await BackupService(session).import_document(doc, dry_run=True)
