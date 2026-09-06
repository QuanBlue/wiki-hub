"""The document-import worker, against a real PostgreSQL database.

These need a real session rather than mocks: the per-file isolation this
feature promises is a SAVEPOINT, and whether a half-created page really rolls
back is a database question, not a Python one.

The converter is patched throughout - what is under test is the worker's
bookkeeping (isolation, counters, revision back-fill, cleanup), not pandoc.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attachment import PageAttachment
from app.models.document_import import DocumentImportItem, DocumentImportJob
from app.models.page import WikiPage
from app.models.revision import PageRevision
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.document_import import jobs as jobs_module
from app.modules.document_import.convert import ExtractedDocument, ExtractedMedia, new_media_token
from app.modules.document_import.jobs import (
    reap_abandoned_document_imports,
    run_document_import,
)
from app.modules.document_import.service import staged_object_key
from app.modules.pages.service import PageService
from app.modules.spaces.service import SpaceService
from app.schemas.page import PageCreate
from app.schemas.space import SpaceCreate
from app.schemas.user import UserCreate

pytestmark = pytest.mark.integration


def _uniq(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


async def _make_user(session: AsyncSession) -> User:
    return await AuthService(session).create_user(
        UserCreate(
            username=_uniq("u"),
            email=f"{_uniq('u')}@example.com",
            full_name="Importer",
            password="password-1234",
        )
    )


class FakeStorage:
    """In-memory object store that records every write and delete."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []

    async def put(self, key: str, data, *, content_type: str = "", metadata=None):
        self.objects[key] = data if isinstance(data, bytes) else data.read()
        return None

    async def get(self, key: str) -> bytes:
        return self.objects[key]

    async def delete(self, key: str) -> None:
        self.deleted.append(key)
        self.objects.pop(key, None)

    async def list_objects(self, prefix: str = ""):
        class _Stored:
            def __init__(self, key: str):
                self.key = key

        return [_Stored(k) for k in list(self.objects) if k.startswith(prefix)]


async def _imported_pages(session: AsyncSession, space) -> list[WikiPage]:
    """Pages in the space that the import created.

    `SpaceService.create` always seeds a home page (slug == the space key), so
    a bare page count would be off by one in every assertion here.

    The refresh is needed because the worker rolls back on the cancel path,
    which expires every instance this test is still holding.
    """
    await session.refresh(space)
    pages = (
        (await session.execute(select(WikiPage).where(WikiPage.space_id == space.id)))
        .scalars()
        .all()
    )
    return [page for page in pages if page.slug != space.key.lower()]


async def _make_job(
    session: AsyncSession,
    storage: FakeStorage,
    filenames: list[str],
    *,
    parent_id: uuid.UUID | None = None,
) -> tuple[DocumentImportJob, object, User]:
    user = await _make_user(session)
    space = await SpaceService(session).create(
        SpaceCreate(key=_uniq("SP").upper()[:8], name="Imports"), user
    )
    job = DocumentImportJob(
        space_id=space.id,
        parent_id=parent_id,
        created_by_id=user.id,
        status="queued",
        phase="queued",
        counters={"items_total": len(filenames), "items_processed": 0},
    )
    session.add(job)
    await session.flush()
    for position, filename in enumerate(filenames):
        item_id = uuid.uuid4()
        key = staged_object_key(job.id, item_id, filename)
        storage.objects[key] = b"staged bytes"
        session.add(
            DocumentImportItem(
                id=item_id,
                job_id=job.id,
                position=position,
                filename=filename,
                content_type="application/octet-stream",
                object_key=key,
                size_bytes=12,
                source_format="docx",
                status="queued",
            )
        )
    await session.commit()
    await session.refresh(job)
    return job, space, user


def _patch_extract(monkeypatch, by_filename: dict[str, object]) -> None:
    """Replace the converter with a lookup keyed on the source filename."""

    async def fake_extract(source, *, filename: str, workdir):
        outcome = by_filename[filename]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(jobs_module, "extract_document", fake_extract)


