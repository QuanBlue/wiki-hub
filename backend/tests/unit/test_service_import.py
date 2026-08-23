from __future__ import annotations

from unittest.mock import AsyncMock, Mock, patch

import pytest
from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestError
from app.modules.backup.service import BackupService
from app.schemas.backup import BackupDocument

@pytest.fixture
def mock_session():
    return AsyncMock(spec=Session)

@pytest.fixture
def service(mock_session) -> BackupService:
    result = BackupService(mock_session)
    result.audit = Mock(record=AsyncMock())
    return result

@pytest.mark.asyncio
async def test_restore_full_package(service: BackupService):
    service.session.begin_nested = AsyncMock()
    service.session.commit = AsyncMock()
    service.session.rollback = AsyncMock()
    service.session.flush = AsyncMock()
    mock_storage = AsyncMock()
    
    mock_scanned = Mock()
    mock_scanned.document.spaces = [Mock(key="SPACE1"), Mock(key="SPACE2")]
    mock_scanned.document.wikihub_backup.version = 1
    mock_scanned.document.wikihub_backup.includes_credentials = False
    mock_scanned.document.attachments = []
    mock_scanned.document.avatars = []
    
    with patch("app.modules.backup.service.scan_full_backup", return_value=mock_scanned), \
         patch("app.modules.backup.service.zipfile.ZipFile"):
        def make_result(items):
            res = Mock()
            res.all.return_value = items
            res.scalars.return_value = items
            return res
            
        async def side_effect(*args, **kwargs):
            return side_effect.result
        side_effect.result = make_result([("id1", "SPACE1")])
        service.session.execute.side_effect = side_effect
        
        # Test 1: overwrite invalid space
        with pytest.raises(BadRequestError, match="Only conflicting spaces"):
            await service.restore_full_package("path.zip", mock_storage, dry_run=False, overwrite_space_keys={"INVALID"})

        # Add another space so it doesn't conflict
        side_effect.result = make_result([])
        
        # Mock _apply
        service._apply = AsyncMock()
        
        report = await service.restore_full_package("path.zip", mock_storage, dry_run=False)
        assert report.version == 1
        assert report.includes_credentials is False
        
        service._apply.assert_awaited_once()

@pytest.mark.asyncio
async def test_restore_full_package_dry_run(service: BackupService):
    service.session.begin_nested = AsyncMock()
    service.session.commit = AsyncMock()
    service.session.rollback = AsyncMock()
    service.session.flush = AsyncMock()
    mock_storage = AsyncMock()
    mock_scanned = Mock()
    mock_scanned.document.spaces = []
    mock_scanned.document.wikihub_backup.version = 1
    mock_scanned.document.wikihub_backup.includes_credentials = False
    
    with patch("app.modules.backup.service.scan_full_backup", return_value=mock_scanned), \
         patch("app.modules.backup.service.zipfile.ZipFile"):
        def make_result(items):
            res = Mock()
            res.all.return_value = items
            res.scalars.return_value = items
            return res
        async def side_effect(*args, **kwargs):
            return make_result([])
        service.session.execute.side_effect = side_effect
        service._apply = AsyncMock()
        
        report = await service.restore_full_package("path.zip", mock_storage, dry_run=True)
        assert report.dry_run is True
        
        service._apply.assert_awaited_once()
