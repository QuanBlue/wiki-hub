import uuid
import pytest
from unittest.mock import AsyncMock, Mock
from xml.etree.ElementTree import Element

from app.modules.backup.confluence_export import _property, write_confluence_dc_export
from app.modules.backup.service import ExportCancelled
from app.models.backup_job import BackupJob
from app.models.space import Space
from app.models.page import WikiPage
from app.models.attachment import PageAttachment
from datetime import datetime, UTC

def test_property():
    e = Element("root")
    _property(e, "test_none", None)
    assert len(e) == 0
    
    _property(e, "test_str", "hello")
    assert len(e) == 1
    assert e[0].tag == "property"
    assert e[0].attrib["name"] == "test_str"
    assert e[0].text == "hello"

@pytest.mark.asyncio
async def test_write_confluence_dc_export(tmp_path):
    storage = AsyncMock()
    path = str(tmp_path / "export.zip")
    
    s = Space(id=uuid.uuid4(), key="TEST", name="Test", description="test desc")
    p = WikiPage(id=uuid.uuid4(), space_id=s.id, title="P1", slug="p1", created_at=datetime.now(UTC), updated_at=datetime.now(UTC))
    a = PageAttachment(id=uuid.uuid4(), page_id=p.id, filename="att.png", content_type="image/png", size_bytes=100, object_key="o/b.png")
    
    # invalid profile
    with pytest.raises(ValueError, match="supported Confluence Data Center profile is required"):
        await write_confluence_dc_export(path, storage, profile="invalid", spaces=[s], pages=[p], attachments=[a])
        
    storage.get = AsyncMock(return_value=b"pngdata")
    await write_confluence_dc_export(path, storage, profile="dc-8", spaces=[s], pages=[p], attachments=[a])
    
    import zipfile
    with zipfile.ZipFile(path, "r") as zf:
        xml = zf.read("entities.xml").decode()
        assert "TEST" in xml
        assert "P1" in xml
        
        # Attachment should be in there
        atts = [info for info in zf.infolist() if "attachments/" in info.filename]
        assert len(atts) == 1


@pytest.mark.asyncio
async def test_write_confluence_dc_export_reports_progress(tmp_path):
    storage = AsyncMock()
    storage.get = AsyncMock(return_value=b"pngdata")
    session = AsyncMock()
    path = str(tmp_path / "export.zip")

    s = Space(id=uuid.uuid4(), key="TEST", name="Test", description="test desc")
    p = WikiPage(id=uuid.uuid4(), space_id=s.id, title="P1", slug="p1", created_at=datetime.now(UTC), updated_at=datetime.now(UTC))
    attachments = [
        PageAttachment(id=uuid.uuid4(), page_id=p.id, filename=f"att-{i}.png", content_type="image/png", size_bytes=100, object_key=f"o/b{i}.png")
        for i in range(2)
    ]
    job = BackupJob(id=uuid.uuid4(), kind="confluence_export", status="running", counters={}, cancel_requested=False)

    await write_confluence_dc_export(
        path, storage, profile="dc-8", spaces=[s], pages=[p], attachments=attachments,
        session=session, job=job,
    )

    assert job.counters["items_total"] == 2
    assert job.counters["items_processed"] == 2
    # Two attachments is under the 25-item cadence, so the only progress-bearing
    # checkpoint is the forced one on the final item. The rest come from the
    # phase boundaries around XML serialisation, which exist to keep the
    # heartbeat fresh through work that reports nothing.
    assert job.heartbeat_at is not None
    assert session.refresh.await_count >= 1
    assert session.commit.await_count == session.refresh.await_count


@pytest.mark.asyncio
async def test_write_confluence_dc_export_cancelled_mid_run(tmp_path):
    storage = AsyncMock()
    storage.get = AsyncMock(return_value=b"pngdata")
    session = AsyncMock()
    path = str(tmp_path / "export.zip")

    s = Space(id=uuid.uuid4(), key="TEST", name="Test", description="test desc")
    p = WikiPage(id=uuid.uuid4(), space_id=s.id, title="P1", slug="p1", created_at=datetime.now(UTC), updated_at=datetime.now(UTC))
    attachments = [
        PageAttachment(id=uuid.uuid4(), page_id=p.id, filename=f"att-{i}.png", content_type="image/png", size_bytes=100, object_key=f"o/b{i}.png")
        for i in range(2)
    ]
    job = BackupJob(id=uuid.uuid4(), kind="confluence_export", status="running", counters={}, cancel_requested=False)

    async def cancel_on_refresh(_obj):
        job.cancel_requested = True

    session.refresh.side_effect = cancel_on_refresh

    with pytest.raises(ExportCancelled):
        await write_confluence_dc_export(
            path, storage, profile="dc-8", spaces=[s], pages=[p], attachments=attachments,
            session=session, job=job,
        )


@pytest.mark.asyncio
async def test_write_confluence_dc_export_detects_cancel_mid_plateau(tmp_path):
    """Regression test for a real bug: the reported percent is capped at 99
    (`min(99, ...)`), so once processing crosses that cap every remaining item
    reports the same percent. Gating the cancellation check on "percent
    changed" (the original implementation) meant `cancel_requested` was never
    observed again for the rest of a large export once it hit 99% - a Cancel
    export click during that stretch silently did nothing until the whole
    (potentially huge) remainder finished on its own.

    The fix checks on a fixed item cadence instead. With 3000 total items, two
    of those fixed checkpoints (item 2975 and the final item 3000) fall inside
    the 99%-plateau; flipping the flag at the earlier one proves it is caught
    there rather than only once every last item has already been processed.
    """
    storage = AsyncMock()
    storage.get = AsyncMock(return_value=b"pngdata")
    session = AsyncMock()
    path = str(tmp_path / "export.zip")

    s = Space(id=uuid.uuid4(), key="TEST", name="Test", description="test desc")
    p = WikiPage(id=uuid.uuid4(), space_id=s.id, title="P1", slug="p1", created_at=datetime.now(UTC), updated_at=datetime.now(UTC))
    total = 10_000
    attachments = [
        PageAttachment(id=uuid.uuid4(), page_id=p.id, filename=f"att-{i}.png", content_type="image/png", size_bytes=100, object_key=f"o/b{i}.png")
        for i in range(total)
    ]
    job = BackupJob(id=uuid.uuid4(), kind="confluence_export", status="running", counters={}, cancel_requested=False)

    # Items 9900..10000 all report percent 99 (the cap). Request cancellation
    # once the checkpoint at item 9900 has been recorded, so the next one at
    # 9925 sees an unchanged percent - precisely the condition under which the
    # old implementation stopped looking at `cancel_requested`.
    async def cancel_once_inside_the_plateau(_obj):
        if job.counters.get("items_processed", 0) >= 9900:
            job.cancel_requested = True

    session.refresh.side_effect = cancel_once_inside_the_plateau

    with pytest.raises(ExportCancelled):
        await write_confluence_dc_export(
            path, storage, profile="dc-8", spaces=[s], pages=[p], attachments=attachments,
            session=session, job=job,
        )
    # Stopped at 9925, short of the final item - so this was caught by a
    # mid-plateau checkpoint, not by the guaranteed last-item one.
    assert storage.get.await_count == 9925
    assert job.counters["items_processed"] == 9900
