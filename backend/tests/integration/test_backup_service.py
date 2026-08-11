"""Instance backup and restore.

The headline behaviours: a round trip must reproduce the instance, a dry run
must change nothing yet predict the real run exactly, conflicts must be skipped
rather than overwritten, and a backup must never be able to introduce a
protected account.
"""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AuthenticationError, BadRequestError
from app.models.space import SpaceRole
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.backup.service import BackupService
from app.modules.spaces.service import SpaceService
from app.schemas.backup import BackupDocument
from app.schemas.space import SpaceCreate
from app.schemas.user import UserCreate
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
    for table in ("space_favorites", "space_members", "spaces", "users"):
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
