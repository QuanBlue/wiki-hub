"""HTML -> Word conversion: the pandoc subprocess invocation, the probed
theme flowing into pandoc's own skylighting theme, and the python-docx
post-pass that paints named styles with the page's real, probed colors."""

from __future__ import annotations

import asyncio
import io
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import pytest
from docx import Document
from docx.enum.style import WD_STYLE_TYPE

from app.core.exceptions import ServiceUnavailableError
from app.modules.pages import export_docx
from app.modules.pages.export_docx import _build_highlight_theme, _parse_color, html_to_docx


def theme(**overrides: str) -> dict[str, str]:
    defaults = {
        "font_page": "Inter, sans-serif",
        "font_mono": "JetBrains Mono, monospace",
        "foreground": "rgb(23, 32, 51)",
        "primary": "rgb(33, 111, 192)",
        "border": "rgb(207, 215, 227)",
        "code_bg": "#282a3a",
        "code_fg": "#eaf2f1",
        "code_comment": "#9195ab",
        "code_keyword": "#ff657a",
        "code_string": "#ffd76d",
        "code_number": "#c39ac9",
        "code_function": "#9cd1bb",
        "code_type": "#ff657a",
        "code_variable": "#eaf2f1",
        "code_meta": "#ff9b5e",
        "callout_info_bg": "rgb(230, 240, 250)",
        "callout_info_border": "rgb(33, 111, 192)",
        "callout_warning_bg": "rgb(255, 244, 230)",
        "callout_warning_border": "rgb(230, 160, 40)",
        "callout_note_bg": "rgb(230, 250, 240)",
        "callout_note_border": "rgb(40, 170, 100)",
        "callout_panel_bg": "rgb(245, 245, 245)",
        "callout_panel_border": "rgb(207, 215, 227)",
    }
    defaults.update(overrides)
    return defaults


def fixture_docx_bytes(*, with_callout_style: bool = True) -> bytes:
    """A minimal docx standing in for what a real pandoc invocation would
    have written to the -o path - including the custom style pandoc's own
    writer auto-creates for a Lua-filter-assigned custom-style, when true."""
    document = Document()
    if with_callout_style:
        style = document.styles.add_style("WikiHub Callout Info", WD_STYLE_TYPE.PARAGRAPH)
        paragraph = document.add_paragraph("Heads up.")
        paragraph.style = style
    else:
        document.add_paragraph("Plain paragraph.")
    stream = io.BytesIO()
    document.save(stream)
    return stream.getvalue()


class FakeProcess:
    def __init__(self, returncode: int = 0, stderr: bytes = b"") -> None:
        self.returncode = returncode
        self.communicate = AsyncMock(return_value=(b"", stderr))


def patch_pandoc(*, output_bytes: bytes | None, returncode: int = 0, stderr: bytes = b""):
    """Patches asyncio.create_subprocess_exec so the call behaves like a real
    pandoc invocation: it "writes" output_bytes to the -o path it was given."""

    async def fake_create_subprocess_exec(*args: object, **_kwargs: object):
        if output_bytes is not None:
            idx = list(args).index("-o")
            Path(str(args[idx + 1])).write_bytes(output_bytes)  # noqa: ASYNC240 - test double
        return FakeProcess(returncode=returncode, stderr=stderr)

    return patch(
        "asyncio.create_subprocess_exec", side_effect=fake_create_subprocess_exec
    )


class TestParseColor:
    def test_parses_a_hex_string(self) -> None:
        assert _parse_color("#eaf2f1") == "eaf2f1"

    def test_parses_an_rgb_string(self) -> None:
        assert _parse_color("rgb(23, 32, 51)") == "172033"

    def test_parses_an_rgba_string_ignoring_alpha(self) -> None:
        assert _parse_color("rgba(23, 32, 51, 0.5)") == "172033"

    def test_returns_none_for_an_unparseable_value(self) -> None:
        assert _parse_color("currentcolor") is None

    def test_returns_none_for_empty_or_missing(self) -> None:
        assert _parse_color("") is None
        assert _parse_color(None) is None


