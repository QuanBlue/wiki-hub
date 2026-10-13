"""What the AI looks at before it writes a page: related wiki pages, and the
clarifying questions it asks about the author's request."""

from __future__ import annotations

import json
import re
import uuid

from pydantic import ValidationError
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.page import WikiPage
from app.models.space import Space, SpaceStatus
from app.models.user import User
from app.modules.ai.text import page_plain_text as plain_text
from app.modules.permissions.service import PermissionService
from app.repositories.filters import ilike_contains
from app.schemas.ai import ClarifyQuestion

#: Words too common to say what a request is about.
_STOP_WORDS = frozenset(
    [
        "the",
        "and",
        "for",
        "with",
        "that",
        "this",
        "from",
        "are",
        "was",
        "how",
        "what",
        "when",
        "where",
        "which",
        "about",
        "into",
        "your",
        "you",
        "page",
        "pages",
        "wiki",
        "write",
        "create",
        "make",
        "new",
        "guide",
        "cho",
        "các",
        "của",
        "và",
        "với",
        "một",
        "những",
        "được",
        "trong",
        "khi",
        "này",
        "đó",
        "để",
        "hướng",
        "dẫn",
        "viết",
        "tạo",
        "trang",
        "bài",
    ]
)

MAX_QUESTIONS = 4


def keywords(text: str, limit: int = 5) -> list[str]:
    """The few distinctive words of a request, longest first."""
    seen: dict[str, None] = {}
    for word in re.findall(r"[\w][\w+#.-]{2,}", text.lower()):
        word = word.strip(".-")
        if len(word) >= 3 and word not in _STOP_WORDS:
            seen.setdefault(word, None)
    return sorted(seen, key=len, reverse=True)[:limit]


async def find_related(
    session: AsyncSession,
    user: User,
    text: str,
    *,
    space_id: uuid.UUID | None = None,
    limit: int = 5,
) -> list[WikiPage]:
    """Pages the user can read that mention the request's key words, best first."""
    terms = keywords(text)
    if not terms:
        return []
    rows = await session.scalars(
        select(WikiPage)
        .options(selectinload(WikiPage.space))
        .join(Space, WikiPage.space_id == Space.id)
        .where(
            Space.status == SpaceStatus.active,
            or_(
                *(ilike_contains(WikiPage.title, term) for term in terms),
                *(ilike_contains(WikiPage.content, term) for term in terms),
            ),
        )
        .order_by(WikiPage.updated_at.desc())
        .limit(40)
    )
    scored: list[tuple[int, WikiPage]] = []
    for page in rows:
        title = page.title.lower()
        body = plain_text(page.content, 20000).lower()
        score = sum(3 * (term in title) + (term in body) for term in terms)
        if page.space_id == space_id:
            score += 1
        if score:
            scored.append((score, page))
    scored.sort(key=lambda item: item[0], reverse=True)
    permissions = PermissionService(session)
    visible: list[WikiPage] = []
    for _score, page in scored:
        if await permissions.can_view_page(page, user):
            visible.append(page)
        if len(visible) == limit:
            break
    return visible


def wiki_context(pages: list[WikiPage], excerpt: int = 500) -> str:
    """The related pages as reference text, for the model."""
    if not pages:
        return ""
    blocks = [
        f"<page title={json.dumps(page.title, ensure_ascii=False)}>\n"
        f"{plain_text(page.content, excerpt)}\n</page>"
        for page in pages
    ]
    return "<wiki>\n" + "\n".join(blocks) + "\n</wiki>"


def parse_questions(reply: str) -> list[ClarifyQuestion]:
    """The model's JSON, or nothing when it did not give usable JSON."""
    found = re.search(r"\{.*\}", reply, flags=re.S)
    if not found:
        return []
    try:
        data = json.loads(found.group(0))
        raw = data.get("questions", []) if isinstance(data, dict) else []
    except (ValueError, AttributeError):
        return []
    questions: list[ClarifyQuestion] = []
    for item in raw if isinstance(raw, list) else []:
        try:
            question = ClarifyQuestion.model_validate(item)
        except ValidationError:
            continue
        if len(question.options) >= 2:
            questions.append(question)
        if len(questions) == MAX_QUESTIONS:
            break
    return questions
