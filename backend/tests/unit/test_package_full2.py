import os
import zipfile
import hashlib
import json
import tempfile
import uuid
import pytest
from pathlib import Path
from unittest.mock import patch, Mock

from app.modules.backup.package import scan_full_backup, MAX_ARCHIVE_ENTRIES, MAX_COMPRESSION_RATIO
from app.core.exceptions import PayloadTooLargeError, BadRequestError

def create_zip(path, files):
    with zipfile.ZipFile(path, 'w') as zf:
        for k, v in files.items():
            zf.writestr(k, v)

def test_scan_full_backup_bad_cases(tmp_path: Path):
    from app.core.config import settings
    
    # 1. archive size > max_import_size_bytes
    p = str(tmp_path / "1.zip")
    with open(p, "w") as f: f.write("a")
    with patch("os.path.getsize", return_value=settings.max_import_size_bytes + 1):
        with pytest.raises(PayloadTooLargeError, match="configured import limit"):
            scan_full_backup(p)
            
    # 2. Bad zip file
    p = str(tmp_path / "2.zip")
    with open(p, "w") as f: f.write("bad zip")
    with pytest.raises(BadRequestError, match="valid ZIP archive"):
        scan_full_backup(p)
        
    # 3. Too many entries
    p = str(tmp_path / "3.zip")
    create_zip(p, {"1.txt": b"1"})
    with patch("zipfile.ZipFile.infolist") as m_infolist:
        m_infolist.return_value = [Mock()] * (MAX_ARCHIVE_ENTRIES + 1)
        with pytest.raises(BadRequestError, match="too many archive entries"):
            scan_full_backup(p)
            
    # 4. Duplicate paths
    p = str(tmp_path / "4.zip")
    with zipfile.ZipFile(p, 'w') as zf:
        zf.writestr("a.txt", b"1")
        zf.writestr("a.txt", b"2")
    with pytest.raises(BadRequestError, match="duplicate archive paths"):
        scan_full_backup(p)
        
    # 5. Symlinks
    p = str(tmp_path / "5.zip")
    with zipfile.ZipFile(p, 'w') as zf:
        info = zipfile.ZipInfo("symlink.txt")
        info.external_attr = 0xA000 << 16 # stat.S_IFLNK
        zf.writestr(info, b"target")
    with pytest.raises(BadRequestError, match="must not contain symbolic links"):
        scan_full_backup(p)
        
    # 6. Compression ratio
    p = str(tmp_path / "6.zip")
    create_zip(p, {"manifest.json": b"{}", "workspace.json": b"{}"})
    with patch("zipfile.ZipFile.infolist") as m_infolist:
        info = Mock(filename="manifest.json", external_attr=0, compress_size=1, file_size=MAX_COMPRESSION_RATIO + 1)
        m_infolist.return_value = [info]
        with pytest.raises(BadRequestError, match="compression ratio is unsafe"):
            scan_full_backup(p)
        
    # 7. Uncompressed size too large
    p = str(tmp_path / "7.zip")
    create_zip(p, {"manifest.json": b"{}", "workspace.json": b"{}"})
    with patch("zipfile.ZipFile.infolist") as m_infolist:
        info = Mock(filename="manifest.json", external_attr=0, compress_size=settings.max_import_size_bytes + 1, file_size=settings.max_import_size_bytes + 1)
        m_infolist.return_value = [info]
        with pytest.raises(PayloadTooLargeError, match="expands beyond"):
            scan_full_backup(p)
        
    # 8. Missing manifest/document
    p = str(tmp_path / "8.zip")
    create_zip(p, {"other.txt": b""})
    with pytest.raises(BadRequestError, match="missing its manifest or workspace data"):
        scan_full_backup(p)
        
    # 9. Manifest invalid json
    p = str(tmp_path / "9.zip")
    create_zip(p, {"manifest.json": b"{bad", "data/workspace.json": b"{}"})
    with pytest.raises(BadRequestError, match="manifest is not valid JSON"):
        scan_full_backup(p)
        
    # 10. Manifest format wrong
    p = str(tmp_path / "10.zip")
    create_zip(p, {"manifest.json": b"{}", "data/workspace.json": b"{}"})
    with pytest.raises(BadRequestError, match="manifest is unsupported"):
        scan_full_backup(p)
        
    # 11. Document invalid json
    p = str(tmp_path / "11.zip")
    doc_bad = b"{bad"
    man = json.dumps({"format": "wikihub.full-backup", "version": 1, "entries": [
        {"path": "data/workspace.json", "sha256": hashlib.sha256(doc_bad).hexdigest(), "size_bytes": len(doc_bad)}
    ]}).encode()
    create_zip(p, {"manifest.json": man, "data/workspace.json": doc_bad})
    with pytest.raises(BadRequestError, match="workspace data is invalid"):
        scan_full_backup(p)
        
    # 12. Missing path or sha256 in manifest entry
    p = str(tmp_path / "12.zip")
    man = json.dumps({"format": "wikihub.full-backup", "version": 1, "entries": ["not_a_dict"]}).encode()
    doc = json.dumps({"wikihub_backup": {"version": 2}}).encode()
    create_zip(p, {"manifest.json": man, "data/workspace.json": doc})
    with pytest.raises(BadRequestError, match="Backup manifest entry is invalid."):
        scan_full_backup(p)
        
    # 13. Duplicate manifest entry
    p = str(tmp_path / "13.zip")
    hash_1 = hashlib.sha256(b"1").hexdigest()
    man = json.dumps({"format": "wikihub.full-backup", "version": 1, "entries": [
        {"path": "a.txt", "sha256": hash_1, "size_bytes": 1},
        {"path": "a.txt", "sha256": hash_1, "size_bytes": 1}
    ]}).encode()
    create_zip(p, {"manifest.json": man, "data/workspace.json": doc, "a.txt": b"1"})
    with pytest.raises(BadRequestError, match="Backup manifest entry is invalid."):
        scan_full_backup(p)
        
    # 14. Missing file in zip
    p = str(tmp_path / "14.zip")
    doc = json.dumps({"wikihub_backup": {"version": 1, "exported_at": "2020-01-01T00:00:00Z", "app_version": "1", "site_name": "S", "includes_credentials": False}}).encode()
    hash_doc = hashlib.sha256(doc).hexdigest()
    man = json.dumps({"format": "wikihub.full-backup", "version": 1, "entries": [
        {"path": "data/workspace.json", "sha256": hash_doc, "size_bytes": len(doc)},
        {"path": "b.txt", "sha256": "y" * 64, "size_bytes": 1}
    ]}).encode()
    create_zip(p, {"manifest.json": man, "data/workspace.json": doc})
    with pytest.raises(BadRequestError, match="missing a declared entry"):
        scan_full_backup(p)
        
    # 15. Validation error on backup document
    p = str(tmp_path / "15.zip")
    doc = json.dumps({"wikihub_backup": {"version": "wrong_type"}}).encode()
    man = json.dumps({"format": "wikihub.full-backup", "version": 1, "entries": [
        {"path": "data/workspace.json", "sha256": hashlib.sha256(doc).hexdigest(), "size_bytes": len(doc)}
    ]}).encode()
    create_zip(p, {"manifest.json": man, "data/workspace.json": doc})
    with pytest.raises(BadRequestError, match="workspace data is invalid"):
        scan_full_backup(p)
        
    # 16. Attachment metadata mismatch
    p = str(tmp_path / "16.zip")
    doc = json.dumps({
        "wikihub_backup": {"version": 1, "exported_at": "2020-01-01T00:00:00Z", "app_version": "1", "site_name": "S", "includes_credentials": False},
        "attachments": [{"page_space_key": "S", "page_slug": "P", "filename": "a", "content_type": "text", "object_path": "a.txt", "size_bytes": 1, "sha256": "x"}]
    }).encode()
    man = json.dumps({"format": "wikihub.full-backup", "version": 1, "entries": [
        {"path": "data/workspace.json", "sha256": hashlib.sha256(doc).hexdigest(), "size_bytes": len(doc)}
    ]}).encode()
    create_zip(p, {"manifest.json": man, "data/workspace.json": doc})
    with pytest.raises(BadRequestError, match="binary metadata does not match"):
        scan_full_backup(p)
        
    # 17. Avatar metadata mismatch
    p = str(tmp_path / "17.zip")
    doc = json.dumps({
        "wikihub_backup": {"version": 1, "exported_at": "2020-01-01T00:00:00Z", "app_version": "1", "site_name": "S", "includes_credentials": False},
        "avatars": [{"username": "u", "content_type": "img", "object_path": "u.png", "size_bytes": 1, "sha256": "x"}]
    }).encode()
    man = json.dumps({"format": "wikihub.full-backup", "version": 1, "entries": [
        {"path": "data/workspace.json", "sha256": hashlib.sha256(doc).hexdigest(), "size_bytes": len(doc)}
    ]}).encode()
    create_zip(p, {"manifest.json": man, "data/workspace.json": doc})
    with pytest.raises(BadRequestError, match="binary metadata does not match"):
        scan_full_backup(p)
        
    # 18. Missing DOCUMENT_PATH in entries
    p = str(tmp_path / "18.zip")
    man = json.dumps({"format": "wikihub.full-backup", "version": 1, "entries": []}).encode()
    create_zip(p, {"manifest.json": man, "data/workspace.json": b"{}"})
    with pytest.raises(BadRequestError, match="does not declare workspace data"):
        scan_full_backup(p)
