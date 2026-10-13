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
        monkeypatch.setattr(service_module, "chat", chat)
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
