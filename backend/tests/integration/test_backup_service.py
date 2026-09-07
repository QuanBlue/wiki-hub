"""Instance backup and restore.

The headline behaviours: a round trip must reproduce the instance, a dry run
must change nothing yet predict the real run exactly, conflicts must be skipped
rather than overwritten, and a backup must never be able to introduce a
protected account.
"""

from __future__ import annotations

import json
import uuid
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AuthenticationError, BadRequestError
from app.models.attachment import PageAttachment
from app.models.backup_job import BackupJob
from app.models.draft import PageDraft
from app.models.page import PageLike, UserPagePin, WikiPage
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
from app.models.space import Space, SpaceRole, SpaceStatus, SpaceVisibility
from app.models.user import User
from app.models.user_page_label import UserPageLabel
from app.models.user_tag import UserTag
from app.modules.auth.service import AuthService
from app.modules.backup.jobs import create_export_job, reap_abandoned_export_jobs, run_backup_job
from app.modules.backup.service import STALE_JOB_AFTER, STALE_RESTORE_JOB_AFTER, BackupService
from app.modules.spaces.service import SpaceService
from app.schemas.backup import BACKUP_VERSION, BackupDocument
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

    async def test_document_scopes_to_selected_spaces(self, session: AsyncSession) -> None:
        seeded = await _seed_instance(session)
        alice: User = seeded["alice"]  # type: ignore[assignment]
        eng: Space = seeded["space"]  # type: ignore[assignment]
        sales = await SpaceService(session).create(SpaceCreate(key="SALES", name="Sales"), alice)
        session.add(WikiPage(space_id=eng.id, title="Eng Home", slug="home", content="<p>eng</p>"))
        session.add(
            WikiPage(space_id=sales.id, title="Sales Home", slug="home", content="<p>sales</p>")
        )
        await session.flush()

        service = BackupService(session, actor=seeded["admin"])  # type: ignore[arg-type]
        doc = await service.export_document(space_keys=["ENG"])

        assert [s.key for s in doc.spaces] == ["ENG"]
        assert {p.space_key for p in doc.pages} == {"ENG"}
        assert doc.wikihub_backup.space_keys == ["ENG"]
        # Users/groups stay fully included regardless of the space scope -
        # a restore into a fresh instance still needs the whole identity
        # graph for the included space's permissions to resolve.
        assert len(doc.users) == 3

        unscoped = await service.export_document()
        assert {s.key for s in unscoped.spaces} == {"ENG", "SALES"}
        assert unscoped.wikihub_backup.space_keys == []


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
            # Restore now streams attachment/avatar bytes via `archive.open()`
            # handles rather than materialising them first, so this fake
            # storage - unlike the real S3-backed one, which reads any
            # file-like `Body` itself - has to read the handle the same way.
            objects[key] = data.read() if hasattr(data, "read") else data

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

    async def test_replacing_a_space_repairs_content_whose_attachment_links_are_stale(
        self, session: AsyncSession, tmp_path: Path
    ) -> None:
        """The end state of an instance restored by a build without attachment

        id preservation: the page content still names the *original* ids while
        the attachment rows carry freshly minted ones. Every export taken from
        that instance inherits the mismatch, so restoring one - however
        faithfully - reproduces broken links. Replacing the space has to
        rebuild the linkage from each reference's filename, not copy it.
        """
        seeded = await _seed_instance(session)
        space: Space = seeded["space"]  # type: ignore[assignment]
        # A link pointing at an id no attachment has ever had, exactly as the
        # broken instance stores it.
        orphaned_id = uuid.uuid4()
        page = WikiPage(
            space_id=space.id,
            title="Resources",
            slug="resources",
            content=(
                '<a class="attachment-link" data-attachment="guide.pdf" '
                f'href="/api/v1/attachments/{orphaned_id}/content">guide.pdf</a>'
            ),
        )
        session.add(page)
        await session.flush()
        session.add(
            PageAttachment(
                page_id=page.id,
                filename="guide.pdf",
                content_type="application/pdf",
                object_key="attachments/source-guide.pdf",
            )
        )
        objects = {"attachments/source-guide.pdf": b"pdf bytes"}

        async def get(key: str) -> bytes:
            return objects[key]

        async def put(key: str, data: bytes, **_kwargs: object) -> None:
            # Restore now streams attachment/avatar bytes via `archive.open()`
            # handles rather than materialising them first, so this fake
            # storage - unlike the real S3-backed one, which reads any
            # file-like `Body` itself - has to read the handle the same way.
            objects[key] = data.read() if hasattr(data, "read") else data

        async def delete_object(key: str) -> None:
            objects.pop(key, None)

        storage = cast(ObjectStorage, SimpleNamespace(get=get, put=put, delete=delete_object))
        archive = str(tmp_path / "stale-links.zip")
        await BackupService(session, actor=seeded["admin"]).export_full_package(archive, storage)  # type: ignore[arg-type]

        # The archive is internally inconsistent, which is the whole point.
        with zipfile.ZipFile(archive) as bundle:
            exported = json.loads(bundle.read("data/workspace.json"))
        exported_ids = {entry["id"] for entry in exported["attachments"]}
        assert str(orphaned_id) not in exported_ids

        # The space already exists, so this is the "Replace and restore" path.
        report = await BackupService(session).restore_full_package(
            archive, storage, dry_run=False, overwrite_space_keys={"ENG"}
        )

        restored_page = (
            await session.execute(
                select(WikiPage).where(WikiPage.space_id == space.id, WikiPage.slug == "resources")
            )
        ).scalar_one()
        restored_attachment = (
            await session.execute(
                select(PageAttachment).where(PageAttachment.page_id == restored_page.id)
            )
        ).scalar_one()
        assert f"/api/v1/attachments/{restored_attachment.id}/content" in restored_page.content
        assert str(orphaned_id) not in restored_page.content
        assert report.created["relinked_page"] == 1
        assert objects[restored_attachment.object_key] == b"pdf bytes"

    async def test_overwrite_restore_observes_cancellation_without_committing(
        self, session: AsyncSession, tmp_path: Path
    ) -> None:
        """The file-copy phase of an overwrite restore runs inside a still-open
        SAVEPOINT (see `restore_savepoint` above `_report_progress`), so it
        cannot checkpoint the normal way - a commit there would release the
        savepoint early. It still has to notice a cancel request, just via a
        plain read instead. This exercises that read succeeding (not
        cancelled) with a job tracking the restore, which only happens once
        there is at least one attachment/avatar to copy.
        """
        seeded = await _seed_instance(session)
        space: Space = seeded["space"]  # type: ignore[assignment]
        page = WikiPage(space_id=space.id, title="Files", slug="files", content="<p>files</p>")
        session.add(page)
        await session.flush()
        session.add(
            PageAttachment(
                page_id=page.id,
                filename="guide.pdf",
                content_type="application/pdf",
                object_key="attachments/source-guide.pdf",
            )
        )
        objects = {"attachments/source-guide.pdf": b"pdf bytes"}

        async def get(key: str) -> bytes:
            return objects[key]

        async def put(key: str, data: bytes, **_kwargs: object) -> None:
            objects[key] = data.read() if hasattr(data, "read") else data

        async def delete_object(key: str) -> None:
            objects.pop(key, None)

        storage = cast(ObjectStorage, SimpleNamespace(get=get, put=put, delete=delete_object))
        archive = str(tmp_path / "overwrite-with-job.zip")
        await BackupService(session, actor=seeded["admin"]).export_full_package(archive, storage)  # type: ignore[arg-type]

        job = BackupJob(kind="full_import", status="running", phase="restoring", cancel_requested=False)
        session.add(job)
        await session.flush()

        report = await BackupService(session).restore_full_package(
            archive, storage, dry_run=False, overwrite_space_keys={"ENG"}, job=job
        )

        assert report.created["attachment"] == 1

    async def test_full_zip_restore_leaves_already_valid_attachment_links_untouched(
        self, session: AsyncSession, tmp_path: Path
    ) -> None:
        """The repair pass must be inert on a consistent archive.

        Only a reference that fails to resolve is rebuilt, so a healthy round
        trip reproduces the content exactly and never reports a relink.
        """
        seeded = await _seed_instance(session)
        space: Space = seeded["space"]  # type: ignore[assignment]
        page = WikiPage(
            space_id=space.id, title="Resources", slug="resources", content="<p>placeholder</p>"
        )
        session.add(page)
        await session.flush()
        attachment = PageAttachment(
            page_id=page.id,
            filename="guide.pdf",
            content_type="application/pdf",
            object_key="attachments/source-guide.pdf",
        )
        session.add(attachment)
        await session.flush()
        # A correctly-linked page, the way the editor writes one.
        page.content = (
            '<a class="attachment-link" data-attachment="guide.pdf" '
            f'href="/api/v1/attachments/{attachment.id}/content">guide.pdf</a>'
        )
        original_content = page.content
        objects = {"attachments/source-guide.pdf": b"pdf bytes"}

        async def get(key: str) -> bytes:
            return objects[key]

        async def put(key: str, data: bytes, **_kwargs: object) -> None:
            # Restore now streams attachment/avatar bytes via `archive.open()`
            # handles rather than materialising them first, so this fake
            # storage - unlike the real S3-backed one, which reads any
            # file-like `Body` itself - has to read the handle the same way.
            objects[key] = data.read() if hasattr(data, "read") else data

        async def delete_object(key: str) -> None:
            objects.pop(key, None)

        storage = cast(ObjectStorage, SimpleNamespace(get=get, put=put, delete=delete_object))
        archive = str(tmp_path / "healthy.zip")
        await BackupService(session, actor=seeded["admin"]).export_full_package(archive, storage)  # type: ignore[arg-type]
        await _wipe(session)

        report = await BackupService(session).restore_full_package(archive, storage, dry_run=False)

        restored_page = (
            await session.execute(select(WikiPage).where(WikiPage.slug == "resources"))
        ).scalar_one()
        assert restored_page.content == original_content
        assert "relinked_page" not in report.created

    async def test_full_zip_restores_attachment_when_source_space_key_is_lowercase(
        self, session: AsyncSession, tmp_path: Path
    ) -> None:
        """Restoring a space recreates its key upper-cased (``_apply`` does

        ``key.strip().upper()``), but a source space's key isn't guaranteed
        to already be upper-case - ``SpaceCreate`` normalises it on that
        path, but a space created outside it (Confluence import inserts
        ``Space`` rows directly, preserving whatever case the source system
        used) can carry a lowercase key. The attachment-restore lookup must
        match the two case-insensitively or every attachment on such a space
        silently fails to re-attach, even though its page restores fine.
        """
        seeded = await _seed_instance(session)
        lower_space = Space(
            key="devsecops",
            name="DevSecOps",
            description="",
            icon="",
            status=SpaceStatus.active,
            visibility=SpaceVisibility.open,
            created_by_id=seeded["alice"].id,  # type: ignore[union-attr]
        )
        session.add(lower_space)
        await session.flush()
        page = WikiPage(
            space_id=lower_space.id, title="Files", slug="files", content="<p>files</p>"
        )
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
        objects = {"attachments/source-guide.txt": b"important file bytes"}

        async def get(key: str) -> bytes:
            return objects[key]

        async def put(key: str, data: bytes, **_kwargs: object) -> None:
            # Restore now streams attachment/avatar bytes via `archive.open()`
            # handles rather than materialising them first, so this fake
            # storage - unlike the real S3-backed one, which reads any
            # file-like `Body` itself - has to read the handle the same way.
            objects[key] = data.read() if hasattr(data, "read") else data

        async def delete(key: str) -> None:
            objects.pop(key, None)

        storage = cast(ObjectStorage, SimpleNamespace(get=get, put=put, delete=delete))
        archive = str(tmp_path / "full.zip")
        await BackupService(session, actor=seeded["admin"]).export_full_package(archive, storage)  # type: ignore[arg-type]
        await _wipe(session)

        report = await BackupService(session).restore_full_package(archive, storage, dry_run=False)
        restored_space = (
            await session.execute(select(Space).where(Space.key == "DEVSECOPS"))
        ).scalar_one()
        restored_page = (
            await session.execute(
                select(WikiPage).where(
                    WikiPage.space_id == restored_space.id, WikiPage.slug == "files"
                )
            )
        ).scalar_one()
        restored_attachment = (
            await session.execute(
                select(PageAttachment).where(PageAttachment.page_id == restored_page.id)
            )
        ).scalar_one()
        assert objects[restored_attachment.object_key] == b"important file bytes"
        assert report.created["attachment"] == 1

    async def test_full_zip_scoped_to_selected_spaces_restores_only_that_space(
        self, session: AsyncSession, tmp_path: Path
    ) -> None:
        seeded = await _seed_instance(session)
        alice: User = seeded["alice"]  # type: ignore[assignment]
        eng: Space = seeded["space"]  # type: ignore[assignment]
        sales = await SpaceService(session).create(SpaceCreate(key="SALES", name="Sales"), alice)
        eng_page = WikiPage(space_id=eng.id, title="Eng Home", slug="home", content="<p>eng</p>")
        sales_page = WikiPage(
            space_id=sales.id, title="Sales Home", slug="home", content="<p>sales</p>"
        )
        session.add_all([eng_page, sales_page])
        await session.flush()
        session.add_all(
            [
                PageAttachment(
                    page_id=eng_page.id,
                    filename="eng.txt",
                    content_type="text/plain",
                    object_key="attachments/eng.txt",
                ),
                PageAttachment(
                    page_id=sales_page.id,
                    filename="sales.txt",
                    content_type="text/plain",
                    object_key="attachments/sales.txt",
                ),
            ]
        )
        objects = {
            "attachments/eng.txt": b"eng bytes",
            "attachments/sales.txt": b"sales bytes",
        }

        async def get(key: str) -> bytes:
            return objects[key]

        async def put(key: str, data: bytes, **_kwargs: object) -> None:
            # Restore now streams attachment/avatar bytes via `archive.open()`
            # handles rather than materialising them first, so this fake
            # storage - unlike the real S3-backed one, which reads any
            # file-like `Body` itself - has to read the handle the same way.
            objects[key] = data.read() if hasattr(data, "read") else data

        async def delete(key: str) -> None:
            objects.pop(key, None)

        storage = cast(ObjectStorage, SimpleNamespace(get=get, put=put, delete=delete))
        archive = str(tmp_path / "scoped.zip")

        manifest = await BackupService(session, actor=seeded["admin"]).export_full_package(  # type: ignore[arg-type]
            archive, storage, space_keys=["ENG"]
        )
        assert manifest["counts"]["spaces"] == 1
        # SpaceService.create() auto-creates a "eng"-slug home page for ENG,
        # so scoping to ENG carries that page plus the "home" one added above
        # - both are ENG's, so 2 is the correct scoped count (SALES's own
        # auto page + "home" page, 2 more, are correctly excluded).
        assert manifest["counts"]["pages"] == 2
        assert manifest["counts"]["attachments"] == 1

        await _wipe(session)
        await BackupService(session).restore_full_package(archive, storage, dry_run=False)

        restored_spaces = (await session.execute(select(Space))).scalars().all()
        assert [s.key for s in restored_spaces] == ["ENG"]
        restored_pages = (await session.execute(select(WikiPage))).scalars().all()
        assert len(restored_pages) == 2
        restored_home = next(p for p in restored_pages if p.slug == "home")
        restored_attachment = (
            await session.execute(
                select(PageAttachment).where(PageAttachment.page_id == restored_home.id)
            )
        ).scalar_one()
        assert objects[restored_attachment.object_key] == b"eng bytes"
        # The full identity graph still restores even though only one space
        # was exported.
        restored_users = (await session.execute(select(User))).scalars().all()
        assert len(restored_users) == 3

    async def test_full_zip_restore_scoped_to_selected_spaces_skips_the_rest(
        self, session: AsyncSession, tmp_path: Path
    ) -> None:
        """Restore-side scoping (the "select spaces to restore" picker), as

        opposed to `test_full_zip_scoped_to_selected_spaces_restores_only_
        that_space` above, which scopes on export instead - here the archive
        carries every space and restore itself is asked to only apply one.
        """
        seeded = await _seed_instance(session)
        alice: User = seeded["alice"]  # type: ignore[assignment]
        eng: Space = seeded["space"]  # type: ignore[assignment]
        sales = await SpaceService(session).create(SpaceCreate(key="SALES", name="Sales"), alice)
        eng_page = WikiPage(space_id=eng.id, title="Eng Home", slug="home", content="<p>eng</p>")
        sales_page = WikiPage(
            space_id=sales.id, title="Sales Home", slug="home", content="<p>sales</p>"
        )
        session.add_all([eng_page, sales_page])
        await session.flush()
        session.add_all(
            [
                PageAttachment(
                    page_id=eng_page.id,
                    filename="eng.txt",
                    content_type="text/plain",
                    object_key="attachments/eng.txt",
                ),
                PageAttachment(
                    page_id=sales_page.id,
                    filename="sales.txt",
                    content_type="text/plain",
                    object_key="attachments/sales.txt",
                ),
            ]
        )
        objects = {
            "attachments/eng.txt": b"eng bytes",
            "attachments/sales.txt": b"sales bytes",
        }

        async def get(key: str) -> bytes:
            return objects[key]

        async def put(key: str, data: bytes, **_kwargs: object) -> None:
            # Restore now streams attachment/avatar bytes via `archive.open()`
            # handles rather than materialising them first, so this fake
            # storage - unlike the real S3-backed one, which reads any
            # file-like `Body` itself - has to read the handle the same way.
            objects[key] = data.read() if hasattr(data, "read") else data

        async def delete(key: str) -> None:
            objects.pop(key, None)

        storage = cast(ObjectStorage, SimpleNamespace(get=get, put=put, delete=delete))
        archive = str(tmp_path / "full.zip")

        # Unscoped export: the archive carries both ENG and SALES.
        manifest = await BackupService(session, actor=seeded["admin"]).export_full_package(  # type: ignore[arg-type]
            archive, storage
        )
        assert manifest["counts"]["spaces"] == 2

        await _wipe(session)
        report = await BackupService(session).restore_full_package(
            archive, storage, dry_run=False, space_keys={"eng"}  # lowercase: keys are matched case-insensitively
        )

        restored_spaces = (await session.execute(select(Space))).scalars().all()
        assert [s.key for s in restored_spaces] == ["ENG"]
        restored_pages = (await session.execute(select(WikiPage))).scalars().all()
        assert len(restored_pages) == 2  # ENG's auto-home page + the "home" page added above.
        assert {p.slug for p in restored_pages} == {"eng", "home"}
        restored_attachments = (await session.execute(select(PageAttachment))).scalars().all()
        assert len(restored_attachments) == 1
        assert objects[restored_attachments[0].object_key] == b"eng bytes"
        assert report.skipped.get("space", 0) == 0  # never created, not "skipped" - it just wasn't offered.

        # The identity graph (users) still restores in full regardless of scope.
        restored_users = (await session.execute(select(User))).scalars().all()
        assert len(restored_users) == 3

    async def test_full_zip_restore_reports_conflicting_space_keys(
        self, session: AsyncSession, tmp_path: Path
    ) -> None:
        """Drives the frontend's "these spaces already exist - overwrite?"

        prompt: a plain restore (no ``overwrite_space_keys``) must skip the
        already-existing space and report exactly which key conflicted, with
        nothing else about that space touched.
        """
        seeded = await _seed_instance(session)
        space: Space = seeded["space"]  # type: ignore[assignment]
        objects: dict[str, bytes] = {}

        async def get(key: str) -> bytes:
            return objects[key]

        async def put(key: str, data: bytes, **_kwargs: object) -> None:
            # Restore now streams attachment/avatar bytes via `archive.open()`
            # handles rather than materialising them first, so this fake
            # storage - unlike the real S3-backed one, which reads any
            # file-like `Body` itself - has to read the handle the same way.
            objects[key] = data.read() if hasattr(data, "read") else data

        async def delete(key: str) -> None:
            objects.pop(key, None)

        storage = cast(ObjectStorage, SimpleNamespace(get=get, put=put, delete=delete))
        archive = str(tmp_path / "conflict.zip")
        await BackupService(session, actor=seeded["admin"]).export_full_package(archive, storage)  # type: ignore[arg-type]

        report = await BackupService(session).restore_full_package(archive, storage, dry_run=False)

        assert report.conflicting_space_keys == ["ENG"]
        assert report.skipped["space"] == 1
        # The follow-up overwrite call the frontend makes with exactly this
        # key must be accepted - proving these two are the same currency.
        followup = await BackupService(session).restore_full_package(
            archive,
            storage,
            dry_run=True,
            overwrite_space_keys=set(report.conflicting_space_keys),
        )
        assert followup.dry_run is True
        # Space itself is still the original row (overwrite replaces its
        # pages, never the space identity/membership).
        assert (await session.get(Space, space.id)) is not None

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
            # Restore now streams attachment/avatar bytes via `archive.open()`
            # handles rather than materialising them first, so this fake
            # storage - unlike the real S3-backed one, which reads any
            # file-like `Body` itself - has to read the handle the same way.
            objects[key] = data.read() if hasattr(data, "read") else data

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
        assert document.wikihub_backup.version == BACKUP_VERSION
        assert len(document.pages) >= 2
        assert document.groups[0].name == "Authors"
        await _wipe(session)

        report = await BackupService(session).import_document(document, dry_run=False)

        restored_alice = await AuthService(session).users.get_by_username("alice")
        assert restored_alice is not None and restored_alice.bio == "Knowledge keeper"
        restored_bob = await AuthService(session).users.get_by_username("bob")
        assert restored_bob is not None
        restored_space = await SpaceService(session).get_by_key("ENG")
        assert restored_space.visibility is SpaceVisibility.restricted
        restored_child = (
            await session.execute(select(WikiPage).where(WikiPage.slug == "child"))
        ).scalar_one()
        restored_parent = (
            await session.execute(select(WikiPage).where(WikiPage.slug == "overview"))
        ).scalar_one()
        assert restored_child.parent_id == restored_parent.id
        assert restored_parent.created_by_id == restored_alice.id
        assert restored_parent.updated_by_id == restored_alice.id
        assert restored_child.created_by_id == restored_bob.id
        assert restored_child.updated_by_id == restored_bob.id
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

    async def test_restores_pins_drafts_tags_and_page_labels(
        self, session: AsyncSession
    ) -> None:
        """The per-user data _apply applies but nothing else exercises against a
        real database - every other case in this file covers it only with a
        mocked session (test_service_apply.py) or checks it made it into the
        *exported* document (test_service_export.py), never that a wipe-and-
        restore round trip actually lands it back in Postgres."""
        seeded = await _seed_instance(session)
        alice: User = seeded["alice"]  # type: ignore[assignment]
        bob: User = seeded["bob"]  # type: ignore[assignment]
        space: Space = seeded["space"]  # type: ignore[assignment]

        page = WikiPage(
            space_id=space.id,
            title="Runbook",
            slug="runbook",
            content="<p>steps</p>",
            created_by_id=alice.id,
            updated_by_id=alice.id,
        )
        session.add(page)
        await session.flush()
        session.add_all(
            [
                UserPagePin(page_id=page.id, user_id=alice.id),
                PageDraft(
                    page_id=page.id,
                    user_id=bob.id,
                    content="<p>in progress</p>",
                    content_format="html",
                    edit_mode="normal",
                    base_updated_at=page.updated_at,
                ),
                UserTag(user_id=alice.id, name="on-call"),
                UserPageLabel(page_id=page.id, user_id=bob.id, name="needs-review"),
            ]
        )
        await session.flush()

        doc = await BackupService(session, actor=seeded["admin"]).export_document()  # type: ignore[arg-type]
        assert doc.wikihub_backup.counts["page_pins"] == 1
        assert doc.wikihub_backup.counts["page_drafts"] == 1
        assert doc.wikihub_backup.counts["user_tags"] == 1
        assert doc.wikihub_backup.counts["user_page_labels"] == 1

        await _wipe(session)

        report = await BackupService(session).import_document(doc, dry_run=False)

        assert report.created["page_pin"] == 1
        assert report.created["page_draft"] == 1
        assert report.created["user_tag"] == 1
        assert report.created["user_page_label"] == 1

        restored_alice = await AuthService(session).users.get_by_username("alice")
        restored_bob = await AuthService(session).users.get_by_username("bob")
        restored_page = (
            await session.execute(select(WikiPage).where(WikiPage.slug == "runbook"))
        ).scalar_one()

        pin = await session.get(
            UserPagePin, {"page_id": restored_page.id, "user_id": restored_alice.id}
        )
        assert pin is not None

        draft = (
            await session.execute(
                select(PageDraft).where(
                    PageDraft.page_id == restored_page.id, PageDraft.user_id == restored_bob.id
                )
            )
        ).scalar_one()
        assert draft.content == "<p>in progress</p>"

        tag = (
            await session.execute(
                select(UserTag).where(UserTag.user_id == restored_alice.id)
            )
        ).scalar_one()
        assert tag.name == "on-call"

        page_label = (
            await session.execute(
                select(UserPageLabel).where(UserPageLabel.page_id == restored_page.id)
            )
        ).scalar_one()
        assert page_label.name == "needs-review"
        assert page_label.user_id == restored_bob.id

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
        assert report.conflicting_space_keys == ["ENG"]


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


