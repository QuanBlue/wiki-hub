"""The attachments step of a Confluence import must report progress and obey Cancel.

A 5,000-file import once sat silent for an hour, ignored four presses of Cancel
and then finished anyway - so the operator could not tell working from hung.
"""

from __future__ import annotations

import uuid
import zipfile
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.models.import_job import ImportLog
from app.modules.import_export import service as import_module
from app.modules.import_export.confluence import (
    ConfluenceAttachment,
    ConfluencePage,
    ConfluenceSpace,
)


class _Result:
    """Stands in for every query the import makes; `flags` feeds the Cancel check."""

    def __init__(self, flags: list[bool]):
        self._flags = flags

    def scalar_one_or_none(self):
        return None

    def scalar_one(self):
        return self._flags.pop(0) if len(self._flags) > 1 else self._flags[0]

    def scalars(self):
        return self

    def first(self):
        return None

    def __iter__(self):
        return iter([])


def _harness(monkeypatch: pytest.MonkeyPatch, attachments, cancel_flags: list[bool]):
    monkeypatch.setattr(import_module, "CANCEL_CHECK_INTERVAL_SECONDS", 0)
    monkeypatch.setattr(import_module, "PROGRESS_LOG_INTERVAL_SECONDS", 0)
    added: list[object] = []

    async def flush() -> None:
        for item in added:
            if getattr(item, "id", None) is None:
                item.id = uuid.uuid4()

    session = Mock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()
    session.flush = AsyncMock(side_effect=flush)
    session.add = Mock(side_effect=added.append)
    session.new = []
    session.execute = AsyncMock(return_value=_Result(cancel_flags))
    job = SimpleNamespace(
        id=uuid.uuid4(),
        archive_id=uuid.uuid4(),
        status="queued",
        phase="queued",
        import_all=True,
        space_keys=[],
        overwrite_existing=False,
        created_by_id=uuid.uuid4(),
        cancel_requested=False,
        counters={"download_percent": 0, "spaces_completed": 0, "pages_processed": 0},
    )
    archive = SimpleNamespace(object_key="archive.zip", size_bytes=1)
    session.get = AsyncMock(side_effect=[job, archive, job])

    async def download(_key, target, **_kwargs):
        with zipfile.ZipFile(target, "w") as source:
            source.writestr("attachments/att-1", b"data")

    storage = Mock(download_to_file=AsyncMock(side_effect=download), put=AsyncMock())
    page = ConfluencePage("page-1", "space-1", None, "ENG", "current", None, None)
    space = ConfluenceSpace("space-1", "ENG", "Engineering", [page])
    monkeypatch.setattr(import_module, "scan_archive", lambda _path: [space])
    monkeypatch.setattr(
        import_module,
        "iter_page_bodies",
        lambda _path: [
            ("page-1", '<p>x</p><ac:image><ri:attachment ri:filename="doc.txt" /></ac:image>')
        ],
    )
    monkeypatch.setattr(import_module, "iter_attachments", lambda _path: attachments)
    return session, storage, job, added


def _messages(added: list[object]) -> list[str]:
    return [item.message for item in added if isinstance(item, ImportLog)]


@pytest.mark.asyncio
async def test_a_long_attachments_step_writes_progress_lines(monkeypatch: pytest.MonkeyPatch) -> None:
    missing = [
        (ConfluenceAttachment(f"att-{i}", "page-1", f"f{i}.bin", "x/y"), None) for i in range(3)
    ]
    session, storage, job, added = _harness(monkeypatch, missing, [False])

    await import_module.run_import(session, storage, job.id)

    assert job.status == "completed"
    messages = _messages(added)
    assert "Attachments: 0 of 3 processed (0 imported, 0 missing)." in messages
    assert "Attachments: 2 of 3 processed (0 imported, 2 missing)." in messages


@pytest.mark.asyncio
async def test_cancel_stops_the_attachments_step(monkeypatch: pytest.MonkeyPatch) -> None:
    attachment = ConfluenceAttachment("att-1", "page-1", "doc.txt", "text/plain")
    session, storage, job, added = _harness(
        monkeypatch, [(attachment, "attachments/att-1")], [True]
    )

    await import_module.run_import(session, storage, job.id)

    assert job.status == "cancelled"
    storage.put.assert_not_awaited()
    assert "Import cancelled by administrator." in _messages(added)


@pytest.mark.asyncio
async def test_cancel_stops_the_linking_step(monkeypatch: pytest.MonkeyPatch) -> None:
    attachment = ConfluenceAttachment("att-1", "page-1", "doc.txt", "text/plain")
    # Not cancelled while files upload; cancelled by the time links are written.
    session, storage, job, added = _harness(
        monkeypatch, [(attachment, "attachments/att-1")], [False, True]
    )

    await import_module.run_import(session, storage, job.id)

    storage.put.assert_awaited_once()
    assert job.status == "cancelled"
    assert any(message.startswith("Linking 1 attachments into 1 pages") for message in _messages(added))
