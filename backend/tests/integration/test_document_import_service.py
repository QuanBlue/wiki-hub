"""Document-import job lifecycle: creation, staging, access and checkpointing.

The worker body (`jobs.py`) and the API route are both covered elsewhere;
this is `service.py`'s own functions in isolation, against a real database -
`get_job_for_user`'s creator/superuser access rule and `list_active_jobs`'s
scoping are exactly the kind of "who can see what" logic a mock would let
slide by accident.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.document_import import DocumentImportJob
from app.modules.auth.service import AuthService
from app.modules.document_import.service import (
    DocumentImportCancelled,
    StagedDocument,
    checkpoint_job,
    create_document_import_job,
    get_job_for_user,
    list_active_jobs,
    staged_job_prefix,
    to_job_read,
    worker_is_gone,
)
from app.modules.spaces.service import SpaceService
from app.schemas.space import SpaceCreate
from app.schemas.user import UserCreate

pytestmark = pytest.mark.integration


def _uniq(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


async def _with_items(session: AsyncSession, job: DocumentImportJob) -> DocumentImportJob:
    """`job.items` is a lazy relationship - fine inside the worker, which
    always awaits it, but a plain attribute access from test code (or from
    `to_job_read`, which is synchronous) cannot await a lazy load. Load it
    up front instead of touching the collection cold."""
    return (
        await session.execute(
            select(DocumentImportJob)
            .where(DocumentImportJob.id == job.id)
            .options(selectinload(DocumentImportJob.items))
        )
    ).scalar_one()


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def put(self, key: str, data, *, content_type: str = "", metadata=None):
        self.objects[key] = data if isinstance(data, bytes) else data.read()


async def _make_user(session: AsyncSession, *, is_superuser: bool = False):
    return await AuthService(session).create_user(
        UserCreate(
            username=_uniq("u"),
            email=f"{_uniq('u')}@example.com",
            full_name="Importer",
            password="password-1234",
            is_superuser=is_superuser,
        )
    )


async def _make_space(session: AsyncSession, owner):
    return await SpaceService(session).create(
        SpaceCreate(key=_uniq("SP").upper()[:8], name="Imports"), owner
    )


class TestCreateDocumentImportJob:
    async def test_persists_the_job_and_stages_every_file(
        self, session: AsyncSession
    ) -> None:
        user = await _make_user(session)
        space = await _make_space(session, user)
        storage = FakeStorage()

        job = await create_document_import_job(
            session,
            storage,
            space=space,
            parent_id=None,
            documents=[
                StagedDocument(
                    filename="one.docx",
                    content_type="application/octet-stream",
                    data=b"first",
                    source_format="docx",
                ),
                StagedDocument(
                    filename="two.docx",
                    content_type="application/octet-stream",
                    data=b"second",
                    source_format="docx",
                ),
            ],
            creator=user,
        )

        assert job.status == "queued"
        assert job.counters["items_total"] == 2
        assert job.counters["items_failed"] == 0
        job = await _with_items(session, job)
        items = sorted(job.items, key=lambda item: item.position)
        assert [item.filename for item in items] == ["one.docx", "two.docx"]
        assert [item.status for item in items] == ["queued", "queued"]
        # Staged under this job's own prefix, keyed so two files with the same
        # name in the same job never collide.
        assert all(key.startswith(staged_job_prefix(job.id)) for key in storage.objects)
        assert storage.objects[items[0].object_key] == b"first"
        assert storage.objects[items[1].object_key] == b"second"

    async def test_sanitizes_a_path_like_filename(self, session: AsyncSession) -> None:
        user = await _make_user(session)
        space = await _make_space(session, user)
        storage = FakeStorage()

        job = await create_document_import_job(
            session,
            storage,
            space=space,
            parent_id=None,
            documents=[
                StagedDocument(
                    filename="../../etc/passwd.docx",
                    content_type="application/octet-stream",
                    data=b"x",
                    source_format="docx",
                )
            ],
            creator=user,
        )

        job = await _with_items(session, job)
        assert job.items[0].filename == "passwd.docx"


class TestGetJobForUser:
    async def test_the_creator_can_see_their_own_job(self, session: AsyncSession) -> None:
        user = await _make_user(session)
        space = await _make_space(session, user)
        job = await create_document_import_job(
            session,
            FakeStorage(),
            space=space,
            parent_id=None,
            documents=[],
            creator=user,
        )

        assert (await get_job_for_user(session, job.id, user)) is job

    async def test_a_superuser_can_see_someone_elses_job(
        self, session: AsyncSession
    ) -> None:
        owner = await _make_user(session)
        space = await _make_space(session, owner)
        job = await create_document_import_job(
            session, FakeStorage(), space=space, parent_id=None, documents=[], creator=owner
        )
        admin = await _make_user(session, is_superuser=True)

        assert (await get_job_for_user(session, job.id, admin)) is job

    async def test_an_ordinary_user_cannot_see_someone_elses_job(
        self, session: AsyncSession
    ) -> None:
        owner = await _make_user(session)
        space = await _make_space(session, owner)
        job = await create_document_import_job(
            session, FakeStorage(), space=space, parent_id=None, documents=[], creator=owner
        )
        other = await _make_user(session)

        assert await get_job_for_user(session, job.id, other) is None

    async def test_a_nonexistent_job_id_is_none(self, session: AsyncSession) -> None:
        user = await _make_user(session)
        assert await get_job_for_user(session, uuid.uuid4(), user) is None


class TestListActiveJobs:
    async def test_only_this_users_unfinished_jobs_in_this_space_are_returned(
        self, session: AsyncSession
    ) -> None:
        user = await _make_user(session)
        space = await _make_space(session, user)
        other_user = await _make_user(session)
        other_space = await _make_space(session, other_user)

        mine = await create_document_import_job(
            session, FakeStorage(), space=space, parent_id=None, documents=[], creator=user
        )
        finished = await create_document_import_job(
            session, FakeStorage(), space=space, parent_id=None, documents=[], creator=user
        )
        finished.status = "complete"
        someone_elses = await create_document_import_job(
            session,
            FakeStorage(),
            space=space,
            parent_id=None,
            documents=[],
            creator=other_user,
        )
        different_space = await create_document_import_job(
            session,
            FakeStorage(),
            space=other_space,
            parent_id=None,
            documents=[],
            creator=user,
        )
        await session.commit()

        active = await list_active_jobs(session, space=space, user=user)

        assert [job.id for job in active] == [mine.id]
        assert finished.id not in [job.id for job in active]
        assert someone_elses.id not in [job.id for job in active]
        assert different_space.id not in [job.id for job in active]

    async def test_newest_first_and_respects_the_limit(
        self, session: AsyncSession
    ) -> None:
        # `created_at` defaults from Postgres's own `now()`, which is fixed
        # for the whole transaction - three inserts in one transaction would
        # otherwise land on the exact same timestamp and make "newest first"
        # ambiguous. Backdating them explicitly is what actually exercises
        # the ordering rather than relying on incidental insertion order.
        user = await _make_user(session)
        space = await _make_space(session, user)
        base = datetime(2026, 1, 1, tzinfo=UTC)
        jobs = []
        for offset in range(3):
            job = await create_document_import_job(
                session, FakeStorage(), space=space, parent_id=None, documents=[], creator=user
            )
            job.created_at = base + timedelta(minutes=offset)
            jobs.append(job)
        await session.commit()

        active = await list_active_jobs(session, space=space, user=user, limit=2)

        assert len(active) == 2
        assert [job.id for job in active] == [jobs[2].id, jobs[1].id]


class TestToJobRead:
    async def test_shapes_the_read_model_with_items_sorted_by_position(
        self, session: AsyncSession
    ) -> None:
        user = await _make_user(session)
        space = await _make_space(session, user)
        job = await create_document_import_job(
            session,
            FakeStorage(),
            space=space,
            parent_id=None,
            documents=[
                StagedDocument(
                    filename=name, content_type="x", data=b"x", source_format="docx"
                )
                for name in ("b.docx", "a.docx")
            ],
            creator=user,
        )
        await session.commit()
        job = await _with_items(session, job)

        read = to_job_read(job, space_key=space.key)

        assert read.id == job.id
        assert read.space_key == space.key
        # A queued job has not started yet - job_progress() (tested on its
        # own elsewhere) deliberately reports no percent/ETA rather than a
        # number that would really just be a guess.
        assert read.percent is None
        assert read.eta_seconds is None
        assert [item.filename for item in read.items] == ["b.docx", "a.docx"]


class TestWorkerIsGone:
    def test_no_heartbeat_at_all_reads_as_gone(self) -> None:
        job = type("Job", (), {"heartbeat_at": None})()
        assert worker_is_gone(job) is True

    def test_a_stale_heartbeat_reads_as_gone(self) -> None:
        now = datetime(2026, 1, 1, tzinfo=UTC)
        job = type("Job", (), {"heartbeat_at": now - timedelta(seconds=301)})()
        assert worker_is_gone(job, now=now) is True

    def test_a_recent_heartbeat_reads_as_alive(self) -> None:
        now = datetime(2026, 1, 1, tzinfo=UTC)
        job = type("Job", (), {"heartbeat_at": now - timedelta(seconds=10)})()
        assert worker_is_gone(job, now=now) is False


class TestCheckpointJob:
    async def test_raises_when_a_cancel_was_requested(self, session: AsyncSession) -> None:
        user = await _make_user(session)
        space = await _make_space(session, user)
        job = await create_document_import_job(
            session, FakeStorage(), space=space, parent_id=None, documents=[], creator=user
        )
        await session.commit()
        job.cancel_requested = True
        await session.commit()

        with pytest.raises(DocumentImportCancelled):
            await checkpoint_job(session, job)

    async def test_stamps_the_heartbeat_and_merges_counters(
        self, session: AsyncSession
    ) -> None:
        user = await _make_user(session)
        space = await _make_space(session, user)
        job = await create_document_import_job(
            session, FakeStorage(), space=space, parent_id=None, documents=[], creator=user
        )
        await session.commit()
        assert job.heartbeat_at is None

        await checkpoint_job(session, job, counters={"items_processed": 1})

        assert job.heartbeat_at is not None
        assert job.counters["items_processed"] == 1
        # The rest of the initial counters survive the merge.
        assert job.counters["items_total"] == 0
