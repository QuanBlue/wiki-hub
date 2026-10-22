# ruff: noqa: F811
"""The assistant reads the Help page, and can do what it is asked - after a confirmation.

What it proposes is checked against what the person may do; what runs is checked again, with the
application's own services, as that person. A member cannot make the assistant do more than the
member could do by hand.
"""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.modules.ai import chat as chat_module
from app.modules.ai import help_knowledge
from app.modules.ai.actions import PlanRunner, StepInput, derive_key, plan_from_reply
from app.modules.ai.service import AIService
from app.schemas.ai import PageDraft
from app.schemas.space import SpaceCreate
from tests.integration.test_ai_chat import Model, conversation, model, run  # noqa: F401
from tests.integration.test_hybrid_semantic_search import (  # noqa: F401 - fixtures
    _connect,
    _user,
    _wiki,
    installed,
)

pytestmark = pytest.mark.integration


async def _admin(session: AsyncSession) -> User:
    user = await _user(session, "boss")
    user.is_superuser = True
    await session.flush()
    return user


def reply(*steps: dict, say: str = "Ok") -> str:
    return "PLAN: " + json.dumps({"say": say, "steps": list(steps)})


# ------------------------------------------------------------------------------ Help


def test_help_is_found_by_what_it_says_in_either_language() -> None:
    english = help_knowledge.search("how do I schedule automatic backups")
    assert english and english[0].section_id == "backup-and-restore"
    # The spelling people type: ``ki`` for ``ky``, no accents, a plural.
    vietnamese = help_knowledge.search("ứng dụng có thể backup định kì không")
    assert vietnamese and vietnamese[0].section_id == "backup-and-restore"
    assert "Automatic backups" in english[0].text or "backup" in english[0].text.lower()
    assert help_knowledge.search("") == []
    assert help_knowledge.search("zzzz qqqq") == []


def test_a_topic_points_the_search_at_its_own_sections() -> None:
    plain = help_knowledge.search("how to change my password")
    pointed = help_knowledge.search("how to change my password", prefer={"your-account"})
    assert "your-account" in [p.section_id for p in pointed]
    assert plain != pointed or plain


def test_help_marks_what_only_administrators_do() -> None:
    passages = help_knowledge.search("automatic backups schedule")
    member = help_knowledge.help_block(passages, is_admin=False)
    admin = help_knowledge.help_block(passages, is_admin=True)
    assert 'audience="administrators"' in member and "NOT an administrator" in member
    assert "NOT an administrator" not in admin


def test_the_copied_help_matches_the_help_page() -> None:
    """The JSON the assistant reads is a copy of the Help page: it must not fall behind."""
    from pathlib import Path

    root = Path(__file__).resolve().parents[3]
    script = root / "scripts" / "build_help_knowledge.py"
    if not script.exists():  # the backend container does not have the frontend or the script
        pytest.skip("not run from the repository")
    import importlib.util

    spec = importlib.util.spec_from_file_location("build_help_knowledge", script)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for name, text in module.build().items():
        assert (module.OUT / name).read_text(encoding="utf-8") == text, (
            f"{name} is out of date: run scripts/build_help_knowledge.py"
        )


async def test_a_member_asking_about_backups_hears_it_exists_and_who_runs_it(
    installed: AsyncSession, model: Model
) -> None:
    owner, _, _ = await _wiki(installed)
    await _connect(installed, "")
    model.pieces = ["APP: Có, quản trị viên đặt lịch."]

    events = await run(installed, owner, conversation("ứng dụng có thể backup định kì không"))

    asked = model.streams[0][-1]["content"]
    assert "<help>" in asked and "Automatic backups" in asked
    assert "NOT an administrator" in asked
    done = events[-1]["result"]
    assert done["basis"] == "app" and done["actions"] == []


# ------------------------------------------------------------------------------ keys