class TestBuildHighlightTheme:
    def test_maps_every_known_token_and_falls_back_sensibly(self) -> None:
        result = _build_highlight_theme(theme())
        assert result["text-styles"]["Keyword"]["text-color"] == "#ff657a"
        assert result["text-styles"]["String"]["text-color"] == "#ffd76d"
        assert result["text-styles"]["Comment"]["italic"] is True
        assert result["text-styles"]["Keyword"]["italic"] is False
        assert result["background-color"] == "#282a3a"

    def test_falls_back_to_a_default_when_the_code_palette_is_missing(self) -> None:
        result = _build_highlight_theme({})
        assert result["text-color"] == "#eaf2f1"
        assert result["background-color"] == "#282a3a"
        assert result["text-styles"]["Keyword"]["text-color"] is None


@pytest.mark.asyncio
async def test_html_to_docx_invokes_pandoc_with_the_lua_filter_and_highlight_theme() -> None:
    captured_args: list[str] = []

    async def fake_create_subprocess_exec(*args: object, **_kwargs: object):
        captured_args.extend(str(a) for a in args)
        idx = captured_args.index("-o")
        Path(captured_args[idx + 1]).write_bytes(fixture_docx_bytes())  # noqa: ASYNC240
        return FakeProcess()

    with patch("asyncio.create_subprocess_exec", side_effect=fake_create_subprocess_exec):
        result = await html_to_docx("<p>Hello</p>", theme(), title="My Page")

    assert any(a.startswith("--lua-filter=") and a.endswith("wikihub.lua") for a in captured_args)
    assert any(a.startswith("--highlight-style=") for a in captured_args)
    assert "title=My Page" in captured_args
    assert result[:2] == b"PK"  # a .docx is a zip archive


@pytest.mark.asyncio
async def test_html_to_docx_paints_the_callout_style_pandoc_already_created() -> None:
    with patch_pandoc(output_bytes=fixture_docx_bytes(with_callout_style=True)):
        result = await html_to_docx("<div>ignored</div>", theme(), title="T")

    document = Document(io.BytesIO(result))
    paragraph = next(p for p in document.paragraphs if p.style.name == "WikiHub Callout Info")
    pPr = paragraph._p.get_or_add_pPr()
    shading = pPr.find("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}shd")
    assert shading is not None
    assert shading.get(
        "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}fill"
    ) == "e6f0fa"


@pytest.mark.asyncio
async def test_html_to_docx_creates_the_style_when_pandoc_did_not() -> None:
    with patch_pandoc(output_bytes=fixture_docx_bytes(with_callout_style=False)):
        result = await html_to_docx("<div>ignored</div>", theme(), title="T")

    document = Document(io.BytesIO(result))
    assert "WikiHub Callout Info" in [s.name for s in document.styles]
    assert "WikiHub Toggle Summary" in [s.name for s in document.styles]
    assert "WikiHub Toggle Body" in [s.name for s in document.styles]


@pytest.mark.asyncio
async def test_a_nonzero_pandoc_exit_raises_service_unavailable() -> None:
    with (
        patch_pandoc(output_bytes=None, returncode=1, stderr=b"pandoc: parse error"),
        pytest.raises(ServiceUnavailableError),
    ):
        await html_to_docx("<p>x</p>", theme(), title="T")


@pytest.mark.asyncio
async def test_pandoc_not_being_installed_raises_service_unavailable() -> None:
    with (
        patch("asyncio.create_subprocess_exec", side_effect=FileNotFoundError("no pandoc")),
        pytest.raises(ServiceUnavailableError),
    ):
        await html_to_docx("<p>x</p>", theme(), title="T")


@pytest.mark.asyncio
async def test_a_pandoc_timeout_raises_service_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(export_docx.settings, "export_render_timeout_seconds", 0)

    async def never_returns(*_args: object, **_kwargs: object) -> None:
        await asyncio.Event().wait()

    fake_process = Mock()
    fake_process.communicate = never_returns
    fake_process.returncode = 0

    async def fake_create_subprocess_exec(*_args: object, **_kwargs: object):
        return fake_process

    with (
        patch("asyncio.create_subprocess_exec", side_effect=fake_create_subprocess_exec),
        pytest.raises(ServiceUnavailableError),
    ):
        await html_to_docx("<p>x</p>", theme(), title="T")
