"""Document conversion: the pandoc argv, and the guards around what it writes.

The subprocess is patched the way `test_export_docx.py` patches it, so these
run offline and without pandoc installed. What they actually protect is the
argv (two flags whose presence would be SSRF, one whose absence would let raw
HTML through) and the media walk, which reads paths chosen by the document.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

from app.core.exceptions import BadRequestError, ServiceUnavailableError
from app.modules.document_import import convert
from app.modules.document_import.convert import (
    MEDIA_TOKEN_PREFIX,
    DocumentTooComplexError,
    build_pandoc_args,
    extract_document,
    extract_with_pandoc,
    format_for_filename,
    new_media_token,
    replace_media_tokens,
)


class FakeProcess:
    """Stands in for the pandoc subprocess, writing whatever output we want."""

    def __init__(self, output_path: Path, html: str = "<p>ok</p>", returncode: int = 0):
        self._output_path = output_path
        self._html = html
        self.returncode = returncode

    async def communicate(self, _input: bytes | None = None) -> tuple[bytes, bytes]:
        if self.returncode == 0:
            self._output_path.parent.mkdir(parents=True, exist_ok=True)
            self._output_path.write_text(self._html, encoding="utf-8")
        return b"", b"pandoc said something" if self.returncode else b""


def _patch_pandoc(workdir: Path, *, html: str = "<p>ok</p>", returncode: int = 0):
    captured: dict[str, list[str]] = {}

    async def fake_exec(*args, **_kwargs):
        captured["argv"] = list(args)
        return FakeProcess(workdir / "converted.html", html=html, returncode=returncode)

    return patch.object(asyncio, "create_subprocess_exec", fake_exec), captured


class TestFormatDispatch:
    @pytest.mark.parametrize(
        ("filename", "expected"),
        [
            ("a.docx", "docx"),
            ("A.DOCX", "docx"),
            ("a.odt", "odt"),
            ("a.rtf", "rtf"),
            ("a.epub", "epub"),
            ("a.html", "html"),
            ("a.htm", "html"),
            ("a.md", "markdown"),
            ("a.markdown", "markdown"),
            ("a.pdf", "pdf"),
        ],
    )
    def test_known_extensions_map_to_a_format(self, filename, expected):
        assert format_for_filename(filename) == expected

    @pytest.mark.parametrize("filename", ["a.docm", "a.xlsm", "a.exe", "a.zip", "README"])
    def test_macro_and_unknown_containers_are_not_importable(self, filename):
        assert format_for_filename(filename) is None

    @pytest.mark.asyncio
    async def test_an_unsupported_file_is_rejected_before_any_subprocess(self, tmp_path):
        with pytest.raises(BadRequestError):
            await extract_document(tmp_path / "a.exe", filename="a.exe", workdir=tmp_path)


class TestPandocArgv:
    def test_docx_extracts_media(self, tmp_path):
        argv = build_pandoc_args(tmp_path / "a.docx", doc_format="docx", workdir=tmp_path)
        assert "--from=docx" in argv
        assert "--to=html" in argv
        assert "--wrap=none" in argv
        assert "--no-highlight" in argv
        assert f"--extract-media={tmp_path / 'media'}" in argv

    @pytest.mark.parametrize(
        ("doc_format", "reader"),
        [("html", "--from=html-raw_html"), ("markdown", "--from=markdown-raw_html")],
    )
    def test_text_formats_disable_raw_html_at_the_reader(self, tmp_path, doc_format, reader):
        # `markdown`, not `gfm`: verified against pandoc 3.5, `gfm-raw_html`
        # still emits `<script>` verbatim while `markdown-raw_html` escapes it.
        argv = build_pandoc_args(tmp_path / "a.in", doc_format=doc_format, workdir=tmp_path)
        assert reader in argv

    @pytest.mark.parametrize("doc_format", ["html", "markdown"])
    def test_text_formats_do_not_extract_media(self, tmp_path, doc_format):
        argv = build_pandoc_args(tmp_path / "a.in", doc_format=doc_format, workdir=tmp_path)
        assert not any(a.startswith("--extract-media") for a in argv)

    @pytest.mark.parametrize("doc_format", ["docx", "odt", "rtf", "epub", "html", "markdown"])
    def test_never_passes_a_flag_that_fetches_remote_resources(self, tmp_path, doc_format):
        # Both flags make pandoc resolve remote URLs, which turns an uploaded
        # .html file into server-side request forgery.
        argv = build_pandoc_args(tmp_path / "a.in", doc_format=doc_format, workdir=tmp_path)
        assert "--standalone" not in argv
        assert "-s" not in argv
        assert "--embed-resources" not in argv
        assert "--self-contained" not in argv

    def test_the_source_path_is_the_last_argument(self, tmp_path):
        source = tmp_path / "report.docx"
        argv = build_pandoc_args(source, doc_format="docx", workdir=tmp_path)
        assert argv[-1] == str(source)
        assert argv[-3] == "-o"


class TestPandocFailureModes:
    @pytest.mark.asyncio
    async def test_a_timeout_becomes_service_unavailable(self, tmp_path):
        async def hang(*_args, **_kwargs):
            raise TimeoutError

        patcher = patch.object(asyncio, "create_subprocess_exec", hang)
        with patcher, pytest.raises(ServiceUnavailableError):
            await extract_with_pandoc(tmp_path / "a.docx", doc_format="docx", workdir=tmp_path)

    @pytest.mark.asyncio
    async def test_a_missing_binary_becomes_service_unavailable(self, tmp_path):
        async def missing(*_args, **_kwargs):
            raise OSError("pandoc not found")

        patcher = patch.object(asyncio, "create_subprocess_exec", missing)
        with patcher, pytest.raises(ServiceUnavailableError):
            await extract_with_pandoc(tmp_path / "a.docx", doc_format="docx", workdir=tmp_path)

    @pytest.mark.asyncio
    async def test_a_nonzero_exit_blames_the_document_not_the_server(self, tmp_path):
        # A corrupt upload is the user's problem to fix, so it must not present
        # as a 503 that suggests retrying will help.
        patcher, _ = _patch_pandoc(tmp_path, returncode=1)
        with patcher, pytest.raises(BadRequestError):
            await extract_with_pandoc(
                tmp_path / "a.docx", doc_format="docx", workdir=tmp_path
            )


class TestMediaTraversalGuard:
    """`--extract-media` writes paths the document chose. None may escape."""

    @pytest.fixture
    def media_root(self, tmp_path):
        root = tmp_path / "media"
        root.mkdir()
        (root / "real.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"x" * 600)
        return root

    async def _convert(self, tmp_path, html):
        patcher, _ = _patch_pandoc(tmp_path, html=html)
        with patcher:
            return await extract_with_pandoc(
                tmp_path / "a.docx", doc_format="docx", workdir=tmp_path
            )

    @pytest.mark.asyncio
    async def test_a_legitimate_extracted_image_is_collected(self, tmp_path, media_root):
        result = await self._convert(tmp_path, '<p><img src="media/real.png"/></p>')
        assert len(result.media) == 1
        assert result.media[0].filename == "real.png"
        assert result.media[0].content_type == "image/png"
        assert MEDIA_TOKEN_PREFIX in result.html
        assert "media/real.png" not in result.html

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "src",
        [
            "../../../etc/passwd",
            "media/../../secret.txt",
            "/etc/passwd",
            "media/does-not-exist.png",
            "media%2F..%2F..%2Fsecret.txt",
        ],
    )
    async def test_a_path_outside_the_media_root_is_dropped(self, tmp_path, media_root, src):
        (tmp_path.parent / "secret.txt").write_bytes(b"secret")
        result = await self._convert(tmp_path, f'<p><img src="{src}"/></p>')
        assert result.media == []
        assert "<img" not in result.html

    @pytest.mark.asyncio
    @pytest.mark.skipif(sys.platform == "win32", reason="symlink creation needs privileges")
    async def test_a_symlink_inside_the_media_root_is_dropped(self, tmp_path, media_root):
        # The check must happen before resolve(): resolve() follows the link and
        # would report a path that genuinely is under the media root.
        outside = tmp_path.parent / "outside.png"
        outside.write_bytes(b"\x89PNG" + b"y" * 600)
        (media_root / "link.png").symlink_to(outside)
        result = await self._convert(tmp_path, '<p><img src="media/link.png"/></p>')
        assert result.media == []

    @pytest.mark.asyncio
    async def test_a_remote_image_is_kept_but_never_fetched(self, tmp_path, media_root):
        result = await self._convert(
            tmp_path, '<p><img src="https://example.com/x.png"/></p>'
        )
        assert result.media == []
        assert "https://example.com/x.png" in result.html

    @pytest.mark.asyncio
    async def test_a_data_uri_image_is_dropped(self, tmp_path, media_root):
        result = await self._convert(tmp_path, '<p><img src="data:image/png;base64,AAAA"/></p>')
        assert result.media == []
        assert "data:" not in result.html


class TestResourceCeilings:
    @pytest.mark.asyncio
    async def test_too_many_images_aborts_the_file(self, tmp_path, monkeypatch):
        monkeypatch.setattr(convert.settings, "document_import_max_media_count", 2)
        root = tmp_path / "media"
        root.mkdir()
        imgs = []
        for i in range(4):
            (root / f"i{i}.png").write_bytes(b"\x89PNG" + b"x" * 600)
            imgs.append(f'<p><img src="media/i{i}.png"/></p>')
        patcher, _ = _patch_pandoc(tmp_path, html="".join(imgs))
        with patcher, pytest.raises(DocumentTooComplexError):
            await extract_with_pandoc(
                tmp_path / "a.docx", doc_format="docx", workdir=tmp_path
            )

    @pytest.mark.asyncio
    async def test_oversized_media_aborts_the_file(self, tmp_path, monkeypatch):
        monkeypatch.setattr(convert.settings, "document_import_max_media_bytes", 1000)
        root = tmp_path / "media"
        root.mkdir()
        (root / "big.png").write_bytes(b"\x89PNG" + b"x" * 5000)
        patcher, _ = _patch_pandoc(tmp_path, html='<p><img src="media/big.png"/></p>')
        with patcher, pytest.raises(DocumentTooComplexError):
            await extract_with_pandoc(
                tmp_path / "a.docx", doc_format="docx", workdir=tmp_path
            )

    @pytest.mark.asyncio
    async def test_enormous_converted_html_is_refused_before_it_is_read(
        self, tmp_path, monkeypatch
    ):
        # A zip bomb converts to gigantic HTML; read_text() on it is the thing
        # that would take the worker down.
        monkeypatch.setattr(convert.settings, "document_import_max_media_bytes", 100)
        patcher, _ = _patch_pandoc(tmp_path, html="<p>" + "x" * 5000 + "</p>")
        with patcher, pytest.raises(DocumentTooComplexError):
            await extract_with_pandoc(
                tmp_path / "a.docx", doc_format="docx", workdir=tmp_path
            )


class TestMediaTokenReplacement:
    def test_a_token_becomes_its_attachment_url(self):
        token = new_media_token()
        html = f'<p><img src="{token}" alt="a"/></p>'
        result = replace_media_tokens(html, {token: "/api/v1/attachments/9/content"})
        assert '/api/v1/attachments/9/content' in result
        assert MEDIA_TOKEN_PREFIX not in result

    def test_an_unresolved_token_drops_the_image_and_its_empty_paragraph(self):
        token = new_media_token()
        result = replace_media_tokens(f'<p><img src="{token}"/></p><p>text</p>', {})
        assert "<img" not in result
        assert result == "<p>text</p>"

    def test_a_paragraph_with_other_content_survives_a_dropped_image(self):
        token = new_media_token()
        result = replace_media_tokens(f'<p>caption <img src="{token}"/></p>', {})
        assert "caption" in result

    def test_no_token_survives_anywhere_in_the_output(self):
        token = new_media_token()
        html = f'<p><img src="{token}"/></p><p>stray {token} in text</p>'
        result = replace_media_tokens(html, {token: "/api/v1/attachments/1/content"})
        assert MEDIA_TOKEN_PREFIX not in result

    def test_real_image_sources_are_untouched(self):
        html = '<p><img src="https://example.com/a.png"/></p>'
        assert replace_media_tokens(html, {}) == html

    def test_empty_input_is_returned_unchanged(self):
        assert replace_media_tokens("", {}) == ""