class TestHappyPath:
    async def test_replace_updates_the_page_matching_the_uploaded_filename(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A document heading may differ from the filename shown in the dialog."""
        storage = FakeStorage()
        job, space, user = await _make_job(session, storage, ["Technical Profile.pdf"])
        job.conflict_mode = "replace"
        existing = await PageService(session).create(
            space,
            PageCreate(title="Technical Profile", content="<p>Old body.</p>"),
            user,
        )
        await session.commit()
        _patch_extract(
            monkeypatch,
            {
                "Technical Profile.pdf": ExtractedDocument(
                    html="<h1>System Technical Profile</h1><p>New body.</p>"
                )
            },
        )

        await run_document_import(session, storage, job.id)

        pages = await _imported_pages(session, space)
        assert [page.id for page in pages] == [existing.id]
        assert pages[0].title == "Technical Profile"
        assert "New body." in pages[0].content

    async def test_keep_both_numbers_each_duplicate_title_in_order(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The title comes from the *filename*, not the document's own
        # heading (see normalize.py's module docstring) - three files
        # sharing one name is what has to collide here, not three files
        # that happen to share an <h1>.
        storage = FakeStorage()
        job, space, _ = await _make_job(
            session, storage, ["Architecture.docx", "Architecture.docx", "Architecture.docx"]
        )
        job.conflict_mode = "rename"
        _patch_extract(
            monkeypatch,
            {"Architecture.docx": ExtractedDocument(html="<h1>Body</h1><p>Body.</p>")},
        )

        await run_document_import(session, storage, job.id)

        assert {page.title for page in await _imported_pages(session, space)} == {
            "Architecture",
            "Architecture (1)",
            "Architecture (2)",
        }

    async def test_keep_both_numbers_a_duplicate_vietnamese_title(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A title with uppercase accented letters must still be recognised.

        This database's cluster locale is `C`, under which Postgres's own
        `lower()` leaves accented uppercase letters untouched
        (``lower('TẬP')`` returns ``'tẬp'``, not ``'tập'``) - a real bug that
        made every re-import of the same Vietnamese-titled document create an
        exact duplicate instead of a numbered copy. An ASCII title such as
        "Architecture" above would never have caught it.
        """
        storage = FakeStorage()
        title = "TẬP ĐOÀN CÔNG NGHIỆP - VIỄN THÔNG QUÂN ĐỘI"
        filename = f"{title}.docx"
        job, space, _ = await _make_job(session, storage, [filename, filename])
        job.conflict_mode = "rename"
        _patch_extract(
            monkeypatch,
            {filename: ExtractedDocument(html="<h1>Body</h1><p>Body.</p>")},
        )

        await run_document_import(session, storage, job.id)

        assert {page.title for page in await _imported_pages(session, space)} == {
            title,
            f"{title} (1)",
        }

    async def test_each_file_becomes_a_page_under_the_chosen_parent(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        storage = FakeStorage()
        job, space, user = await _make_job(session, storage, ["one.docx", "two.docx"])
        _patch_extract(
            monkeypatch,
            {
                "one.docx": ExtractedDocument(html="<h1>First</h1><p>Body one.</p>"),
                "two.docx": ExtractedDocument(html="<h1>Second</h1><p>Body two.</p>"),
            },
        )

        await run_document_import(session, storage, job.id)
        await session.refresh(job)

        assert job.status == "complete"
        assert job.counters["pages_created"] == 2
        assert job.counters["items_failed"] == 0

        pages = await _imported_pages(session, space)
        # Title comes from the filename, not either document's <h1> - see
        # normalize.py's module docstring.
        assert {page.title for page in pages} == {"one", "two"}
        for page in pages:
            assert page.created_by_id == user.id
            assert page.parent_id == job.parent_id

    async def test_the_title_comes_from_the_filename_not_the_document_heading(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Every imported page is titled after its source filename - a
        document's own heading is deliberately left in the body as ordinary
        content rather than promoted into the title and stripped out (see
        normalize.py's module docstring). This used to be the opposite:
        the heading became the title and was removed from the body, so this
        guards against sliding back to that."""
        storage = FakeStorage()
        job, _space, _ = await _make_job(session, storage, ["one.docx"])
        _patch_extract(
            monkeypatch, {"one.docx": ExtractedDocument(html="<h1>Report</h1><p>Body.</p>")}
        )
        await run_document_import(session, storage, job.id)

        page = (
            await session.execute(select(WikiPage).where(WikiPage.title == "one"))
        ).scalar_one()
        assert "Report" in page.content
        assert "Body." in page.content

    async def test_revision_one_carries_the_imported_content_and_there_is_no_v2(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Calling update() after create() would leave an empty v1 in history
        # and add a v2 nobody made - the page would look edited on arrival.
        storage = FakeStorage()
        job, _, _ = await _make_job(session, storage, ["one.docx"])
        _patch_extract(
            monkeypatch, {"one.docx": ExtractedDocument(html="<h1>T</h1><p>Imported body.</p>")}
        )
        await run_document_import(session, storage, job.id)

        page = (
            await session.execute(select(WikiPage).where(WikiPage.title == "one"))
        ).scalar_one()
        revisions = (
            (
                await session.execute(
                    select(PageRevision)
                    .where(PageRevision.page_id == page.id)
                    .order_by(PageRevision.version)
                )
            )
            .scalars()
            .all()
        )
        assert len(revisions) == 1
        assert revisions[0].version == 1
        assert "Imported body." in revisions[0].content
        assert revisions[0].change_summary == "Imported from one.docx"

    async def test_the_item_row_records_what_it_produced(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        storage = FakeStorage()
        job, _, _ = await _make_job(session, storage, ["notes.docx"])
        _patch_extract(
            monkeypatch, {"notes.docx": ExtractedDocument(html="<h1>Notes</h1><p>x</p>")}
        )
        await run_document_import(session, storage, job.id)
        await session.refresh(job)

        item = job.items[0]
        assert item.status == "complete"
        assert item.page_id is not None
        assert item.page_title == "notes"
        assert item.page_slug
        assert item.error is None


class TestEmbeddedImages:
    async def test_images_become_attachments_and_the_html_points_at_them(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        storage = FakeStorage()
        job, _, _ = await _make_job(session, storage, ["with-image.docx"])
        token = new_media_token()
        _patch_extract(
            monkeypatch,
            {
                "with-image.docx": ExtractedDocument(
                    html=f'<h1>Doc</h1><p><img src="{token}"/></p>',
                    media=[
                        ExtractedMedia(
                            token=token,
                            filename="figure.png",
                            data=b"\x89PNG" + b"x" * 900,
                            content_type="image/png",
                        )
                    ],
                )
            },
        )

        await run_document_import(session, storage, job.id)
        await session.refresh(job)

        page = (
            await session.execute(select(WikiPage).where(WikiPage.title == "with-image"))
        ).scalar_one()
        attachment = (
            await session.execute(
                select(PageAttachment).where(PageAttachment.page_id == page.id)
            )
        ).scalar_one()
        assert attachment.filename == "figure.png"
        assert f"/api/v1/attachments/{attachment.id}/content" in page.content
        # No placeholder may ever reach stored content.
        assert "wikihub-import-media:" not in page.content
        assert job.items[0].attachments_created == 1
        assert storage.objects[attachment.object_key] == b"\x89PNG" + b"x" * 900

    async def test_an_unresolved_image_is_dropped_rather_than_left_broken(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        storage = FakeStorage()
        job, _, _ = await _make_job(session, storage, ["ghost.docx"])
        token = new_media_token()
        _patch_extract(
            monkeypatch,
            {
                # A token with no media entry: the image did not survive extraction.
                "ghost.docx": ExtractedDocument(
                    html=f'<h1>Ghost</h1><p><img src="{token}"/></p><p>text</p>', media=[]
                )
            },
        )
        await run_document_import(session, storage, job.id)

        page = (
            await session.execute(select(WikiPage).where(WikiPage.title == "ghost"))
        ).scalar_one()
        assert "<img" not in page.content
        assert "text" in page.content


class TestPerFileIsolation:
    async def test_one_failing_file_does_not_stop_the_others(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        storage = FakeStorage()
        job, _, _ = await _make_job(session, storage, ["a.docx", "b.docx", "c.docx"])
        _patch_extract(
            monkeypatch,
            {
                "a.docx": ExtractedDocument(html="<h1>Alpha</h1><p>1</p>"),
                "b.docx": ValueError("this document is corrupt"),
                "c.docx": ExtractedDocument(html="<h1>Charlie</h1><p>3</p>"),
            },
        )

        await run_document_import(session, storage, job.id)
        await session.refresh(job)

        by_name = {item.filename: item for item in job.items}
        assert by_name["a.docx"].status == "complete"
        assert by_name["b.docx"].status == "failed"
        assert "corrupt" in (by_name["b.docx"].error or "")
        assert by_name["c.docx"].status == "complete"

        assert job.status == "complete"
        assert job.counters["items_failed"] == 1
        assert job.counters["pages_created"] == 2

    async def test_a_failed_file_leaves_no_page_and_no_attachment_behind(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The page and its attachments are created before the failure point,
        # so this is the SAVEPOINT actually doing its job.
        storage = FakeStorage()
        job, space, _ = await _make_job(session, storage, ["boom.docx"])
        token = new_media_token()

        original_sanitize = jobs_module.sanitize_imported_html

        def explode_after_attachments(html: str) -> str:
            raise RuntimeError("failure after the page and attachments exist")

        _patch_extract(
            monkeypatch,
            {
                "boom.docx": ExtractedDocument(
                    html=f'<h1>Boom</h1><p><img src="{token}"/></p>',
                    media=[
                        ExtractedMedia(
                            token=token,
                            filename="f.png",
                            data=b"\x89PNG" + b"y" * 900,
                            content_type="image/png",
                        )
                    ],
                )
            },
        )
        monkeypatch.setattr(jobs_module, "sanitize_imported_html", explode_after_attachments)

        await run_document_import(session, storage, job.id)
        monkeypatch.setattr(jobs_module, "sanitize_imported_html", original_sanitize)
        await session.refresh(job)

        assert job.items[0].status == "failed"
        assert await _imported_pages(session, space) == []
        attachments = (
            (await session.execute(select(PageAttachment))).scalars().all()
        )
        assert attachments == []

    async def test_a_failed_file_leaves_no_orphaned_blob_in_storage(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        storage = FakeStorage()
        job, _, _ = await _make_job(session, storage, ["boom.docx"])
        token = new_media_token()
        _patch_extract(
            monkeypatch,
            {
                "boom.docx": ExtractedDocument(
                    html=f'<h1>B</h1><p><img src="{token}"/></p>',
                    media=[
                        ExtractedMedia(
                            token=token,
                            filename="f.png",
                            data=b"\x89PNG" + b"z" * 900,
                            content_type="image/png",
                        )
                    ],
                )
            },
        )
        monkeypatch.setattr(
            jobs_module,
            "sanitize_imported_html",
            lambda _html: (_ for _ in ()).throw(RuntimeError("late failure")),
        )

        await run_document_import(session, storage, job.id)

        # The savepoint rolled the rows back; the blobs are compensated for
        # explicitly, because storage has no transaction to join.
        leftover = [key for key in storage.objects if key.startswith("attachments/")]
        assert leftover == []

    async def test_every_file_failing_is_reported_as_a_failed_job(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        storage = FakeStorage()
        job, _, _ = await _make_job(session, storage, ["a.docx", "b.docx"])
        _patch_extract(
            monkeypatch,
            {"a.docx": ValueError("bad"), "b.docx": ValueError("also bad")},
        )

        await run_document_import(session, storage, job.id)
        await session.refresh(job)

        assert job.status == "failed"
        assert job.error == "No document could be imported."


class TestCancellation:
    async def test_a_cancel_request_stops_the_batch_and_keeps_finished_pages(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        storage = FakeStorage()
        job, space, _ = await _make_job(session, storage, ["a.docx", "b.docx", "c.docx"])

        async def fake_extract(source, *, filename: str, workdir):
            return ExtractedDocument(html=f"<h1>{filename}</h1><p>body</p>")

        monkeypatch.setattr(jobs_module, "extract_document", fake_extract)

        # In production the flag is written by the API in a different session
        # and observed at the next checkpoint. Setting it from inside the
        # worker's own SAVEPOINT would close that transaction, which is a
        # situation that cannot arise for real.
        real_checkpoint = jobs_module.checkpoint_job
        calls = {"n": 0}

        async def cancel_before_the_second_file(sess, j, **kwargs):
            calls["n"] += 1
            if calls["n"] == 2:
                j.cancel_requested = True
                await sess.commit()
            await real_checkpoint(sess, j, **kwargs)

        monkeypatch.setattr(jobs_module, "checkpoint_job", cancel_before_the_second_file)

        await run_document_import(session, storage, job.id)
        await session.refresh(job)

        assert job.status == "cancelled"
        by_name = {item.filename: item.status for item in job.items}
        assert by_name["a.docx"] == "complete"
        # Nothing is left looking as though it might still run.
        assert "queued" not in by_name.values()
        assert "running" not in by_name.values()

        pages = await _imported_pages(session, space)
        assert [page.title for page in pages] == ["a"]


class TestIdempotenceAndCleanup:
    async def test_a_job_that_already_ran_is_not_run_again(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # arq re-runs a task when a worker dies mid-job; a second pass must not
        # produce a second copy of every page.
        storage = FakeStorage()
        job, space, _ = await _make_job(session, storage, ["a.docx"])
        _patch_extract(monkeypatch, {"a.docx": ExtractedDocument(html="<h1>Once</h1><p>x</p>")})

        await run_document_import(session, storage, job.id)
        await run_document_import(session, storage, job.id)

        assert len(await _imported_pages(session, space)) == 1

    async def test_staged_uploads_are_deleted_when_the_job_finishes(
        self, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        storage = FakeStorage()
        job, _, _ = await _make_job(session, storage, ["a.docx"])
        _patch_extract(monkeypatch, {"a.docx": ExtractedDocument(html="<h1>A</h1><p>x</p>")})

        await run_document_import(session, storage, job.id)

        assert not [key for key in storage.objects if key.startswith("imports/documents/")]


class TestReaper:
    async def test_a_running_job_with_no_heartbeat_is_finalised(
        self, session: AsyncSession
    ) -> None:
        storage = FakeStorage()
        job, _, _ = await _make_job(session, storage, ["a.docx"])
        job.status, job.phase = "running", "converting"
        job.heartbeat_at = None
        await session.commit()

        reaped = await reap_abandoned_document_imports(session, every_running_job=True)
        await session.refresh(job)

        assert reaped == 1
        assert job.status == "failed"
        assert "worker stopped" in (job.error or "")
        assert job.items[0].status == "cancelled" or job.items[0].status == "failed"

    async def test_a_cancelled_job_is_reported_as_cancelled_not_failed(
        self, session: AsyncSession
    ) -> None:
        storage = FakeStorage()
        job, _, _ = await _make_job(session, storage, ["a.docx"])
        job.status, job.phase = "running", "converting"
        job.heartbeat_at = None
        job.cancel_requested = True
        await session.commit()

        await reap_abandoned_document_imports(session, every_running_job=True)
        await session.refresh(job)

        # Reporting a user's own cancellation as a failure blames them for
        # something they chose.
        assert job.status == "cancelled"
        assert job.error is None

    async def test_a_healthy_running_job_is_left_alone(self, session: AsyncSession) -> None:
        from datetime import UTC, datetime

        storage = FakeStorage()
        job, _, _ = await _make_job(session, storage, ["a.docx"])
        job.status, job.phase = "running", "converting"
        job.heartbeat_at = datetime.now(UTC)
        await session.commit()

        reaped = await reap_abandoned_document_imports(session)
        await session.refresh(job)

        assert reaped == 0
        assert job.status == "running"
