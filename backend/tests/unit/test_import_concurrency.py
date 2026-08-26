"""The cross-flow guard: a Confluence import and a WikiHub restore must never
apply at the same time.

Both write `Space`/`WikiPage`/`PageAttachment` rows and an overwrite restore
deletes a space's pages outright, while the worker happily runs several jobs
at once - so this is a data-safety rule, not a UI nicety.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, Mock

import pytest

from app.core.exceptions import ConflictError
from app.services.import_concurrency import (
    ACTIVE_JOB_STATUSES,
    assert_no_active_confluence_import,
    assert_no_active_wikihub_restore,
)


def _session(row):
    """A session whose single query returns `row` (None = nothing active)."""
    result = Mock()
    result.first.return_value = row
    return AsyncMock(execute=AsyncMock(return_value=result))


@pytest.mark.asyncio
async def test_restore_is_blocked_while_a_confluence_import_runs():
    with pytest.raises(ConflictError, match="Confluence import is still running"):
        await assert_no_active_confluence_import(_session((uuid.uuid4(),)))


@pytest.mark.asyncio
async def test_restore_is_allowed_when_no_confluence_import_runs():
    await assert_no_active_confluence_import(_session(None))


@pytest.mark.asyncio
async def test_confluence_import_is_blocked_while_a_restore_runs():
    with pytest.raises(ConflictError, match="WikiHub restore is still running"):
        await assert_no_active_wikihub_restore(_session((uuid.uuid4(),)))


@pytest.mark.asyncio
async def test_confluence_import_is_allowed_when_no_restore_runs():
    await assert_no_active_wikihub_restore(_session(None))


def test_active_statuses_exclude_terminal_states():
    """Matching on the *active* set keeps the two tables' differing terminal
    vocabularies ("completed" vs "complete") from producing a false negative
    that would let both jobs run."""
    assert set(ACTIVE_JOB_STATUSES) == {"queued", "running"}
    for terminal in ("complete", "completed", "failed", "cancelled"):
        assert terminal not in ACTIVE_JOB_STATUSES


# -- the guard is actually wired into both job-creation endpoints -----------


@pytest.mark.asyncio
async def test_create_backup_import_endpoint_refuses_during_a_confluence_import(monkeypatch):
    from app.api.v1 import backup as backup_api
    from app.schemas.backup import BackupImportCreate

    created = AsyncMock()
    monkeypatch.setattr(backup_api, "create_import_job", created)
    monkeypatch.setattr(backup_api, "_enqueue", AsyncMock())

    with pytest.raises(ConflictError, match="Confluence import is still running"):
        await backup_api.create_backup_import(
            uuid.uuid4(),
            BackupImportCreate(),
            Mock(id=uuid.uuid4()),
            _session((uuid.uuid4(),)),
        )
    # Refused before any job row is created, not after.
    created.assert_not_called()


@pytest.mark.asyncio
async def test_create_confluence_job_endpoint_refuses_during_a_restore(monkeypatch):
    from types import SimpleNamespace

    from app.api.v1 import confluence_import as imports_api

    importer = AsyncMock()
    importer.session = _session((uuid.uuid4(),))
    monkeypatch.setattr(imports_api, "enqueue", AsyncMock())

    with pytest.raises(ConflictError, match="WikiHub restore is still running"):
        await imports_api.create_job(
            uuid.uuid4(),
            SimpleNamespace(import_all=True, space_keys=[], overwrite_existing=False),
            Mock(id=uuid.uuid4()),
            importer,
        )
    importer.create_job.assert_not_called()
