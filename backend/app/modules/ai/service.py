"""AI features built on the chat gateway. Today: a short summary of a page."""

from __future__ import annotations

import hashlib
import re
import uuid

from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core import rate_limit
from app.core.config import settings
from app.core.exceptions import ServiceUnavailableError
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.models.attachment import PageAttachment
from app.models.page import WikiPage
from app.models.user import User
from app.models.user_page_label import UserPageLabel
from app.modules.ai.client import chat_with_usage
from app.modules.ai.config import load_config
from app.modules.ai.draft_html import draft_to_html, split_title
from app.modules.ai.page_context import (
    find_related,
    parse_questions,
    parse_suggestions,
    wiki_context,
)
from app.modules.ai.skills import (
    LANGUAGES,
    assist_system_prompt,
    clarify_system_prompt,
    page_draft_instructions,
    page_draft_system_prompt,
    selection_instructions,
    selection_system_prompt,
    suggest_system_prompt,
    suggestions_instructions,
    summary_instructions,
    summary_system_prompt,
    translation_system_prompt,
    writing_instructions,
)
from app.modules.ai.text import page_plain_text
from app.modules.pages.service import PageService
from app.modules.permissions.service import PermissionService
from app.modules.spaces.service import SpaceService
from app.modules.stats.recorder import record_ai_usage
from app.schemas.ai import (
    AssistRequest,
    AssistResult,
    ExplainRequest,
    ExplainResult,
    PageClarify,
    PageDraft,
    PageDraftRequest,
    PageSuggestions,
    PageSummary,
    RelatedPage,
    SuggestedLabel,
    SummaryAttachment,
)

logger = get_logger(__name__)

_SUMMARY_TTL_SECONDS = 30 * 24 * 3600


_ATTACHMENT_URL = re.compile(r"/api/v1/attachments/([0-9a-fA-F-]{36})")


def attachment_ids(content: str) -> list[uuid.UUID]:
    """Ids of the attachments a page's content points at, in order, once each."""
    seen: dict[uuid.UUID, None] = {}
    for found in _ATTACHMENT_URL.findall(content or ""):
        try:
            seen.setdefault(uuid.UUID(found), None)
        except ValueError:
            continue
    return list(seen)


def summary_user_message(title: str, text: str, attachments: list[SummaryAttachment]) -> str:
    """What the model reads: the page text, and the names of the files attached to it."""
    message = f"Title: {title}\n<page>\n{text}\n</page>"
    if attachments:
        names = "\n".join(attachment.filename for attachment in attachments)
        message += f"\n<files>\n{names}\n</files>"
    return message


