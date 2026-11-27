"""Drafting a page: the model's Markdown becomes editor HTML with an AI notice on top."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.exceptions import PermissionDeniedError
from app.modules.ai import service as service_module
from app.modules.ai.config import AIConfig
from app.modules.ai.draft_html import draft_to_html, split_title
from app.modules.ai.service import AIService
from app.modules.ai.skills import (
    DEFAULT_PAGE_DRAFT_INSTRUCTIONS,
    PAGE_DRAFT_RULES,
    page_draft_system_prompt,
)
from app.schemas.ai import PageDraftRequest
from tests.unit.ai_fakes import fake_chat

MODEL_REPLY = """Title: Restart the queue worker

# Restart the queue worker

Use this when jobs stop moving.

## Steps

1. Log in to the host.
2. Run `systemctl restart worker`.

## Checklist

- [ ] Queue is draining
- [x] Alert cleared

## Commands

```bash
systemctl status worker
```

| Host | Owner |
| ---- | ----- |
| a1   | <owner> |

<script>alert(1)</script>
"""


def test_the_title_line_is_split_from_the_body() -> None:
    title, body = split_title(MODEL_REPLY)

    assert title == "Restart the queue worker"
    assert body.lstrip().startswith("# Restart")


def test_a_reply_without_a_title_line_keeps_the_typed_title() -> None:
    assert split_title("Just text", "Mine") == ("Mine", "Just text")


def test_the_page_starts_with_the_ai_notice_in_the_readers_language() -> None:
    en = draft_to_html("Hello there.", "en")
    vi = draft_to_html("Hello there.", "vi")

    assert en.startswith('<div data-type="callout" data-callout-type="info"')
    assert "drafted by AI" in en
    assert "do AI tạo" in vi
    assert en.strip().endswith("<p>Hello there.</p>")


def test_markdown_becomes_the_shapes_the_editor_understands() -> None:
    _, body = split_title(MODEL_REPLY)
    page = draft_to_html(body, "en")

    assert "<h2>Steps</h2>" in page
    assert "<ol>" in page
    assert '<pre><code class="language-bash">' in page
    assert "<table>" in page
    assert 'data-type="taskList"' in page
    assert page.count('data-type="taskItem"') == 2
    assert 'data-checked="true"' in page
    assert "[ ]" not in page


def test_a_repeated_title_heading_and_raw_script_are_dropped() -> None:
    _, body = split_title(MODEL_REPLY)
    page = draft_to_html(body, "en")

    assert "<h1>" not in page
    assert "<script" not in page
    assert "&lt;script&gt;" in page  # kept as inert text, never as a tag


def test_a_plain_bullet_list_stays_a_bullet_list() -> None:
    page = draft_to_html("- one\n- two\n- [ ] three", "en")

    assert "taskList" not in page
    assert "<ul>" in page


def test_mermaid_code_block_becomes_an_editable_diagram() -> None:
    html = draft_to_html("```mermaid\ngraph TD; A-->B\n```", "en", notice=False)
    assert 'data-type="diagram"' in html
    assert 'data-engine="mermaid"' in html
    assert 'data-code="graph TD; A--&gt;B' in html


def test_the_prompt_has_the_skill_the_format_rules_and_marks_the_request_as_data() -> None:
    prompt = page_draft_system_prompt("Be brief.")

    assert prompt.startswith("Be brief.")
    assert PAGE_DRAFT_RULES in prompt
    assert "<request>" in prompt
    assert "Title:" in DEFAULT_PAGE_DRAFT_INSTRUCTIONS or "title" in DEFAULT_PAGE_DRAFT_INSTRUCTIONS


class Harness:
    def __init__(self, monkeypatch: pytest.MonkeyPatch, *, editor: bool = True) -> None:
        self.prompts: list[list[dict[str, str]]] = []
        self.charges = 0

        async def config(_session: object) -> AIConfig:
            return AIConfig(True, "http://gateway.test/v1", "k", "m")

        async def instructions(_session: object) -> str:
            return "Write a page."

        async def chat(_config: AIConfig, messages: list[dict[str, str]], **_kw: object) -> str:
            self.prompts.append(messages)
            return MODEL_REPLY

        async def enforce(_key: str, _rule: str) -> None:
            self.charges += 1

        async def get_by_key(_self: object, _key: str) -> SimpleNamespace:
            return SimpleNamespace(key="ENG")

        async def require_editor(_self: object, _space: object, _user: object) -> None:
            if not editor:
                raise PermissionDeniedError("no")

        monkeypatch.setattr(service_module, "load_config", config)
        monkeypatch.setattr(service_module, "page_draft_instructions", instructions)
        fake_chat(monkeypatch, chat)
        monkeypatch.setattr(service_module.rate_limit, "enforce", enforce)
        self.service = AIService.__new__(AIService)
        self.service.session = None  # type: ignore[assignment]
        self.service.user = SimpleNamespace(id="u1")  # type: ignore[assignment]
        self.service.spaces = SimpleNamespace(get_by_key=lambda key: get_by_key(None, key))  # type: ignore[assignment]
        self.service.pages = SimpleNamespace(  # type: ignore[assignment]
            require_editor=lambda space, user: require_editor(None, space, user)
        )


async def test_a_draft_is_titled_filled_and_charged_once(monkeypatch: pytest.MonkeyPatch) -> None:
    harness = Harness(monkeypatch)

    draft = await harness.service.draft_page(
        "ENG", PageDraftRequest(prompt="how to restart the worker", lang="vi")
    )

    assert draft.title == "Restart the queue worker"
    assert draft.content.startswith('<div data-type="callout"')
    assert "do AI tạo" in draft.content
    assert harness.charges == 1
    user_message = harness.prompts[0][1]["content"]
    assert "<request>\nhow to restart the worker\n</request>" in user_message


async def test_someone_who_cannot_create_pages_never_reaches_the_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = Harness(monkeypatch, editor=False)

    with pytest.raises(PermissionDeniedError):
        await harness.service.draft_page("ENG", PageDraftRequest(prompt="anything at all"))

    assert harness.prompts == []
    assert harness.charges == 0


def test_callouts_toc_toggles_and_badges_become_tiptap_nodes() -> None:
    md = """Overview paragraph.

