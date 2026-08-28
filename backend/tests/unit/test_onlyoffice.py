"""Unit coverage for ONLYOFFICE attachment capabilities and signed configs."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import jwt
import pytest

from app.core.config import settings
from app.core.exceptions import AuthenticationError
from app.modules.attachments.onlyoffice import (
    editor_config,
    internal_download_url,
    verify_callback_token,
    verify_ticket,
)


@pytest.fixture(autouse=True)
def onlyoffice_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "onlyoffice_enabled", True)
    monkeypatch.setattr(settings, "onlyoffice_backend_url", "http://backend:8000")
    monkeypatch.setattr(settings, "onlyoffice_internal_url", "http://onlyoffice")
    monkeypatch.setattr(settings, "onlyoffice_jwt_secret", "onlyoffice-test-secret-with-at-least-32-characters")


def _attachment(filename: str = "architecture.docx") -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.UUID("11111111-2222-3333-4444-555555555555"),
        filename=filename,
        office_revision=7,
    )


def _user() -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
        full_name="WikiHub Editor",
        username="editor",
    )


def test_editor_config_is_signed_and_uses_internal_capability_urls() -> None:
    attachment = _attachment()
    config = editor_config(attachment=attachment, user=_user())

    assert config["documentType"] == "word"
    document = config["document"]
    assert isinstance(document, dict)
    assert document["key"] == "wkh_v2_11111111222233334444555555555555_7"
    assert document["url"].startswith(
        "http://backend:8000/api/v1/attachments/11111111-2222-3333-4444-555555555555/office/content?"
    )
    editor = config["editorConfig"]
    assert isinstance(editor, dict)
    assert editor["lang"] == "en"
    assert str(editor["callbackUrl"]).startswith(
        "http://backend:8000/api/v1/attachments/11111111-2222-3333-4444-555555555555/office/callback?"
    )

    callback = {"key": document["key"], "status": 6, "url": "http://onlyoffice/file.docx"}
    callback["token"] = jwt.encode(
        callback,
        settings.onlyoffice_jwt_secret,
        algorithm="HS256",
    )
    verify_callback_token(callback)


def test_ticket_is_scoped_to_attachment_and_purpose() -> None:
    attachment = _attachment()
    config = editor_config(attachment=attachment, user=_user())
    document = config["document"]
    assert isinstance(document, dict)
    url = str(document["url"])
    token = url.partition("token=")[2]

    verify_ticket(token, attachment_id=attachment.id, purpose="content")
    with pytest.raises(AuthenticationError):
        verify_ticket(token, attachment_id=attachment.id, purpose="callback")


def test_callback_signature_rejects_a_substituted_download_url() -> None:
    callback = {
        "key": "wkh_v2_11111111222233334444555555555555_7",
        "status": 6,
        "url": "http://onlyoffice/cache/edited.docx",
    }
    callback["token"] = jwt.encode(
        callback,
        settings.onlyoffice_jwt_secret,
        algorithm="HS256",
    )
    callback["url"] = "http://onlyoffice/metadata/latest"

    with pytest.raises(AuthenticationError):
        verify_callback_token(callback)


def test_download_url_is_repinned_to_the_internal_document_server() -> None:
    # The Document Server advertises the address the browser uses to reach it,
    # which is unreachable from the backend. Only the path and query survive.
    assert (
        internal_download_url("http://localhost:8080/cache/files/data/x/output.docx?md5=a&expires=1")
        == "http://onlyoffice/cache/files/data/x/output.docx?md5=a&expires=1"
    )
    assert (
        internal_download_url("https://docs.example.com/cache/files/edited.docx")
        == "http://onlyoffice/cache/files/edited.docx"
    )
    assert internal_download_url("http://onlyoffice/cache/files/edited.docx") == (
        "http://onlyoffice/cache/files/edited.docx"
    )
    assert internal_download_url("file:///etc/passwd") is None
    assert internal_download_url("http://onlyoffice") is None
    assert internal_download_url("not a url") is None
