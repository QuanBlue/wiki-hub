"""Answering a question from the Help page, for the search box of the Help centre.

The search box lists the guides whose titles and keywords match as someone types; asked a whole
question, it also has the AI assistant answer it from what the Help page itself says (the same
passages the chat assistant reads, see ``help_knowledge.py``) and names the guides to open. It
never answers from the wiki's pages or the web: this is the manual of the application.
"""

from __future__ import annotations

import re

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import rate_limit
from app.core.exceptions import ServiceUnavailableError
from app.models.user import User
from app.modules.ai.assistant_context import actions_for, match_topics, viewer_of
from app.modules.ai.client import chat_with_usage
from app.modules.ai.config import load_config
from app.modules.ai.help_knowledge import help_block, section_titles
from app.modules.ai.help_knowledge import search as search_help
from app.modules.ai.limits import ai_rate_limit
from app.modules.permissions.service import PermissionService
from app.modules.stats.recorder import record_ai_usage
from app.schemas.ai import AnswerAction, HelpAnswer, HelpAskRequest, HelpGuide

#: Guides named under an answer: enough to choose from, few enough to read.
MAX_GUIDES = 4
_PASSAGES = 6
_TOKENS = 700
NOT_FOUND = "NOT_FOUND"

SYSTEM = f"""You are the help desk of WikiHub, a team wiki. Answer the person's question about
using WikiHub from the <help> passages only - they are WikiHub's own user guide.

- Answer in {{language}}, short and practical: one sentence that answers, then numbered steps
  when there is something to do (where to click, in order, with the exact names of buttons and
  menus in **bold**). At most about 120 words.
- Use only what the passages say. Do not invent menus, settings or features. If a passage says
  only administrators can do it, say so.
- The passages may be in another language than the question: that does not matter, answer from
  them all the same.
- Do not mention "passages", "sections" or the help text itself; do not add links.
- When a passage is about the question even in part, answer from it. Only when none of them has
  anything to do with the question, reply with exactly {NOT_FOUND} and nothing else."""

_LANGUAGES = {"en": "English", "vi": "Vietnamese"}
# Letters only Vietnamese has: a question written with them is answered in Vietnamese.
_VIETNAMESE = re.compile("[ăđơưạảãằắặẳẵầấậẩẫẹẻẽềếệểễỉĩịọỏõồốộổỗờớợởỡụủũừứựửữỳỵỷỹ]", re.IGNORECASE)


def answer_language(question: str, locale: str) -> str:
    """The language to answer in: the question's own, else the interface's."""
    return "Vietnamese" if _VIETNAMESE.search(question) else _LANGUAGES[locale]


class HelpAnswerService:
    def __init__(self, session: AsyncSession, user: User) -> None:
        self.session = session
        self.user = user

    def guides_for(self, question: str, locale: str) -> list[HelpGuide]:
        """The guides that best match the question, in the reader's language, best first."""
        titles = section_titles(locale) or section_titles("en")
        guides: list[HelpGuide] = []
        for passage in search_help(question, limit=_PASSAGES * 2):
            if passage.section_id in {g.id for g in guides}:
                continue
            title, category = titles.get(passage.section_id, (passage.title, passage.category))
            guides.append(HelpGuide(id=passage.section_id, title=title, category=category))
            if len(guides) >= MAX_GUIDES:
                break
        return guides

    async def actions_for(self, question: str) -> list[AnswerAction]:
        """Buttons to the pages of the application the question is about, that this person may
        open; the Help pages themselves are already offered as guides."""
        viewer = await viewer_of(self.session, self.user)
        return [
            action
            for action in actions_for(match_topics(question, viewer), viewer)
            if not action.href.startswith("/help")
        ]

    async def answer(self, payload: HelpAskRequest) -> HelpAnswer:
        config = await load_config(self.session)
        if not config.ready:
            raise ServiceUnavailableError("The AI assistant is not enabled.")
        passages = search_help(payload.question, limit=_PASSAGES)
        guides = self.guides_for(payload.question, payload.locale)
        actions = await self.actions_for(payload.question)
        if not passages:
            # Nothing in the manual is about this: no model call, just say so.
            return HelpAnswer(found=False, answer="", guides=guides, actions=actions)
        await rate_limit.enforce(f"ai:{self.user.id}", await ai_rate_limit())
        is_admin = await PermissionService(self.session).is_system_admin(self.user)
        reply = await chat_with_usage(
            config,
            [
                {
                    "role": "system",
                    "content": SYSTEM.replace(
                        "{language}", answer_language(payload.question, payload.locale)
                    ),
                },
                {
                    "role": "user",
                    "content": "\n".join(
                        [
                            "<question>",
                            payload.question,
                            "</question>",
                            help_block(passages, is_admin=is_admin),
                        ]
                    ),
                },
            ],
            max_tokens=_TOKENS,
            temperature=0.0,
        )
        if reply.usage is not None:
            await record_ai_usage(
                user_id=self.user.id,
                feature="help_answer",
                model=config.model,
                prompt_tokens=reply.usage.prompt_tokens,
                completion_tokens=reply.usage.completion_tokens,
            )
        text = reply.text.strip()
        if not text or NOT_FOUND in text:
            return HelpAnswer(found=False, answer="", guides=guides, actions=actions)
        return HelpAnswer(found=True, answer=text, guides=guides, actions=actions)
