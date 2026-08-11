"""Instance backup and restore endpoints.

HTTP concerns live here only — file naming, upload limits, content types. The
service underneath is transport-agnostic so it can move to a background job
without change.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from pydantic import ValidationError

from app.api.deps import ClientInfoDep, CurrentSuperuser, DbSession, Impersonator
from app.core.config import settings
from app.core.exceptions import BadRequestError, PayloadTooLargeError
from app.modules.backup.service import BackupService
from app.schemas.backup import BackupDocument, ImportReport

router = APIRouter(prefix="/backup", tags=["backup"])

#: A JSON instance backup is small; this is a sanity bound, not a content limit.
MAX_BACKUP_UPLOAD_BYTES = min(settings.max_import_size_bytes, 64 * 1024 * 1024)


def get_backup_service(
    session: DbSession,
    user: CurrentSuperuser,
    client: ClientInfoDep,
    impersonator: Impersonator,
) -> BackupService:
    return BackupService(session, actor=user, client=client, impersonator=impersonator)


BackupServiceDep = Annotated[BackupService, Depends(get_backup_service)]


@router.get(
    "/export",
    response_class=Response,
    summary="Download a full instance backup",
    responses={200: {"content": {"application/json": {}}, "description": "Backup document"}},
)
async def export_backup(
    service: BackupServiceDep,
    include_credentials: bool = Query(
        default=False,
        description=(
            "Include password hashes. Off by default: the download is a "
            "cracking target. Without it, restored accounts need a password reset."
        ),
    ),
) -> Response:
    document = await service.export_document(include_credentials=include_credentials)

    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    filename = f"wikihub-backup-{stamp}.json"
    return Response(
        content=document.model_dump_json(indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import", response_model=ImportReport, summary="Restore from a backup file")
async def import_backup(
    service: BackupServiceDep,
    file: Annotated[UploadFile, File(description="A JSON file produced by /backup/export")],
    dry_run: Annotated[
        bool,
        Form(description="Validate and report without writing. Defaults to true."),
    ] = True,
) -> ImportReport:
    """Upload a backup and preview or apply it.

    Multipart rather than a JSON body: a large document sent as a request body
    would be fully materialised and validated in memory before the handler runs.
    """
    raw = await file.read()
    if len(raw) > MAX_BACKUP_UPLOAD_BYTES:
        raise PayloadTooLargeError(
            f"Backup exceeds the {MAX_BACKUP_UPLOAD_BYTES // (1024 * 1024)} MB limit."
        )

    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        # A malformed upload is the caller's mistake: 400, never a 500.
        raise BadRequestError(
            "The uploaded file is not valid JSON.", code="malformed_backup"
        ) from exc

    try:
        document = BackupDocument.model_validate(payload)
    except ValidationError as exc:
        raise BadRequestError(
            "The uploaded file is not a WikiHub backup document.",
            code="malformed_backup",
            details={"errors": exc.error_count()},
        ) from exc

    return await service.import_document(document, dry_run=dry_run)