class AIService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user
        self.spaces = SpaceService(session)
        self.pages = PageService(session)

    async def _chat(
        self,
        feature: str,
        config,
        messages: list[dict[str, str]],
        *,
        max_tokens: int = 2000,
    ) -> str:
        """Ask the model and log the tokens it cost for the statistics page."""
        reply = await chat_with_usage(config, messages, max_tokens=max_tokens)
        if reply.usage is not None:
            await record_ai_usage(
                user_id=self.user.id,
                feature=feature,
                model=config.model,
                prompt_tokens=reply.usage.prompt_tokens,
                completion_tokens=reply.usage.completion_tokens,
            )
        return reply.text

    async def _visible_page(self, key: str, slug: str) -> WikiPage:
        """Page text only ever reaches the model for someone allowed to read it."""
        space = await self.spaces.get_by_key(key)
        await self.spaces.require_view(space, self.user)
        page = await self.pages.get_by_slug(space, slug)
        await self.pages.require_page_view(page, self.user)
        return page

    async def _attachments(self, page: WikiPage) -> list[SummaryAttachment]:
        """The page's own attachments only - an id in the content that belongs to
        another page is ignored, so a summary can never link into someone else's file."""
        ids = attachment_ids(page.content)
        if not ids:
            return []
        rows = await self.session.scalars(
            select(PageAttachment).where(
                PageAttachment.page_id == page.id, PageAttachment.id.in_(ids)
            )
        )
        by_id = {row.id: row for row in rows}
        return [
            SummaryAttachment(
                id=by_id[i].id, filename=by_id[i].filename, content_type=by_id[i].content_type
            )
            for i in ids
            if i in by_id
        ]

    async def _read(self, redis: Redis, key: str) -> str | None:
        try:
            return await redis.get(key)
        except (RedisError, OSError):
            return None

    async def _write(self, redis: Redis, key: str, value: str) -> None:
        try:
            await redis.set(key, value, ex=_SUMMARY_TTL_SECONDS)
        except (RedisError, OSError) as exc:
            logger.warning("ai_summary_cache_failed", error=type(exc).__name__)

    async def _forget(self, redis: Redis, base_key: str) -> None:
        """Drop the saved summary and its translations, so the next one is fresh."""
        keys = [base_key, *(f"{base_key}:{code}" for code in LANGUAGES)]
        try:
            await redis.delete(*keys)
        except (RedisError, OSError) as exc:
            logger.warning("ai_summary_cache_failed", error=type(exc).__name__)

    async def _readable_pages(self, ids: list[uuid.UUID]) -> list[WikiPage]:
        """The listed pages the user may read - an id they cannot open is dropped."""
        if not ids:
            return []
        rows = await self.session.scalars(
            select(WikiPage).options(selectinload(WikiPage.space)).where(WikiPage.id.in_(ids))
        )
        by_id = {page.id: page for page in rows}
        permissions = PermissionService(self.session)
        return [
            by_id[i]
            for i in ids
            if i in by_id and await permissions.can_view_page(by_id[i], self.user)
        ]

    async def _creator_config(self, key: str):
        config = await load_config(self.session)
        if not config.ready:
            raise ServiceUnavailableError("The AI assistant is not enabled.")
        space = await self.spaces.get_by_key(key)
        # Only someone who could create the page may spend the model on it.
        await self.pages.require_editor(space, self.user)
        await rate_limit.enforce(f"ai:{self.user.id}", settings.ai_rate_limit)
        return config, space

    async def clarify_page(self, key: str, payload: PageDraftRequest) -> PageClarify:
        """Look the request up in the wiki, then ask what is still unclear."""
        config, space = await self._creator_config(key)
        request = "\n".join([payload.title.strip(), payload.prompt.strip()]).strip()
        related = await find_related(self.session, self.user, request, space_id=space.id)
        reply = await self._chat(
            "clarify",
            config,
            [
                {"role": "system", "content": clarify_system_prompt()},
                {
                    "role": "user",
                    "content": "\n".join(
                        ["<request>", request, "</request>", wiki_context(related, 300)]
                    ),
                },
            ],
            max_tokens=1200,
        )
        return PageClarify(
            questions=parse_questions(reply),
            related=[
                RelatedPage(
                    id=page.id,
                    title=page.title,
                    slug=page.slug,
                    space_key=page.space.key,
                    space_name=page.space.name,
                )
                for page in related
            ],
        )

    async def draft_page(self, key: str, payload: PageDraftRequest) -> PageDraft:
        """A first draft of a new page from a short description; nothing is saved."""
        config, _space = await self._creator_config(key)
        instructions = await page_draft_instructions(self.session)
        parts: list[str] = []
        if payload.title.strip():
            parts.append(f"Title: {payload.title.strip()}")
        parts += ["<request>", payload.prompt.strip(), "</request>"]
        if payload.answers:
            parts += ["<answers>", *(f"- {a.question}: {a.answer}" for a in payload.answers)]
            parts.append("</answers>")
        parts.append(wiki_context(await self._readable_pages(payload.related_ids)))
        reply = await self._chat(
            "draft",
            config,
            [
                {"role": "system", "content": page_draft_system_prompt(instructions)},
                {
                    "role": "user",
                    "content": "\n".join(part for part in parts if part),
                },
            ],
            max_tokens=4000,
        )
        title, body = split_title(reply, payload.title)
        if not body.strip():
            raise ServiceUnavailableError("The AI assistant could not write this page.")
        return PageDraft(
            title=title or payload.title.strip() or payload.prompt.strip()[:80],
            content=draft_to_html(body, payload.lang),
        )

    async def assist_writing(self, key: str, payload: AssistRequest) -> AssistResult:
        """Fix, continue, rewrite or newly write text in the editor, as a suggestion."""
        config, space = await self._creator_config(key)
        text = payload.text.strip()
        parts: list[str] = []
        if payload.action == "write":
            parts += ["<before>", payload.before.strip(), "</before>"]
            parts += ["<after>", payload.after.strip(), "</after>"]
        else:
            parts += ["<text>", text, "</text>"]
        instruction = payload.instruction.strip()
        if payload.action == "write" and payload.draft.strip():
            parts += ["<draft>", payload.draft.strip(), "</draft>"]
            instruction = f"Revise the draft between <draft> tags as follows: {instruction}"
        if payload.action in ("edit", "write"):
            parts += ["<instruction>", instruction, "</instruction>"]
        if payload.action == "complete" and payload.after.strip():
            parts += ["<after>", payload.after.strip(), "</after>"]
        if payload.action == "terms":
            related = await find_related(self.session, self.user, text, space_id=space.id)
            parts.append(wiki_context(related, 300))
        reply = await self._chat(
            "assist",
            config,
            [
                {
                    "role": "system",
                    "content": assist_system_prompt(
                        payload.action, await writing_instructions(self.session)
                    ),
                },
                {"role": "user", "content": "\n".join(part for part in parts if part)},
            ],
            max_tokens=2500 if payload.action == "write" else 1200,
        )
        result = reply.strip()
        if not result:
            raise ServiceUnavailableError("The AI assistant could not answer.")
        if payload.action == "write":
            return AssistResult(
                result=result, html=draft_to_html(result, notice=False, keep_h1=True)
            )
        return AssistResult(result=result)

    async def suggest_for_page(self, key: str, slug: str) -> PageSuggestions:
        """Labels to add and related pages, for a page the reader can open."""
        config = await load_config(self.session)
        if not config.ready:
            raise ServiceUnavailableError("The AI assistant is not enabled.")
        page = await self._visible_page(key, slug)
        mine = list(
            await self.session.scalars(
                select(UserPageLabel.name).where(UserPageLabel.user_id == self.user.id)
            )
        )
        on_page = {
            name.lower()
            for name in await self.session.scalars(
                select(UserPageLabel.name).where(
                    UserPageLabel.user_id == self.user.id, UserPageLabel.page_id == page.id
                )
            )
        }
        known = sorted(set(mine), key=str.lower)[:60]
        stamp = page.updated_at.timestamp() if page.updated_at else 0
        instructions = await suggestions_instructions(self.session)
        fingerprint = hashlib.sha256(
            "|".join([instructions, *known, "~", *sorted(on_page)]).encode()
        ).hexdigest()[:16]
        cache_key = f"ai:suggest:{page.id}:{stamp}:{self.user.id}:{fingerprint}"
        redis = get_redis()
        if cached := await self._read(redis, cache_key):
            try:
                return PageSuggestions.model_validate_json(cached).model_copy(
                    update={"cached": True}
                )
            except ValueError:
                pass
        text = page_plain_text(page.content, settings.ai_max_input_chars)
        if len(text) < 40:
            return PageSuggestions(labels=[], related=[])
        await rate_limit.enforce(f"ai:{self.user.id}", settings.ai_rate_limit)
        candidates = [
            other
            for other in await find_related(
                self.session,
                self.user,
                f"{page.title} {text[:600]}",
                space_id=page.space_id,
                limit=9,
            )
            if other.id != page.id
        ][:8]
        listing = "\n".join(
            f"{number}. {other.title} - {page_plain_text(other.content, 160)}"
            for number, other in enumerate(candidates, start=1)
        )
        parts = [
            f"<title>{page.title}</title>",
            "<page>",
            text[:4000],
            "</page>",
            "<already_has>" + ", ".join(sorted(on_page)) + "</already_has>",
            "<authors_labels>" + ", ".join(known) + "</authors_labels>",
            "<candidates>",
            listing,
            "</candidates>",
        ]
        reply = await self._chat(
            "suggest",
            config,
            [
                {"role": "system", "content": suggest_system_prompt(instructions)},
                {"role": "user", "content": "\n".join(parts)},
            ],
            max_tokens=600,
        )
        names, picked = parse_suggestions(reply, len(candidates))
        known_lower = {name.lower() for name in known}
        result = PageSuggestions(
            labels=[
                SuggestedLabel(name=name, existing=name.lower() in known_lower)
                for name in names
                if name.lower() not in on_page
            ],
            related=[
                RelatedPage(
                    id=candidates[i].id,
                    title=candidates[i].title,
                    slug=candidates[i].slug,
                    space_key=candidates[i].space.key,
                    space_name=candidates[i].space.name,
                )
                for i in picked
            ],
        )
        await self._write(redis, cache_key, result.model_dump_json())
        return result

    async def explain_selection(
        self, key: str, slug: str, payload: ExplainRequest
    ) -> ExplainResult:
        """Explain or translate words a reader selected on a page they can read."""
        config = await load_config(self.session)
        if not config.ready:
            raise ServiceUnavailableError("The AI assistant is not enabled.")
        page = await self._visible_page(key, slug)
        text = payload.text.strip()
        stamp = page.updated_at.timestamp() if page.updated_at else 0
        lang = (payload.lang or "").lower()
        instructions = await selection_instructions(self.session, payload.action)
        fingerprint = hashlib.sha256(
            "|".join([payload.action, lang, instructions, payload.context.strip(), text]).encode()
        ).hexdigest()[:24]
        cache_key = f"ai:selection:{page.id}:{stamp}:{fingerprint}"
        redis = get_redis()
        if cached := await self._read(redis, cache_key):
            return ExplainResult(result=cached, cached=True)
        await rate_limit.enforce(f"ai:{self.user.id}", settings.ai_rate_limit)
        parts = [f"<page_title>{page.title}</page_title>"]
        if payload.context.strip():
            parts += ["<surrounding>", payload.context.strip(), "</surrounding>"]
        parts += ["<selected>", text, "</selected>"]
        result = await self._chat(
            "explain",
            config,
            [
                {
                    "role": "system",
                    "content": selection_system_prompt(payload.action, lang, instructions),
                },
                {"role": "user", "content": "\n".join(parts)},
            ],
            max_tokens=800,
        )
        await self._write(redis, cache_key, result)
        return ExplainResult(result=result)

    async def summarize_page(
        self, key: str, slug: str, *, refresh: bool = False, lang: str | None = None
    ) -> PageSummary:
        """A short summary of the page; ``lang`` asks for it in another language.

        The summary is written once, in the page's own language, and saved. Asking
        for another language translates that saved summary - a few hundred
        characters in, instead of the whole page - and saves the translation too.
        Only ``refresh`` goes back to the page and writes a new summary.
        """
        config = await load_config(self.session)
        if not config.ready:
            raise ServiceUnavailableError("The AI assistant is not enabled.")
        page = await self._visible_page(key, slug)
        instructions = await summary_instructions(self.session)
        # An edit changes updated_at, and any change to the prompt (the skill or the
        # fixed rules) changes the digest, so a stale summary is never served.
        stamp = page.updated_at.timestamp() if page.updated_at else 0
        prompt = summary_system_prompt(instructions)
        digest = hashlib.sha256(prompt.encode()).hexdigest()[:10]
        base_key = f"ai:summary:{page.id}:{stamp}:{digest}"
        code = (lang or "").lower()
        code = code if code in LANGUAGES else None
        wanted_key = f"{base_key}:{code}" if code else base_key
        redis = get_redis()
        attachments = await self._attachments(page)

        def answer(summary: str, *, cached: bool = False) -> PageSummary:
            return PageSummary(summary=summary, cached=cached, attachments=attachments)

        if refresh:
            await self._forget(redis, base_key)
        elif cached := await self._read(redis, wanted_key):
            return answer(cached, cached=True)

        # Only real model calls count against the user's quota (once per request,
        # even when a request needs two); cache hits are free.
        charged = False

        async def charge() -> None:
            nonlocal charged
            if not charged:
                await rate_limit.enforce(f"ai:{self.user.id}", settings.ai_rate_limit)
                charged = True

        summary = None if refresh else await self._read(redis, base_key)
        if summary is None:
            text = page_plain_text(page.content, settings.ai_max_input_chars)
            if len(text) < 80:
                return PageSummary(
                    summary="", cached=False, too_short=True, attachments=attachments
                )
            await charge()
            summary = await self._chat(
                "summarize",
                config,
                [
                    {"role": "system", "content": prompt},
                    {
                        "role": "user",
                        "content": summary_user_message(page.title, text, attachments),
                    },
                ],
            )
            await self._write(redis, base_key, summary)

        if code is None:
            return answer(summary)

        await charge()
        translated = await self._chat(
            "translate",
            config,
            [
                {"role": "system", "content": translation_system_prompt(code)},
                {"role": "user", "content": summary},
            ],
        )
        await self._write(redis, wanted_key, translated)
        return answer(translated)
