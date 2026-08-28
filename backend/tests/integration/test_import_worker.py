from __future__ import annotations

import uuid
import zipfile
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_job import ImportArchive, ImportJob, ImportLog
from app.models.space import Space
from app.modules.auth.service import AuthService
from app.modules.import_export import service as import_module
from app.modules.import_export.confluence import ConfluencePage, ConfluenceSpace
from app.modules.import_export.service import (
    STALE_IMPORT_AFTER,
    ConfluenceImportService,
    reap_abandoned_confluence_imports,
    run_import,
)
from app.repositories.space import SpaceRepository
from app.schemas.user import UserCreate

pytestmark = pytest.mark.integration


class WorkerStorage:
    async def download_to_file(self, _key: str, destination: str, on_progress=None) -> None:
        with zipfile.ZipFile(destination, "w") as archive:
            archive.writestr("entities.xml", "<root />")
        if on_progress:
            await on_progress(10)


async def test_run_import_imports_space_pages_and_completes(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await AuthService(session).create_user(
        UserCreate(
            username=f"worker{uuid.uuid4().hex[:8]}",
            email=f"worker{uuid.uuid4().hex[:8]}@example.com",
            password="password-1234",
        )
    )
    archive = ImportArchive(
        object_key=f"imports/{uuid.uuid4()}.zip",
        filename="export.zip",
        size_bytes=10,
        sha256="a" * 64,
        status="scanned",
        created_by_id=user.id,
        spaces=[{"key": "ENG", "name": "Engineering", "page_count": 1}],
    )
    session.add(archive)
    await session.flush()
    job = ImportJob(
        archive_id=archive.id,
        created_by_id=user.id,
        import_all=True,
        space_keys=[],
        overwrite_existing=False,
        status="queued",
        phase="queued",
        counters={},
    )
    session.add(job)
    await session.flush()
    source = ConfluencePage(
        source_id="p1",
        space_id="s1",
        parent_id=None,
        title="Home",
        status="current",
        created_at=None,
        updated_at=None,
        creator="missing-import-user",
        last_modifier=None,
    )
    space = ConfluenceSpace(source_id="s1", key="ENG", name="Engineering", pages=[source])
    monkeypatch.setattr(import_module, "scan_archive", lambda _path: [space])
    monkeypatch.setattr(import_module, "iter_page_bodies", lambda _path: [("p1", "<p>Body</p>")])
    monkeypatch.setattr(import_module, "iter_attachments", lambda _path: [])

    await run_import(session, WorkerStorage(), job.id)
    await session.refresh(job)
    assert job.status == "completed"
    assert job.counters["pages_processed"] == 1


async def _import_one_space(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch, *, key: str
) -> ImportJob:
    """Run a Confluence import of a single space whose key is `key`."""
    user = await AuthService(session).create_user(
        UserCreate(
            username=f"worker{uuid.uuid4().hex[:8]}",
            email=f"worker{uuid.uuid4().hex[:8]}@example.com",
            password="password-1234",
        )
    )
    archive = ImportArchive(
        object_key=f"imports/{uuid.uuid4()}.zip",
        filename="export.zip",
        size_bytes=10,
        sha256=uuid.uuid4().hex * 2,
        status="scanned",
        created_by_id=user.id,
        spaces=[{"key": key, "name": "2.team_devops", "page_count": 1}],
    )
    session.add(archive)
    await session.flush()
    job = ImportJob(
        archive_id=archive.id,
        created_by_id=user.id,
        import_all=True,
        space_keys=[],
        overwrite_existing=False,
        status="queued",
        phase="queued",
        counters={},
    )
    session.add(job)
    await session.flush()
    source = ConfluencePage(
        source_id="p1",
        space_id="s1",
        parent_id=None,
        title="Home",
        status="current",
        created_at=None,
        updated_at=None,
        creator="missing-import-user",
        last_modifier=None,
    )
    space = ConfluenceSpace(
        source_id="s1", key=key, name="2.team_devops", pages=[source]
    )
    monkeypatch.setattr(import_module, "scan_archive", lambda _path: [space])
    monkeypatch.setattr(import_module, "iter_page_bodies", lambda _path: [("p1", "<p>Body</p>")])
    monkeypatch.setattr(import_module, "iter_attachments", lambda _path: [])

    await run_import(session, WorkerStorage(), job.id)
    await session.refresh(job)
    return job


async def test_confluence_import_stores_the_space_key_upper_cased(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Every other writer of `Space.key` upper-cases; this one used not to.

    `SpaceCreate` normalises what the UI sends and `BackupService` restores
    with `.strip().upper()`, so a lower-case key could only ever enter through
    here - and once one did, it was indistinguishable from a real second
    space.
    """
    await _import_one_space(session, monkeypatch, key="devsecops")

    keys = (await session.execute(select(Space.key))).scalars().all()
    assert keys == ["DEVSECOPS"]


async def test_confluence_import_skips_a_space_that_differs_only_in_case(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The reported bug, end to end.

    A restore had already created "DEVSECOPS". The import's existence check
    compared `Space.key == "devsecops"` - case-sensitively, against a raw
    Confluence key - missed it, and created a second space holding another
    copy of all 164 pages. `ix_spaces_key` is case-sensitive so the pair was
    perfectly legal, while `SpaceRepository.get_by_key` matches on
    `upper(key)` and found both: every read of that space then died on
    MultipleResultsFound, which is the 500 the operator hit on the space page.
    """
    restored = Space(
        key="DEVSECOPS", name="2.team_devops", description="", icon="", status="active"
    )
    session.add(restored)
    await session.flush()

    job = await _import_one_space(session, monkeypatch, key="devsecops")

    assert job.status == "completed"
    spaces = (await session.execute(select(Space))).scalars().all()
    assert [s.key for s in spaces] == ["DEVSECOPS"]
    assert spaces[0].id == restored.id

    skipped = (
        await session.execute(
            select(ImportLog).where(ImportLog.message.like("Skipped: Space key%"))
        )
    ).scalars().all()
    assert [log.entity_label for log in skipped] == ["DEVSECOPS"]

    # The whole point: this is what used to raise MultipleResultsFound.
    found = await SpaceRepository(session).get_by_key("devsecops")
    assert found is not None and found.id == restored.id


async def test_confluence_import_replace_collapses_a_case_differing_pair(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Replace must leave exactly one space, whatever it found.

    An instance that already collected the duplicate pair is exactly where an
    operator reaches for Replace, and "replace" that leaves the other copy
    standing has not replaced anything - the space still reads as two rows and
    still dies on MultipleResultsFound.
    """
    for key in ("DEVSECOPS", "devsecops"):
        session.add(
            Space(key=key, name="2.team_devops", description="", icon="", status="active")
        )
    await session.flush()

    user = await AuthService(session).create_user(
        UserCreate(
            username=f"worker{uuid.uuid4().hex[:8]}",
            email=f"worker{uuid.uuid4().hex[:8]}@example.com",
            password="password-1234",
        )
    )
    archive = ImportArchive(
        object_key=f"imports/{uuid.uuid4()}.zip",
        filename="export.zip",
        size_bytes=10,
        sha256=uuid.uuid4().hex * 2,
        status="scanned",
        created_by_id=user.id,
        spaces=[{"key": "devsecops", "name": "2.team_devops", "page_count": 1}],
    )
    session.add(archive)
    await session.flush()
    job = ImportJob(
        archive_id=archive.id,
        created_by_id=user.id,
        import_all=True,
        space_keys=[],
        overwrite_existing=True,
        status="queued",
        phase="queued",
        counters={},
    )
    session.add(job)
    await session.flush()
    source = ConfluencePage(
        source_id="p1", space_id="s1", parent_id=None, title="Home", status="current",
        created_at=None, updated_at=None, creator="missing-import-user", last_modifier=None,
    )
    space = ConfluenceSpace(
        source_id="s1", key="devsecops", name="2.team_devops", pages=[source]
    )
    monkeypatch.setattr(import_module, "scan_archive", lambda _path: [space])
    monkeypatch.setattr(import_module, "iter_page_bodies", lambda _path: [("p1", "<p>Body</p>")])
    monkeypatch.setattr(import_module, "iter_attachments", lambda _path: [])

    await run_import(session, WorkerStorage(), job.id)
    await session.refresh(job)

    assert job.status == "completed"
    spaces = (await session.execute(select(Space))).scalars().all()
    assert [s.key for s in spaces] == ["DEVSECOPS"]
    assert await SpaceRepository(session).get_by_key("devsecops") is not None


async def test_confluence_scan_flags_a_conflict_across_case(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The picker has to offer Replace in the first place.

    The conflict flag was a case-sensitive membership test against raw
    `Space.key` values, so a Confluence "devsecops" landing on an existing
    "DEVSECOPS" was shown as a clean, conflict-free choice - the operator was
    never asked whether to replace, and the import built the second copy
    without a word.
    """
    session.add(
        Space(key="DEVSECOPS", name="2.team_devops", description="", icon="", status="active")
    )
    await session.flush()

    user = await AuthService(session).create_user(
        UserCreate(
            username=f"worker{uuid.uuid4().hex[:8]}",
            email=f"worker{uuid.uuid4().hex[:8]}@example.com",
            password="password-1234",
        )
    )
    archive = ImportArchive(
        object_key=f"imports/{uuid.uuid4()}.zip",
        filename="export.zip",
        size_bytes=10,
        sha256=uuid.uuid4().hex * 2,
        status="scanned",
        created_by_id=user.id,
        spaces=[{"key": "devsecops", "name": "2.team_devops", "page_count": 1}],
    )
    session.add(archive)
    await session.flush()

    scanned = await ConfluenceImportService(session, WorkerStorage()).scan(archive)
    assert [item["conflict"] for item in scanned.spaces] == [True]


async def _orphan_import(session: AsyncSession, **overrides) -> ImportJob:
    user = await AuthService(session).create_user(
        UserCreate(
            username=f"worker{uuid.uuid4().hex[:8]}",
            email=f"worker{uuid.uuid4().hex[:8]}@example.com",
            password="password-1234",
        )
    )
    archive = ImportArchive(
        object_key=f"imports/{uuid.uuid4()}.zip",
        filename="export.zip",
        size_bytes=10,
        sha256=uuid.uuid4().hex * 2,
        status="scanned",
        created_by_id=user.id,
        spaces=[],
    )
    session.add(archive)
    await session.flush()
    defaults = {
        "archive_id": archive.id,
        "created_by_id": user.id,
        "import_all": True,
        "space_keys": [],
        "overwrite_existing": False,
        "status": "running",
        "phase": "downloading",
        "counters": {},
        "cancel_requested": False,
        "heartbeat_at": datetime.now(UTC) - STALE_IMPORT_AFTER * 2,
    }
    job = ImportJob(**{**defaults, **overrides})
    session.add(job)
    await session.flush()
    return job


async def test_reaper_fails_a_confluence_import_whose_worker_died(
    session: AsyncSession,
) -> None:
    """`import_jobs` was the one job table with neither heartbeat nor reaper.

    A "running" row nothing is advancing left the progress bar spinning and
    made Cancel a no-op, because cancelling a running import means waiting for
    a worker loop to observe `cancel_requested`.
    """
    job = await _orphan_import(session)

    assert await reap_abandoned_confluence_imports(session) == 1

    await session.refresh(job)
    assert (job.status, job.phase) == ("failed", "failed")
    assert job.error == "The import worker stopped before this job finished."


async def test_reaper_reports_a_cancelled_import_as_cancelled(
    session: AsyncSession,
) -> None:
    """Cancellation wins: an operator who asked to stop did not cause a failure."""
    job = await _orphan_import(session, cancel_requested=True)

    assert await reap_abandoned_confluence_imports(session) == 1

    await session.refresh(job)
    assert (job.status, job.phase) == ("cancelled", "cancelled")
    assert job.error is None


async def test_reaper_leaves_an_import_that_is_still_beating(session: AsyncSession) -> None:
    """The regression guard that matters: never kill a healthy import.

    `iter_page_bodies` reads a whole multi-GB archive in one pass, so a live
    import can go quiet for a long time - which is why `STALE_IMPORT_AFTER` is
    far more generous than the five minutes the other job families use.
    """
    job = await _orphan_import(session, heartbeat_at=datetime.now(UTC))

    assert await reap_abandoned_confluence_imports(session) == 0

    await session.refresh(job)
    assert job.status == "running"


async def test_startup_sweep_reaps_even_a_freshly_beating_import(
    session: AsyncSession,
) -> None:
    """A worker that has just come up is running nothing.

    Anything still marked running belongs to the process it replaced, so a
    restart - the most common way an import is orphaned - clears its own
    leftovers without waiting out the staleness window.
    """
    job = await _orphan_import(session, heartbeat_at=datetime.now(UTC))

    assert await reap_abandoned_confluence_imports(session, every_running_job=True) == 1

    await session.refresh(job)
    assert job.status == "failed"
