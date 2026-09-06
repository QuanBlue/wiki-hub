"""Unit coverage for ONLYOFFICE attachment capabilities and signed configs."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import jwt
import pytest

from app.core.config import settings
from app.core.exceptions import AuthenticationError, ServiceUnavailableError
from app.modules.attachments.onlyoffice import (
    editor_config,
    file_extension,
    internal_download_url,
    is_enabled,
    preview_editor_config,
    preview_extension,
    require_enabled,
    verify_callback_token,
    verify_preview_ticket,
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


def test_is_enabled_and_require_enabled_reflect_the_setting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert is_enabled() is True
    require_enabled()  # does not raise

    monkeypatch.setattr(settings, "onlyoffice_enabled", False)
    assert is_enabled() is False
    with pytest.raises(ServiceUnavailableError, match="not configured"):
        require_enabled()


@pytest.mark.parametrize("filename", ["report.pdf", "notes.txt", "archive.zip", "no-extension"])
def test_file_extension_rejects_anything_not_editable(filename: str) -> None:
    # Only docx/xlsx/pptx can actually be opened in the editor - everything
    # else, PDF included, is read-only elsewhere in the app.
    with pytest.raises(ServiceUnavailableError, match="cannot be edited"):
        file_extension(filename)


def test_file_extension_accepts_the_editable_office_formats() -> None:
    assert file_extension("report.DOCX") == "docx"


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


@pytest.mark.parametrize(
    ("filename", "expected_document_type"),
    [("architecture.docx", "word"), ("budget.xlsx", "cell"), ("roadmap.pptx", "slide")],
)
def test_editor_config_picks_the_document_type_for_each_editable_extension(
    filename: str, expected_document_type: str
) -> None:
    config = editor_config(attachment=_attachment(filename), user=_user())
    assert config["documentType"] == expected_document_type
    document = config["document"]
    assert isinstance(document, dict)
    assert document["fileType"] == filename.rsplit(".", 1)[-1]


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
    with pytest.raises(AuthenticationError):
        verify_ticket(token, attachment_id=uuid.uuid4(), purpose="content")


def test_a_garbage_ticket_is_rejected_rather_than_raising_a_raw_jwt_error() -> None:
    with pytest.raises(AuthenticationError, match="invalid or has expired"):
        verify_ticket("not-a-real-token", attachment_id=uuid.uuid4(), purpose="content")


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


def test_callback_signature_rejects_a_substituted_status() -> None:
    callback = {
        "key": "wkh_v2_11111111222233334444555555555555_7",
        "status": 6,
        "url": "http://onlyoffice/cache/edited.docx",
    }
    callback["token"] = jwt.encode(callback, settings.onlyoffice_jwt_secret, algorithm="HS256")
    callback["status"] = 2

    with pytest.raises(AuthenticationError):
        verify_callback_token(callback)


def test_a_callback_body_missing_a_key_entirely_is_rejected() -> None:
    # The per-field loop only checks a field that is *present* in the body -
    # this is what still catches "key" missing outright, since the signed
    # token's own "key" claim would then be compared against None.
    signed = {"key": "wkh_v2_x_1", "status": 6, "url": "http://onlyoffice/x"}
    token = jwt.encode(signed, settings.onlyoffice_jwt_secret, algorithm="HS256")

    with pytest.raises(AuthenticationError):
        verify_callback_token({"status": 6, "url": "http://onlyoffice/x", "token": token})


def test_a_callback_with_an_unparseable_token_is_rejected() -> None:
    with pytest.raises(AuthenticationError, match="signature is invalid"):
        verify_callback_token({"key": "k", "token": "not-a-real-jwt"})


def test_a_callback_with_no_token_at_all_is_rejected() -> None:
    with pytest.raises(AuthenticationError, match="missing its signature"):
        verify_callback_token({"key": "k", "status": 2})


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


def test_a_misconfigured_internal_url_never_produces_a_download_link(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "onlyoffice_internal_url", "")
    assert internal_download_url("http://localhost:8080/cache/x/output.docx") is None


class TestPreviewExtension:
    @pytest.mark.parametrize(
        "filename",
        [
            "report.docx", "report.doc", "report.odt", "report.rtf",
            "budget.xlsx", "budget.xls", "budget.ods",
            "deck.pptx", "deck.ppt", "deck.odp",
            "handbook.pdf",
        ],
    )
    def test_accepts_every_previewable_office_format(self, filename: str) -> None:
        assert preview_extension(filename) == filename.rsplit(".", 1)[-1]

    def test_csv_is_not_an_office_preview(self) -> None:
        # The admin storage browser already renders `.csv` as plain text -
        # routing it through ONLYOFFICE here too, without the frontend also
        # agreeing, would leave the two disagreeing about what kind of
        # preview a `.csv` gets.
        assert preview_extension("export.csv") is None

    def test_rejects_an_unrecognised_or_missing_extension(self) -> None:
        assert preview_extension("archive.zip") is None
        assert preview_extension("no-extension-at-all") is None


class TestPreviewEditorConfig:
    def test_is_read_only_and_signed(self) -> None:
        config = preview_editor_config(
            key="avatars/u1/original.docx", filename="original.docx", user=_user()
        )

        assert config["documentType"] == "word"
        assert config["editorConfig"]["mode"] == "view"
        document = config["document"]
        assert document["permissions"] == {
            "edit": False,
            "download": True,
            "print": True,
            "comment": False,
            "review": False,
            "fillForms": False,
        }
        assert "callbackUrl" not in config["editorConfig"]
        assert document["url"].startswith(
            "http://backend:8000/api/v1/storage/office-preview/content?"
        )
        assert "token" in config

    def test_picks_the_document_type_from_the_filename_not_the_key(self) -> None:
        config = preview_editor_config(
            key="imports/confluence/archive-1/site.xml/handbook.pdf",
            filename="handbook.pdf",
            user=_user(),
        )
        assert config["documentType"] == "pdf"
        assert config["document"]["fileType"] == "pdf"

    def test_rejects_a_file_type_the_previewer_does_not_support(self) -> None:
        with pytest.raises(ServiceUnavailableError):
            preview_editor_config(key="backups/x.zip", filename="x.zip", user=_user())

    def test_each_config_gets_its_own_fresh_document_key(self) -> None:
        # Deliberately not derived from `key`: the same object key can be
        # overwritten with different bytes between two previews (an avatar
        # replaced, say), and ONLYOFFICE caches server-side by this value -
        # a stable key would risk showing stale content.
        first = preview_editor_config(key="a.pdf", filename="a.pdf", user=_user())
        second = preview_editor_config(key="a.pdf", filename="a.pdf", user=_user())
        assert first["document"]["key"] != second["document"]["key"]


class TestVerifyPreviewTicket:
    def test_a_ticket_verifies_for_the_key_it_was_minted_for(self) -> None:
        config = preview_editor_config(
            key="avatars/u1/original.docx", filename="original.docx", user=_user()
        )
        token = str(config["document"]["url"]).rpartition("token=")[2]

        verify_preview_ticket(token, key="avatars/u1/original.docx")

    def test_a_ticket_does_not_verify_for_a_different_key(self) -> None:
        config = preview_editor_config(
            key="avatars/u1/original.docx", filename="original.docx", user=_user()
        )
        token = str(config["document"]["url"]).rpartition("token=")[2]

        with pytest.raises(AuthenticationError):
            verify_preview_ticket(token, key="avatars/u2/original.docx")

    def test_an_attachment_content_ticket_does_not_double_as_a_preview_ticket(self) -> None:
        # The two ticket families are deliberately typed differently (`typ`
        # claim) so a capability minted for one document-server route can
        # never be replayed against the other.
        attachment_config = editor_config(attachment=_attachment(), user=_user())
        attachment_token = str(attachment_config["document"]["url"]).rpartition("token=")[2]

        with pytest.raises(AuthenticationError):
            verify_preview_ticket(attachment_token, key="architecture.docx")

    def test_garbage_token_is_rejected(self) -> None:
        with pytest.raises(AuthenticationError):
            verify_preview_ticket("not-a-real-token", key="a.pdf")