def test_a_key_comes_from_the_name_and_stays_the_same_when_derived_again() -> None:
    assert derive_key("abc") == "ABC"
    assert derive_key("Hướng dẫn Prometheus") == "HUONG_DAN_PROMETHEUS"
    assert derive_key("HUONG_DAN") == "HUONG_DAN"
    assert derive_key("9 lives").startswith("S")
    assert len(derive_key("x" * 80)) == 32 and len(derive_key("?")) >= 2


# ----------------------------------------------------------------------------- the plan


async def test_a_plan_is_checked_and_a_new_space_gets_a_free_key(installed: AsyncSession) -> None:
    boss = await _admin(installed)
    taken = await _user(installed, "x")
    from app.modules.spaces.service import SpaceService

    await SpaceService(installed).create(SpaceCreate(key="ABC", name="Taken"), boss)

    say, plan = await plan_from_reply(
        installed,
        boss,
        reply(
            {"type": "create_space", "name": "abc"},
            {"type": "create_page", "space": "$1", "title": "Guide", "prompt": "about it"},
            {"type": "favorite_space", "space": "$1"},
            say="Doing it",
        ),
        may_create_space=True,
    )

    assert say == "Doing it" and plan is not None and plan.skipped == []
    [space, page, star] = plan.steps
    # "ABC" is taken: the plan says which key it will really use.
    assert space.args["key"] == "ABC_2" and "ABC_2" in space.label_en
    assert page.args["space"] == "$1" and 'space "abc"' in page.label_en
    assert star.type == "favorite_space"
    assert taken is not None


async def test_what_the_person_may_not_do_is_left_out_with_the_reason(
    installed: AsyncSession,
) -> None:
    owner, space, _ = await _wiki(installed)
    stranger = await _user(installed, "stranger")
    from app.models.space import SpaceVisibility

    space.visibility = SpaceVisibility.restricted
    await installed.flush()

    say, plan = await plan_from_reply(
        installed,
        stranger,
        reply(
            {"type": "create_space", "name": "mine"},  # no create-space permission
            {"type": "create_page", "space": space.key, "title": "T"},  # no access
            {"type": "create_page", "space": "NOPE", "title": "T"},  # no such space
            {"type": "create_page", "space": "$3", "title": "T"},  # step 3 made nothing
            {"type": "delete_everything"},  # not an action at all
            {"type": "create_page"},  # nothing in it
            "not even a step",
        ),
        may_create_space=False,
    )

    assert plan is not None and plan.steps == []
    reasons = [skip.reason_en for skip in plan.skipped]
    assert any("create spaces" in r for r in reasons)
    assert any("permission" in r for r in reasons)
    assert any("no space with the key" in r for r in reasons)
    assert any("not something I can do" in r for r in reasons)
    assert any("missing or not valid" in r for r in reasons)
    assert say == "Ok"
    _ = owner


async def test_a_member_is_only_offered_what_they_can_do_here(installed: AsyncSession) -> None:
    owner, space, _ = await _wiki(installed)
    member = await _user(installed, "member")
    # An open space lets anyone in write: page and star are offered, adding a member is not
    # (that needs the admin role).
    _, plan = await plan_from_reply(
        installed,
        member,
        reply(
            {"type": "create_page", "space": space.key, "title": "T"},
            {"type": "favorite_space", "space": space.key},
            {"type": "add_space_member", "space": space.key, "username": owner.username},
        ),
        may_create_space=False,
    )
    assert plan is not None
    assert [s.type for s in plan.steps] == ["create_page", "favorite_space"]
    assert plan.skipped[0].reason_en.startswith("you do not have the permission")


async def test_an_owner_can_add_a_member_and_an_unknown_user_is_refused(
    installed: AsyncSession,
) -> None:
    owner, space, _ = await _wiki(installed)
    friend = await _user(installed, "friend")

    _, plan = await plan_from_reply(
        installed,
        owner,
        reply(
            {"type": "add_space_member", "space": space.key, "username": f"@{friend.username}"},
            {"type": "add_space_member", "space": space.key, "username": "nobody-here"},
        ),
        may_create_space=False,
    )
    assert plan is not None and len(plan.steps) == 1
    assert plan.steps[0].args["role"] == "viewer" and friend.username in plan.steps[0].label_en
    assert "no active user" in plan.skipped[0].reason_en


