"""Import / restore history endpoints: past runs, their log lines, and download."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import delete

from app.db.session import get_session_factory
from app.models.backup_job import BackupJob, BackupJobLog
from app.models.import_job import ImportArchive, ImportJob, ImportLog
from app.models.user import User


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _seed_confluence_run(user: User) -> tuple[uuid.UUID, uuid.UUID]:
    """One finished Confluence import with an info, two warning and one error line."""
    start = datetime.now(UTC) - timedelta(hours=1)
    async with get_session_factory()() as session:
        archive = ImportArchive(
            object_key=f"imports/{uuid.uuid4()}.zip",
            filename="history.zip",
            size_bytes=1,
            sha256=uuid.uuid4().hex * 2,
            status="scanned",
            created_by_id=user.id,
            spaces=[],
        )
        session.add(archive)
        await session.flush()
        job = ImportJob(
            archive_id=archive.id,
            created_by_id=user.id,
            import_all=True,
            space_keys=[],
            overwrite_existing=False,
            status="failed",
            phase="failed",
            counters={},
            error="worker timed out",
        )
        session.add(job)
        await session.flush()
        for offset, (level, message, label) in enumerate(
            [
                ("info", "started", None),
                ("warning", "file one missing", "one.pdf"),
                ("warning", "file two missing", None),
                ("error", "the import failed", None),
            ]
        ):
            session.add(
                ImportLog(
                    job_id=job.id,
                    created_at=start + timedelta(seconds=offset),
                    level=level,
                    phase="attachments",
                    entity_label=label,
                    message=message,
                )
            )
        await session.commit()
        return archive.id, job.id


async def _drop_archive(archive_id: uuid.UUID) -> None:
    async with get_session_factory()() as session:
        await session.execute(delete(ImportArchive).where(ImportArchive.id == archive_id))
        await session.commit()


async def test_confluence_history_lists_counts_pages_filters_and_downloads(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    headers = _headers(api_access_token)
    archive_id, job_id = await _seed_confluence_run(api_user)
    try:
        listing = await client.get("/api/v1/confluence-imports/jobs", headers=headers)
        assert listing.status_code == 200, listing.text
        mine = next(item for item in listing.json() if item["id"] == str(job_id))
        assert (mine["warning_count"], mine["error_count"]) == (2, 1)

        paged = await client.get(
            "/api/v1/confluence-imports/jobs", headers=headers, params={"limit": 1, "offset": 0}
        )
        assert paged.status_code == 200 and len(paged.json()) == 1

        base = f"/api/v1/confluence-imports/jobs/{job_id}/logs"
        oldest_first = await client.get(base, headers=headers, params={"order": "asc"})
        assert [row["message"] for row in oldest_first.json()["items"]] == [
            "started", "file one missing", "file two missing", "the import failed",
        ]
        warnings = await client.get(base, headers=headers, params={"level": "warning"})
        assert {row["level"] for row in warnings.json()["items"]} == {"warning"}
        assert len(warnings.json()["items"]) == 2

        download = await client.get(f"{base}/download", headers=headers)
        assert download.status_code == 200
        assert download.headers["content-type"].startswith("text/plain")
        assert "attachment" in download.headers["content-disposition"]
        lines = download.text.strip().splitlines()
        assert len(lines) == 4
        assert lines[0].endswith("INFO attachments started")
        assert "WARNING attachments one.pdf: file one missing" in lines[1]

        missing = await client.get(
            f"/api/v1/confluence-imports/jobs/{uuid.uuid4()}/logs/download", headers=headers
        )
        assert missing.status_code == 404
    finally:
        await _drop_archive(archive_id)


async def test_restore_history_filters_by_kind_and_downloads_its_log(
    client: AsyncClient, api_user: User, api_access_token: str
) -> None:
    headers = _headers(api_access_token)
    async with get_session_factory()() as session:
        restore = BackupJob(
            kind="full_import", status="failed", phase="failed", counters={},
            space_keys=[], overwrite_space_keys=[], error="boom",
        )
        export = BackupJob(
            kind="full_export", status="complete", phase="complete", counters={},
            space_keys=[], overwrite_space_keys=[],
        )
        session.add_all([restore, export])
        await session.flush()
        session.add_all(
            [
                BackupJobLog(job_id=restore.id, level="warning", phase="restoring", message="skipped"),
                BackupJobLog(job_id=restore.id, level="error", phase="failed", message="boom"),
            ]
        )
        await session.commit()
        restore_id, export_id = restore.id, export.id
    try:
        listing = await client.get(
            "/api/v1/backup/jobs", headers=headers, params={"kind": "full_import", "limit": 100}
        )
        assert listing.status_code == 200, listing.text
        ids = {item["id"]: item for item in listing.json()}
        assert str(restore_id) in ids and str(export_id) not in ids
        assert (ids[str(restore_id)]["warning_count"], ids[str(restore_id)]["error_count"]) == (1, 1)

        logs = await client.get(
            f"/api/v1/backup/jobs/{restore_id}/logs", headers=headers, params={"level": "error"}
        )
        assert [row["message"] for row in logs.json()["items"]] == ["boom"]

        download = await client.get(f"/api/v1/backup/jobs/{restore_id}/logs/download", headers=headers)
        assert download.status_code == 200
        assert download.text.count("\n") == 2 and "ERROR failed boom" in download.text

        missing = await client.get(
            f"/api/v1/backup/jobs/{uuid.uuid4()}/logs/download", headers=headers
        )
        assert missing.status_code == 400
    finally:
        async with get_session_factory()() as session:
            await session.execute(delete(BackupJob).where(BackupJob.id.in_([restore_id, export_id])))
            await session.commit()
