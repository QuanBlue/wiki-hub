import uuid
import pytest
from unittest.mock import AsyncMock, Mock
from xml.etree.ElementTree import Element

from app.modules.backup.confluence_export import _property, write_confluence_dc_export
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