[TOC]

## Setup [badge:blue|ADMIN]

> [!WARNING] Do not restart yet
> Grant administrator access before rebooting.

> [!TIP] Quick check
> Run `ipconfig /all` to verify.

> Plain quote stays blockquote.

:::toggle Troubleshooting common errors
- Check `[badge:red|ERROR]` inside inline code stays text.
- Retry `gpupdate /force`.
:::

:::toggle[open] Windows 11 notes
1. Open **Settings** > **System** > **About**.
:::

```markdown
:::toggle inside code fence
> [!WARNING] ignored inside fence
[badge:red|IGNORED]
:::
```

- [ ] First loose task

- [x] Second loose task
"""
    html = draft_to_html(md, "en", notice=False)

    assert '<div data-type="tableOfContents"></div>' in html
    assert 'data-type="callout"' in html
    assert 'data-callout-type="warning"' in html
    assert "<strong>Do not restart yet</strong>" in html
    assert 'data-callout-type="tip"' in html
    assert "<blockquote>\n<p>Plain quote stays blockquote.</p>\n</blockquote>" in html
    assert html.count('data-type="toggle"') == 2
    assert 'data-open="false"' in html
    assert 'data-open="true"' in html
    assert '<div data-type="toggle-summary">Troubleshooting common errors</div>' in html
    assert '<div data-type="toggle-content">' in html
    assert 'data-type="statusBadge"' in html
    assert 'data-label="ADMIN"' in html
    assert 'data-color="blue"' in html
    # Code blocks / inline code must not be transformed into rich nodes
    assert "<code>[badge:red|ERROR]</code>" in html
    assert "[badge:red|IGNORED]" in html
    assert "ignored inside fence" in html
    assert ":::toggle inside code fence" in html
    # Loose task list has no <p> nested inside <span class="task-body">
    from bs4 import BeautifulSoup

    parsed = BeautifulSoup(html, "html.parser")
    task_bodies = parsed.select("span.task-body")
    assert [body.get_text(strip=True) for body in task_bodies] == [
        "First loose task",
        "Second loose task",
    ]
    assert not any(body.find("p") for body in task_bodies)


def test_rich_blocks_still_sanitize_xss_payloads() -> None:
    md = """
