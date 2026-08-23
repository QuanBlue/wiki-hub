import pytest
import zipfile
import tempfile
import os

from app.modules.backup.package import _safe_path, _read_limited
from app.core.exceptions import BadRequestError, PayloadTooLargeError
from unittest.mock import Mock, patch

def test_safe_path():
    assert _safe_path("foo/bar") == "foo/bar"
    
    with pytest.raises(BadRequestError, match="unsafe archive path"):
        _safe_path("")
        
    with pytest.raises(BadRequestError, match="unsafe archive path"):
        _safe_path("foo\\bar")
        
    with pytest.raises(BadRequestError, match="unsafe archive path"):
        _safe_path("/foo/bar")
        
    with pytest.raises(BadRequestError, match="unsafe archive path"):
        _safe_path("../foo")
        
    # Not exact string match (e.g. redundant slashes)
    with pytest.raises(BadRequestError, match="unsafe archive path"):
        _safe_path("foo//bar")

def test_read_limited():
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        with zipfile.ZipFile(tmp, "w") as zf:
            zf.writestr("test.txt", b"12345")
    
    # mock read
    archive_mock = Mock()
    info_mock = Mock()
    info_mock.file_size = 100
    with pytest.raises(PayloadTooLargeError, match="exceeds the configured import limit"):
        _read_limited(archive_mock, info_mock, 10)
        
    info_mock.file_size = 5
    source_mock = Mock()
    source_mock.read.return_value = b"123456"
    archive_mock.open.return_value.__enter__ = Mock(return_value=source_mock)
    archive_mock.open.return_value.__exit__ = Mock()
    
    with pytest.raises(PayloadTooLargeError, match="exceeds the configured import limit"):
        _read_limited(archive_mock, info_mock, 5)
        
    source_mock.read.return_value = b"123"
    assert _read_limited(archive_mock, info_mock, 5) == b"123"