class TestReapAbandonedExportJobs:
    """Regression test: a real overwrite restore (43 spaces, ~3,000 pages) went
    quiet for just over `STALE_JOB_AFTER` while inside `restore_full_package`'s
    checkpoint-free SAVEPOINT phase, got marked "failed" by the minute-ly
    reaper while it was still correctly running, and finished successfully a
    few minutes later with that stale error still sitting on its row. A
    restore gets a much longer grace window than every other job kind for
    exactly this reason.
    """

    async def test_a_restore_past_the_export_cutoff_but_within_its_own_is_left_running(
        self, session: AsyncSession
    ) -> None:
        stale_for_export = datetime.now(UTC) - STALE_JOB_AFTER - timedelta(seconds=1)
        restore = BackupJob(
            kind="full_import", status="running", phase="restoring",
            heartbeat_at=stale_for_export,
        )
        session.add(restore)
        await session.flush()

        assert await reap_abandoned_export_jobs(session) == 0
        await session.refresh(restore)
        assert restore.status == "running"
        assert restore.error is None

    async def test_a_restore_past_its_own_longer_cutoff_is_reaped(
        self, session: AsyncSession
    ) -> None:
        stale_for_restore = datetime.now(UTC) - STALE_RESTORE_JOB_AFTER - timedelta(seconds=1)
        restore = BackupJob(
            kind="full_import", status="running", phase="restoring",
            heartbeat_at=stale_for_restore,
        )
        session.add(restore)
        await session.flush()

        assert await reap_abandoned_export_jobs(session) == 1
        await session.refresh(restore)
        assert restore.status == "failed"
        assert restore.error == "The export worker stopped before this job finished."

    async def test_an_export_still_uses_the_short_cutoff(self, session: AsyncSession) -> None:
        """The wider grace period is specific to restores - an export never
        enters the checkpoint-free phase, so its own stale worker should keep
        being caught quickly rather than borrowing the restore's patience."""
        stale_for_export = datetime.now(UTC) - STALE_JOB_AFTER - timedelta(seconds=1)
        export = BackupJob(
            kind="full_export", status="running", phase="exporting",
            heartbeat_at=stale_for_export,
        )
        session.add(export)
        await session.flush()

        assert await reap_abandoned_export_jobs(session) == 1
        await session.refresh(export)
        assert export.status == "failed"


