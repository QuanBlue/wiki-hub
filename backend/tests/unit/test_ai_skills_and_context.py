"""Skill instructions (custom or built-in) and the related-page search."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.modules.ai import page_context, skills
from app.modules.ai.skills import AISkillService


def _session(row: object | None) -> Mock:
    return Mock(get=AsyncMock(return_value=row), add=Mock(), delete=AsyncMock(), commit=AsyncMock())


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("loader", "args", "default"),
    [
        (skills.summary_instructions, (), skills.DEFAULT_SUMMARY_INSTRUCTIONS),
        (skills.page_draft_instructions, (), skills.DEFAULT_PAGE_DRAFT_INSTRUCTIONS),
        (skills.writing_instructions, (), skills.DEFAULT_WRITING_INSTRUCTIONS),
        (skills.suggestions_instructions, (), skills.DEFAULT_SUGGESTIONS_INSTRUCTIONS),
        (skills.selection_instructions, ("explain",), skills.DEFAULTS[skills.SELECTION_EXPLAIN]),
        (
            skills.selection_instructions,
            ("translate",),
            skills.DEFAULTS[skills.SELECTION_TRANSLATE],
        ),
    ],
)
async def test_instructions_are_the_custom_text_or_the_built_in_one(loader, args, default) -> None:
    assert await loader(_session(None), *args) == default
    custom = SimpleNamespace(instructions="  Be terse.  ")
    assert await loader(_session(custom), *args) == "Be terse."


def test_the_prompts_name_the_language_they_work_in() -> None:
    assert "Vietnamese" in skills.translation_system_prompt("vi")
    assert skills.clarify_system_prompt().startswith(skills.CLARIFY_RULES)


@pytest.mark.asyncio
async def test_saving_skill_text_adds_updates_or_clears_the_row() -> None:
    actor = SimpleNamespace(id=uuid.uuid4())

    added = _session(None)
    await AISkillService(added, actor).save(skills.WRITING, "  New style  ")
    added.add.assert_called_once()

    row = SimpleNamespace(instructions="old", updated_by_id=None)
    updated = _session(row)
    await AISkillService(updated, actor).save(skills.WRITING, "Newer")
    assert row.instructions == "Newer" and row.updated_by_id == actor.id

    cleared = _session(row)
    await AISkillService(cleared, actor).save(skills.WRITING, "   ")
    cleared.delete.assert_awaited_once_with(row)

    nothing = _session(None)
    await AISkillService(nothing, actor).save(skills.WRITING, "")
    nothing.delete.assert_not_awaited()


def _page(title: str, body: str, space_id: uuid.UUID) -> SimpleNamespace:
    return SimpleNamespace(title=title, content=f"<p>{body}</p>", space_id=space_id)


@pytest.mark.asyncio
async def test_related_pages_are_ranked_and_filtered_by_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    here = uuid.uuid4()
    title_hit = _page("Prometheus setup", "monitoring host", uuid.uuid4())
    body_hit = _page("Runbook", "Install prometheus here", here)
    unrelated = _page("Cooking", "pasta", uuid.uuid4())
    secret = _page("Prometheus secrets", "prometheus", uuid.uuid4())
    session = Mock(scalars=AsyncMock(return_value=[body_hit, unrelated, secret, title_hit]))

    async def can_view(_self: object, page: object, _user: object) -> bool:
        return page is not secret

    monkeypatch.setattr(page_context.PermissionService, "can_view_page", can_view)

    found = await page_context.find_related(session, object(), "prometheus setup", space_id=here)
    assert found == [title_hit, body_hit]

    limited = await page_context.find_related(session, object(), "prometheus setup", limit=1)
    assert limited == [title_hit]
    assert await page_context.find_related(session, object(), "a an of") == []