> [!WARNING] Watch out <script>alert(1)</script>
> Click <img src=x onerror=alert(2)> here.

:::toggle Summary <script>evil()</script>
Body with [badge:red|<script>x</script>]
:::
"""
    html = draft_to_html(md, "vi", notice=False)

    assert "<script" not in html
    assert "<img" not in html
    assert "&lt;img src=x onerror=alert(2)&gt;" in html
    assert 'data-callout-type="warning"' in html
    assert 'data-type="toggle"' in html


async def test_draft_respects_detail_level_and_revision_feedback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_kwargs: list[dict[str, object]] = []
    captured_messages: list[list[dict[str, str]]] = []

    async def config(_session: object) -> AIConfig:
        return AIConfig(True, "http://gateway.test/v1", "k", "m")

    async def instructions(_session: object) -> str:
        return DEFAULT_PAGE_DRAFT_INSTRUCTIONS

    async def chat(_config: AIConfig, messages: list[dict[str, str]], **kw: object) -> str:
        captured_messages.append(messages)
        captured_kwargs.append(kw)
        return MODEL_REPLY

    async def enforce(_key: str, _rule: str) -> None:
        return None

    async def get_by_key(_key: str) -> SimpleNamespace:
        return SimpleNamespace(key="IT")

    async def require_editor(_space: object, _user: object) -> None:
        return None

    monkeypatch.setattr(service_module, "load_config", config)
    monkeypatch.setattr(service_module, "page_draft_instructions", instructions)
    fake_chat(monkeypatch, chat)
    monkeypatch.setattr(service_module.rate_limit, "enforce", enforce)

    service = AIService.__new__(AIService)
    service.session = None  # type: ignore[assignment]
    service.user = SimpleNamespace(id="u1")  # type: ignore[assignment]
    service.spaces = SimpleNamespace(get_by_key=get_by_key)  # type: ignore[assignment]
    service.pages = SimpleNamespace(require_editor=require_editor)  # type: ignore[assignment]

    brief = await service.draft_page(
        "IT",
        PageDraftRequest(prompt="Cài Windows 10/11 Enterprise cho nhân sự mới", detail="brief"),
    )
    assert captured_kwargs[0]["max_tokens"] == 2400
    assert "DETAIL LEVEL (BRIEF)" in captured_messages[0][0]["content"]
    assert brief.markdown.startswith("# Restart the queue worker")

    await service.draft_page(
        "IT",
        PageDraftRequest(
            prompt="Cài Windows 10/11 Enterprise cho nhân sự mới",
            detail="detailed",
            previous_draft="## Old draft\n\nStep 1.",
            revision_instruction="Thêm phần xử lý lỗi join domain.",
        ),
    )
    assert captured_kwargs[1]["max_tokens"] == 8000
    assert "DETAIL LEVEL (DETAILED)" in captured_messages[1][0]["content"]
    assert "REVISION MODE" in captured_messages[1][0]["content"]
    assert "<previous_draft>\n## Old draft\n\nStep 1.\n</previous_draft>" in captured_messages[1][1]["content"]
    assert "<revision_instruction>\nThêm phần xử lý lỗi join domain.\n</revision_instruction>" in captured_messages[1][1]["content"]