class TestRunBackupJobPersistsOutput:
    """Regression test: `checkpoint_backup_job()` opens with
    `session.refresh(job)`, which - with `autoflush` off on this session -
    discards any assignment on `job` made since the last commit before it is
    ever flushed. Calling it again right after setting `output_key`/
    `output_filename` silently wiped them: the job still finished "complete",
    just with nothing a download link could ever point at. A mocked session
    (as `test_run_backup_job_complete` in the unit suite uses) cannot catch
    this - its `.refresh()` is a no-op - so this needs a real one.
    """

    async def test_a_completed_export_keeps_its_output_filename(
        self, session: AsyncSession
    ) -> None:
        objects: dict[str, bytes] = {}

        async def put(key: str, data: object, **_kwargs: object) -> None:
            objects[key] = data.read() if hasattr(data, "read") else data

        storage = cast(ObjectStorage, SimpleNamespace(put=put))

        job = BackupJob(kind="full_export", status="queued", phase="queued")
        session.add(job)
        await session.flush()

        await run_backup_job(session, storage, job.id)

        await session.refresh(job)
        assert job.status == "complete"
        assert job.output_key and job.output_filename
        assert job.output_key in objects

    async def test_a_completed_automated_export_lands_in_the_mounted_directory(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        # The automated path never calls storage.put() at all - os.replace()
        # moves the file straight into the host-mounted directory instead
        # (see run_backup_job's own comment on why: object storage would
        # make the automated-backups panel's download/delete routes, which
        # read straight off that directory, unable to find it).
        monkeypatch.setattr(
            "app.modules.backup.automated.configured_directory",
            AsyncMock(return_value=tmp_path),
        )
        storage = cast(ObjectStorage, SimpleNamespace(put=AsyncMock()))
        job = BackupJob(kind="full_export", status="queued", phase="queued", automated=True)
        session.add(job)
        await session.flush()

        await run_backup_job(session, storage, job.id)

        await session.refresh(job)
        assert job.status == "complete"
        assert job.local_filename and job.output_filename == job.local_filename
        assert (tmp_path / job.local_filename).is_file()
        # Nothing left behind under its original temp name.
        assert list(tmp_path.iterdir()) == [tmp_path / job.local_filename]

    async def test_an_automated_job_is_named_from_the_moment_it_is_created(
        self, session: AsyncSession
    ) -> None:
        """The history table used to have nothing to show for a scheduled
        backup until it finished - or, for one cancelled mid-run, ever - and
        fell back to a bare timestamp instead. The name is a pure function of
        `created_at`, so `create_export_job` sets it immediately rather than
        waiting for the export to actually produce a file."""
        job = await create_export_job(
            session, actor_id=None, kind="full_export", automated=True
        )

        assert job.output_filename == f"wikihub-auto-backup-{job.created_at:%d%m%Y-%H%M%S}.zip"
        # Distinct from `local_filename`, which means "a file exists on disk
        # under this name" and must stay unset until the export actually
        # writes one.
        assert job.local_filename is None

    async def test_a_manual_job_is_not_pre_named(self, session: AsyncSession) -> None:
        job = await create_export_job(session, actor_id=None, kind="full_export")

        assert job.output_filename is None

    async def test_export_checkpoints_progress_while_streaming_revisions(
        self, session: AsyncSession
    ) -> None:
        # Distinct from the two tests above: those run against an empty
        # instance, so the revision-streaming loop's own per-batch
        # `checkpoint_backup_job()` call never actually runs. A page needs at
        # least one revision for that loop to have anything to iterate.
        seeded = await _seed_instance(session)
        space = cast(Space, seeded["space"])
        alice = cast(User, seeded["alice"])
        page = WikiPage(
            space_id=space.id,
            title="Doc",
            slug="doc",
            content="Body",
            created_by_id=alice.id,
            updated_by_id=alice.id,
        )
        session.add(page)
        await session.flush()
        session.add(
            PageRevision(
                page_id=page.id,
                version=1,
                title="Doc",
                content="Body",
                created_by_id=alice.id,
                change_summary="Initial version",
            )
        )
        await session.flush()

        objects: dict[str, bytes] = {}

        async def put(key: str, data: object, **_kwargs: object) -> None:
            objects[key] = data.read() if hasattr(data, "read") else data

        storage = cast(ObjectStorage, SimpleNamespace(put=put))
        job = BackupJob(kind="full_export", status="queued", phase="queued")
        session.add(job)
        await session.flush()

        await run_backup_job(session, storage, job.id)

        await session.refresh(job)
        assert job.status == "complete"
        assert job.heartbeat_at is not None
