"""Whole-instance backup and restore as a single JSON document or full ZIP package.

**Execution model.** All entry points are pure ``session in, value out`` — no
``Request``, no ``Response``, no ``UploadFile``. Keep HTTP concerns in the router.

**Audit rows are excluded** from the document: their actor foreign keys would
dangle, and restoring them would forge history in the target instance. The
import instead writes one ``backup_imported`` row into the target's own log.
"""

from __future__ import annotations

import zipfile  # noqa: F401 - re-exported for test patches
from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.soft_delete import include_trash
from app.models.backup_job import BackupJob
from app.models.comment import CommentLike, PageComment
from app.models.issue import Issue, IssueAttachment
from app.models.user import User
from app.modules.backup import exporter, importer, restorer
from app.modules.backup.helpers import (  # noqa: F401
    _ATTACHMENT_ID_RE,
    _ATTACHMENT_NAME_ATTRS,
    _ATTACHMENT_TAG_RE,
    _PROGRESS_CHECK_EVERY,
    STALE_JOB_AFTER,
    STALE_RESTORE_JOB_AFTER,
    ExportCancelled,
    _attachment_name_in,
    _comment_entries,
    _HashingZipEntry,
    _PageIndexEntry,
    _parents_first,
    _relink_attachment_references,
    _ReportBuilder,
    _share_entries,
    _without_handled_conflicts,
    checkpoint_backup_job,
    log_backup_event,
    observe_backup_cancellation,
)
from app.modules.backup.package import ScannedPackage, scan_full_backup
from app.repositories.space import SpaceRepository
from app.repositories.user import UserRepository
from app.schemas.backup import (
    MAX_REPORT_ENTRIES,  # noqa: F401 - monkeypatched by tests
    BackupDocument,
    BackupIssue,
    ImportReport,
)
from app.services.audit import AuditService, ClientInfo
from app.services.site_settings import SiteSettingsService
from app.services.storage import ObjectStorage

logger = get_logger(__name__)


class BackupService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        actor: User | None = None,
        client: ClientInfo | None = None,
        impersonator: User | None = None,
    ) -> None:
        self.session = session
        # A backup carries the Trash too (and restoring one must see it, or a page in the
        # Trash would look free to overwrite): see `app/db/soft_delete.py`.
        include_trash(session)
        self.actor = actor
        self.users = UserRepository(session)
        self.spaces = SpaceRepository(session)
        self.audit = AuditService(session, actor=actor, client=client, impersonator=impersonator)
        self.site_settings = SiteSettingsService(
            session, actor=actor, client=client, impersonator=impersonator
        )

    # -- export ------------------------------------------------------------
    async def _issue_entries(
        self, users_by_id: Mapping[UUID, User]
    ) -> tuple[list[BackupIssue], dict[UUID, list[IssueAttachment]]]:
        return await exporter.load_issue_entries(self, users_by_id)

    async def _load_comments(self) -> tuple[list[PageComment], list[CommentLike]]:
        return await exporter.load_comments(self)

    async def export_document(
        self, *, include_credentials: bool = False, space_keys: list[str] | None = None
    ) -> BackupDocument:
        return await exporter.export_document(
            self, include_credentials=include_credentials, space_keys=space_keys
        )

    async def export_full_package(
        self,
        path: str,
        storage: ObjectStorage,
        *,
        include_credentials: bool = False,
        space_keys: list[str] | None = None,
        job: BackupJob | None = None,
    ) -> dict[str, Any]:
        return await exporter.export_full_package(
            self,
            path,
            storage,
            include_credentials=include_credentials,
            space_keys=space_keys,
            job=job,
        )

    @staticmethod
    def scan_full_package(path: str, *, max_size_bytes: int | None = None) -> ScannedPackage:
        return scan_full_backup(path, max_size_bytes=max_size_bytes)

    async def restore_full_package(
        self,
        path: str,
        storage: ObjectStorage,
        *,
        dry_run: bool = True,
        overwrite_space_keys: set[str] | None = None,
        space_keys: set[str] | None = None,
        job: BackupJob | None = None,
    ) -> ImportReport:
        return await restorer.restore_full_package(
            self,
            path,
            storage,
            dry_run=dry_run,
            overwrite_space_keys=overwrite_space_keys,
            space_keys=space_keys,
            job=job,
        )

    # -- import ------------------------------------------------------------
    async def import_document(
        self,
        doc: BackupDocument,
        *,
        dry_run: bool = True,
        space_keys: set[str] | None = None,
        job: BackupJob | None = None,
    ) -> ImportReport:
        return await importer.import_document(
            self, doc, dry_run=dry_run, space_keys=space_keys, job=job
        )

    async def _find_issue(self, entry: BackupIssue) -> Issue | None:
        return await importer.find_issue(self, entry)

    async def _apply(
        self,
        doc: BackupDocument,
        report: _ReportBuilder,
        no_password: list[str],
        job: BackupJob | None = None,
    ) -> None:
        await importer.apply_document(self, doc, report, no_password, job)