async def test_text_that_is_not_a_plan_is_not_one(installed: AsyncSession) -> None:
    owner, _, _ = await _wiki(installed)
    assert await plan_from_reply(installed, owner, "no json here", may_create_space=True) == (
        "",
        None,
    )
    assert await plan_from_reply(installed, owner, "PLAN: {oops", may_create_space=True) == (
        "",
        None,
    )
    assert await plan_from_reply(
        installed, owner, '{"say":"hello","steps":"x"}', may_create_space=True
    ) == ("hello", None)
    # Secrets are not repeated in what is said.
    say, _ = await plan_from_reply(
        installed,
        owner,
        '{"say":"password=hunter2hunter2","steps":[]}',
        may_create_space=True,
    )
    assert "hunter2" not in say


# ----------------------------------------------------------------------------- running it


async def _run(session: AsyncSession, user: User, *steps: dict) -> list[dict]:
    runner = PlanRunner(session, user, "vi")
    return [e async for e in runner.run([StepInput(type=s.pop("type"), args=s) for s in steps])]


async def test_a_confirmed_plan_runs_as_the_person_and_writes_the_page(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    boss = await _admin(installed)
    drafted: list[str] = []

    async def draft(self, key, payload):
        drafted.append(f"{key}:{payload.prompt}:{payload.lang}")
        return PageDraft(title="Prometheus guide", content="<p>Written by AI</p>")

    monkeypatch.setattr(AIService, "draft_page", draft)
    key = f"Z{uuid.uuid4().hex[:6]}".upper()

    events = await _run(
        installed,
        boss,
        {"type": "create_space", "name": "Zed", "key": key},
        {"type": "create_page", "space": "$1", "title": "Guide", "prompt": "prometheus"},
        {"type": "favorite_space", "space": key},
    )

    assert [e["ok"] for e in events] == [True, True, True, True]
    assert events[0]["href"] == f"/spaces/{key}"
    assert events[1]["href"].startswith(f"/spaces/{key}/pages/")
    assert drafted == [f"{key}:prometheus:vi"]
    # The page is really there, with the draft's words.
    from app.modules.pages.service import PageService
    from app.modules.spaces.service import SpaceService

    space = await SpaceService(installed).get_by_key(key)
    pages = await PageService(installed).pages.list_for_space(space.id)
    assert "Prometheus guide" in [p.title for p in pages]
    assert any("Written by AI" in p.content for p in pages)


async def test_a_step_that_fails_stops_the_rest_and_says_why(installed: AsyncSession) -> None:
    owner, space, _ = await _wiki(installed)
    stranger = await _user(installed, "stranger")

    events = await _run(
        installed,
        stranger,
        {"type": "create_space", "name": "Nope", "key": "NOPE1"},  # not allowed to create
        {"type": "favorite_space", "space": space.key},  # never reached
    )

    assert [e["type"] for e in events] == ["step", "done"]
    assert events[0]["ok"] is False and events[1]["ok"] is False
    assert events[0]["error"]

    # A step that cannot work out its space (an earlier step did not make it) is a failure too.
    events = await _run(installed, owner, {"type": "favorite_space", "space": "$2"})
    assert events[0]["ok"] is False
    # So is a value that is not valid, and a user that does not exist.
    events = await _run(installed, owner, {"type": "create_page", "space": space.key})
    assert events[0]["ok"] is False
    events = await _run(
        installed, owner, {"type": "add_space_member", "space": space.key, "username": "ghost"}
    )
    assert events[0]["ok"] is False


async def test_adding_a_member_and_a_page_without_a_draft(installed: AsyncSession) -> None:
    owner, space, _ = await _wiki(installed)
    friend = await _user(installed, "friend")

    events = await _run(
        installed,
        owner,
        {
            "type": "add_space_member",
            "space": space.key,
            "username": friend.username,
            "role": "editor",
        },
        {"type": "create_page", "space": space.key, "title": "Empty on purpose"},
    )

    assert [e["ok"] for e in events] == [True, True, True]
    from app.modules.spaces.service import SpaceService

    members = await SpaceService(installed).list_members(space)
    assert (friend.username, "editor") in [(m.username, m.role.value) for m in members]


# ------------------------------------------------------------------------- in the chat


async def test_the_chat_proposes_a_plan_and_nothing_is_done_yet(
    installed: AsyncSession, model: Model
) -> None:
    boss = await _admin(installed)
    await _connect(installed, "")
    model.pieces = [reply({"type": "create_space", "name": "abc"}, say="Tạo space abc")]

    events = await run(installed, boss, conversation("tôi muốn tạo space abc"))

    assert not [e for e in events if e["type"] == "delta"]  # the JSON is never shown as text
    done = events[-1]["result"]
    assert done["basis"] == "plan" and done["answer"] == "Tạo space abc"
    assert [s["type"] for s in done["plan"]["steps"]] == ["create_space"]
    assert done["actions"] == []
    # The model was told it may propose actions, and the keys of the spaces for the steps.
    system, asked = model.streams[0][0]["content"], model.streams[0][-1]["content"]
    assert "PLAN MODE" in system and "create_space" in asked
    from app.modules.spaces.service import SpaceService

    assert not [s for s in await SpaceService(installed).list_spaces(boss) if s.name == "abc"]


async def test_a_plan_with_nothing_allowed_is_told_to_the_person(
    installed: AsyncSession, model: Model
) -> None:
    owner, _, _ = await _wiki(installed)
    await _connect(installed, "")
    model.pieces = [reply({"type": "create_space", "name": "abc"}, say="Tạo space abc")]

    events = await run(installed, owner, conversation("tôi muốn tạo space abc"))

    done = events[-1]["result"]
    assert done["basis"] == "app" and done["plan"]["steps"] == []
    assert "create spaces" in done["plan"]["skipped"][0]["reason_en"]

    # And a reply that is no plan at all is no answer.
    model.pieces = ["PLAN: this is not json"]
    events = await run(installed, owner, conversation("tôi muốn tạo space abc"))
    assert events[-1]["result"]["found"] is False
    assert chat_module._PLAN.match("PLAN: {}")


async def test_two_new_spaces_of_one_name_get_two_keys_and_a_description_is_kept(
    installed: AsyncSession,
) -> None:
    boss = await _admin(installed)

    _, plan = await plan_from_reply(
        installed,
        boss,
        reply(
            {"type": "create_space", "name": "Billing", "description": "Invoices and plans"},
            {"type": "create_space", "name": "Billing"},
        ),
        may_create_space=True,
    )

    assert plan is not None
    first, second = plan.steps
    assert first.args["description"] == "Invoices and plans"
    assert "description" not in second.args
    assert first.args["key"] != second.args["key"]


async def test_a_step_that_is_not_an_object_is_ignored_and_a_user_that_is_not_there_fails(
    installed: AsyncSession,
) -> None:
    from app.modules.spaces.service import SpaceService

    boss = await _admin(installed)
    await SpaceService(installed).create(SpaceCreate(key="TEAM1", name="Team"), boss)

    _, plan = await plan_from_reply(
        installed,
        boss,
        reply("not a step", {"type": "favorite_space", "space": "TEAM1"}),
        may_create_space=True,
    )
    assert plan is not None and [step.type for step in plan.steps] == ["favorite_space"]

    events = await _run(
        installed, boss, {"type": "add_space_member", "space": "TEAM1", "username": "ghost"}
    )
    assert events[0]["ok"] is False and events[0]["error"] == "User not found."
