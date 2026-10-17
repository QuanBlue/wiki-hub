"""Doing what the person asked, not only telling them how.

The chat can *propose* a short plan - create a space, write a page in it, add someone, star a
space - but never carries it out on its own say-so. The plan is shown as a card with exactly what
will happen; nothing runs until the person presses Confirm. Running it is then done here with the
very services the application's own pages use, **as that person**, so what they are not allowed
to do is refused exactly as it would be anywhere else, whatever the model wrote.

``plan_from_reply`` turns the model's JSON into steps that can be shown (dropping what is
invalid, unknown or not permitted, and saying why); ``PlanRunner`` runs the steps the browser
sends back, re-checking each one.
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, WikiHubError
from app.core.logging import get_logger
from app.models.permission import GlobalPermission, Permission
from app.models.space import Space, SpaceRole, SpaceVisibility
from app.models.user import User
from app.modules.ai.answer import scrub_secrets
from app.modules.ai.assistant_context import fold
from app.modules.pages.service import PageService
from app.modules.permissions.service import PermissionService
from app.modules.spaces.service import SpaceService
from app.repositories.user import UserRepository
from app.schemas.ai import AnswerPlan, AnswerPlanSkip, AnswerPlanStep, PageDraftRequest
from app.schemas.page import PageCreate
from app.schemas.space import SpaceCreate

logger = get_logger(__name__)

#: A plan is a handful of steps, not a script.
MAX_STEPS = 6
_SAY_CHARS = 600
_REF = re.compile(r"^\$([1-9])$")
_KEY_JUNK = re.compile(r"[^A-Z0-9_]+")


# ------------------------------------------------------------------ what each step takes


class _Args(BaseModel):
    """Common to every step: unknown words from the model are ignored, not trusted."""

    model_config = {"extra": "ignore"}


class CreateSpaceArgs(_Args):
    name: str = Field(min_length=1, max_length=255)
    key: str | None = Field(default=None, max_length=32)
    description: str = Field(default="", max_length=500)
    visibility: SpaceVisibility = SpaceVisibility.open

    @field_validator("name", "description")
    @classmethod
    def _trim(cls, value: str) -> str:
        return value.strip()


class CreatePageArgs(_Args):
    #: A space key, or ``$1``..``$9``: the space made by that earlier step of the plan.
    space: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=255)
    #: What the page should say, in the person's words: an AI draft is written from it when the
    #: plan runs. Empty makes an empty page.
    prompt: str = Field(default="", max_length=2000)

    @field_validator("title", "prompt")
    @classmethod
    def _trim(cls, value: str) -> str:
        return value.strip()


class FavoriteArgs(_Args):
    space: str = Field(min_length=1, max_length=40)


class AddMemberArgs(_Args):
    space: str = Field(min_length=1, max_length=40)
    username: str = Field(min_length=1, max_length=64)
    role: SpaceRole = SpaceRole.viewer

    @field_validator("username")
    @classmethod
    def _trim(cls, value: str) -> str:
        return value.strip().lstrip("@")


STEP_ARGS: dict[str, type[_Args]] = {
    "create_space": CreateSpaceArgs,
    "create_page": CreatePageArgs,
    "favorite_space": FavoriteArgs,
    "add_space_member": AddMemberArgs,
}

# --------------------------------------------------------------------------- the plan

_LABELS = {
    "create_space": (
        'Create space "{name}" (key {key})',
        'Tạo space "{name}" (mã {key})',
    ),
    "create_page": (
        'Write the page "{title}" in space "{space}"',
        'Tạo trang "{title}" trong space "{space}"',
    ),
    "favorite_space": ('Star space "{space}"', 'Đánh dấu yêu thích space "{space}"'),
    "add_space_member": (
        'Give @{username} the {role} role in space "{space}"',
        'Cấp quyền {role} cho @{username} trong space "{space}"',
    ),
}


def _label(kind: str, **values: str) -> tuple[str, str]:
    en, vi = _LABELS[kind]
    return en.format(**values), vi.format(**values)


def derive_key(name: str) -> str:
    """A space key from a name: ``Hướng dẫn abc`` -> ``HUONG_DAN_ABC`` (2-32, a letter first)."""
    words = fold(name).upper().split()
    key = "_".join(filter(None, (_KEY_JUNK.sub("", word) for word in words)))[:32].strip("_")
    if not key or not key[0].isalpha():
        key = f"S{key}"[:32]
    return key if len(key) >= 2 else f"{key}X"


async def _free_key(session: AsyncSession, wanted: str) -> str:
    """``wanted`` or, when a space has it already, the same with a number after it."""
    spaces = SpaceService(session)
    for attempt in range(1, 30):
        candidate = wanted if attempt == 1 else f"{wanted[: 32 - len(str(attempt)) - 1]}_{attempt}"
        if await spaces.spaces.get_by_key(candidate) is None:
            return candidate
    return f"{wanted[:24]}_{uuid.uuid4().hex[:6].upper()}"


def _json_of(text: str) -> dict[str, Any] | None:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


@dataclass
class _Resolved:
    space: Space | None
    #: The name to show for it.
    name: str


class _Planner:
    def __init__(self, session: AsyncSession, user: User, may_create_space: bool) -> None:
        self.session = session
        self.user = user
        self.may_create_space = may_create_space
        self.spaces = SpaceService(session)
        self.permissions = PermissionService(session)
        #: Step number -> the name of the space that step makes.
        self.made: dict[int, str] = {}
        self.taken_keys: set[str] = set()

    async def _space(self, ref: str, need: Permission) -> _Resolved:
        match = _REF.match(ref.strip())
        if match:
            number = int(match.group(1))
            if number not in self.made:
                raise _Skip(
                    "it refers to a space no earlier step makes",
                    "nó nhắc đến một space mà bước trước không tạo",
                )
            return _Resolved(None, self.made[number])
        try:
            space = await self.spaces.get_by_key(ref.strip().upper())
        except NotFoundError:
            raise _Skip(
                f"there is no space with the key {ref}", f"không có space nào có mã {ref}"
            ) from None
        if need not in await self.permissions.effective_permissions(space, self.user):
            raise _Skip(
                f'you do not have the permission to do this in "{space.name}"',
                f'bạn không có quyền thực hiện việc này trong "{space.name}"',
            )
        return _Resolved(space, space.name)

    async def step(self, number: int, raw: dict[str, Any]) -> AnswerPlanStep:
        kind = str(raw.get("type", ""))
        model = STEP_ARGS.get(kind)
        if model is None:
            raise _Skip("this is not something I can do", "mình chưa thực hiện được việc này")
        try:
            args = model.model_validate({k: v for k, v in raw.items() if k != "type"})
        except ValidationError:
            raise _Skip("a value is missing or not valid", "thiếu hoặc sai một giá trị") from None

        if isinstance(args, CreateSpaceArgs):
            if not self.may_create_space:
                raise _Skip(
                    "you do not have the permission to create spaces",
                    "bạn không có quyền tạo space",
                )
            wanted = derive_key(args.key or args.name)
            key = await _free_key(self.session, wanted)
            while key in self.taken_keys:
                key = await _free_key(self.session, f"{wanted[:28]}_{len(self.taken_keys) + 1}")
            self.taken_keys.add(key)
            self.made[number] = args.name
            data = {"name": args.name, "key": key, "visibility": args.visibility.value}
            if args.description:
                data["description"] = args.description
            en, vi = _label(kind, name=args.name, key=key)
        elif isinstance(args, CreatePageArgs):
            where = await self._space(args.space, Permission.add)
            data = {"space": args.space.strip().upper(), "title": args.title}
            if args.prompt:
                data["prompt"] = args.prompt
            en, vi = _label(kind, title=args.title, space=where.name)
        elif isinstance(args, FavoriteArgs):
            where = await self._space(args.space, Permission.view)
            data = {"space": args.space.strip().upper()}
            en, vi = _label(kind, space=where.name)
        else:
            assert isinstance(args, AddMemberArgs)
            where = await self._space(args.space, Permission.admin)
            target = await UserRepository(self.session).get_by_username(args.username)
            if target is None or not target.is_active:
                raise _Skip(
                    f"there is no active user called {args.username}",
                    f"không có người dùng nào tên {args.username}",
                )
            data = {
                "space": args.space.strip().upper(),
                "username": target.username,
                "role": args.role.value,
            }
            en, vi = _label(kind, username=target.username, role=args.role.value, space=where.name)
        return AnswerPlanStep(type=kind, args=data, label_en=en, label_vi=vi)


class _Skip(Exception):
    """A step that cannot be offered, with the reason in both languages."""

    def __init__(self, en: str, vi: str) -> None:
        super().__init__(en)
        self.en = en
        self.vi = vi


async def plan_from_reply(
    session: AsyncSession, user: User, text: str, *, may_create_space: bool
) -> tuple[str, AnswerPlan | None]:
    """The sentence to show and the plan to confirm; ``None`` when there is nothing to run."""
    data = _json_of(text)
    if data is None:
        return "", None
    say = " ".join(scrub_secrets(str(data.get("say", ""))).split())[:_SAY_CHARS]
    raw_steps = data.get("steps")
    if not isinstance(raw_steps, list):
        return say, None

    planner = _Planner(session, user, may_create_space)
    steps: list[AnswerPlanStep] = []
    skipped: list[AnswerPlanSkip] = []
    for number, raw in enumerate(raw_steps[:MAX_STEPS], start=1):
        if not isinstance(raw, dict):
            continue
        try:
            steps.append(await planner.step(number, raw))
        except _Skip as why:
            skipped.append(
                AnswerPlanSkip(
                    label=str(raw.get("title") or raw.get("name") or raw.get("type") or "?")[:80],
                    reason_en=why.en,
                    reason_vi=why.vi,
                )
            )
            # A step that makes a space did not happen: later steps that need it cannot either.
            planner.made.pop(number, None)
    if not steps:
        return say, AnswerPlan(steps=[], skipped=skipped) if skipped else None
    return say, AnswerPlan(steps=steps, skipped=skipped)


# --------------------------------------------------------------------------- running it


class StepInput(BaseModel):
    type: Literal["create_space", "create_page", "favorite_space", "add_space_member"]
    args: dict[str, Any] = Field(default_factory=dict)


class PlanRunner:
    """Runs confirmed steps one by one, as ``user``, saving each before the next."""

    def __init__(self, session: AsyncSession, user: User, lang: str = "en") -> None:
        self.session = session
        self.user = user
        self.lang = lang if lang in ("en", "vi") else "en"
        self.spaces = SpaceService(session)
        self.pages = PageService(session)
        self.permissions = PermissionService(session)
        #: ``$n`` -> the key of the space step n made.
        self.made: dict[int, str] = {}

    def _key(self, ref: str) -> str:
        match = _REF.match(ref.strip())
        if match:
            number = int(match.group(1))
            if number not in self.made:
                raise NotFoundError("The space this step needs was not created.")
            return self.made[number]
        return ref.strip().upper()

    async def run(self, steps: list[StepInput]) -> AsyncIterator[dict[str, Any]]:
        for number, step in enumerate(steps[:MAX_STEPS], start=1):
            try:
                async with self.session.begin_nested():
                    href = await self._do(number, step)
                await self.session.commit()
            except (WikiHubError, ValidationError, ValueError) as error:
                await self.session.rollback()
                logger.info("ai_plan_step_failed", type=step.type, error=type(error).__name__)
                message = getattr(error, "message", None) or "This step could not be done."
                yield {"type": "step", "index": number, "ok": False, "error": str(message)[:300]}
                # Later steps may depend on this one: stop here rather than half-do the rest.
                yield {"type": "done", "ok": False}
                return
            yield {"type": "step", "index": number, "ok": True, "href": href}
        yield {"type": "done", "ok": True}

    async def _do(self, number: int, step: StepInput) -> str:
        args = STEP_ARGS[step.type].model_validate(step.args)
        if isinstance(args, CreateSpaceArgs):
            await PermissionService(self.session).require_global(
                self.user, GlobalPermission.create_space
            )
            key = derive_key(args.key or args.name)
            space = await self.spaces.create(
                SpaceCreate(
                    key=key,
                    name=args.name,
                    description=args.description,
                    visibility=args.visibility,
                ),
                self.user,
            )
            self.made[number] = space.key
            return f"/spaces/{space.key}"

        if isinstance(args, CreatePageArgs):
            space = await self.spaces.get_by_key(self._key(args.space))
            title, content = args.title, ""
            if args.prompt:
                from app.modules.ai.service import AIService

                draft = await AIService(self.session, self.user).draft_page(
                    space.key,
                    PageDraftRequest(prompt=args.prompt, title=args.title, lang=self.lang),
                )
                title, content = draft.title or args.title, draft.content
            page = await self.pages.create(
                space, PageCreate(title=title, content=content), self.user
            )
            return f"/spaces/{space.key}/pages/{page.slug}"

        if isinstance(args, FavoriteArgs):
            space = await self.spaces.get_by_key(self._key(args.space))
            await self.spaces.require_view(space, self.user)
            await self.spaces.set_favorite(space, self.user, True)
            return f"/spaces/{space.key}"

        assert isinstance(args, AddMemberArgs)
        space = await self.spaces.get_by_key(self._key(args.space))
        target = await UserRepository(self.session).get_by_username(args.username)
        if target is None:
            raise NotFoundError("User not found.")
        await self.spaces.set_member(space, self.user, target.id, args.role)
        return f"/spaces/{space.key}"
