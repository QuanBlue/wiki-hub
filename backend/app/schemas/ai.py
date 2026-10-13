"""Request and response shapes for the AI assistant."""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AIStatus(BaseModel):
    enabled: bool
    #: The viewer may open the connection settings (a system administrator).
    can_configure: bool = False


class SummaryAttachment(BaseModel):
    """A file attached to the page, so its name in the summary can open it."""

    id: uuid.UUID
    filename: str
    content_type: str


class PageSummary(BaseModel):
    summary: str
    #: Files the page embeds or links, by name, for turning names into links.
    attachments: list[SummaryAttachment] = []
    #: Served from the cache, so it cost no model call.
    cached: bool = False
    #: The page has too little text to be worth summarising.
    too_short: bool = False


class PageAnswer(BaseModel):
    """One clarifying question and what the author chose or wrote."""

    question: str = Field(min_length=1, max_length=300)
    answer: str = Field(min_length=1, max_length=500)


class PageDraftRequest(BaseModel):
    #: What the page should be about, in the author's words.
    prompt: str = Field(min_length=3, max_length=2000)
    #: The title typed so far; the model picks one when blank.
    title: str = Field(default="", max_length=255)
    #: Language code of the app, for the notice at the top of the page.
    lang: str | None = Field(default=None, max_length=8)
    #: The author's answers to the clarifying questions, if any were asked.
    answers: list[PageAnswer] = Field(default_factory=list, max_length=6)
    #: Wiki pages found for the request; re-checked for access before use.
    related_ids: list[uuid.UUID] = Field(default_factory=list, max_length=5)


class ClarifyOption(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    #: A few words under the label.
    description: str = Field(default="", max_length=120)
    #: The fuller explanation, shown on hover.
    detail: str = Field(default="", max_length=500)


class ClarifyQuestion(BaseModel):
    #: A one- or two-word tag for the question, like "Audience".
    header: str = Field(default="", max_length=24)
    question: str = Field(min_length=1, max_length=300)
    multi_select: bool = False
    options: list[ClarifyOption] = Field(min_length=2, max_length=5)


class RelatedPage(BaseModel):
    id: uuid.UUID
    title: str
    slug: str
    space_key: str
    space_name: str


class PageClarify(BaseModel):
    #: Empty when the request is clear enough to write straight away.
    questions: list[ClarifyQuestion]
    #: Pages already in the wiki that the draft will take into account.
    related: list[RelatedPage]


class PageDraft(BaseModel):
    title: str
    #: Ready-to-store page HTML, starting with the "written by AI" notice.
    content: str


class ExplainRequest(BaseModel):
    #: The words the reader selected in the page.
    text: str = Field(min_length=1, max_length=2000)
    #: The text around the selection, so a term is read in its setting.
    context: str = Field(default="", max_length=800)
    action: Literal["explain", "translate"]
    #: Language code to answer in (the app's language); English when unknown.
    lang: str | None = Field(default=None, max_length=8)


class ExplainResult(BaseModel):
    result: str
    cached: bool = False


def _clean_url(value: str) -> str:
    value = value.strip().rstrip("/")
    if value and not re.match(r"^https?://[^\s/]+", value):
        raise ValueError("The endpoint must start with http:// or https://")
    return value


class ConnectionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    base_url: str
    model: str
    #: The key with its middle hidden; the key itself is never sent back.
    api_key_preview: str
    is_active: bool
    last_checked_at: datetime | None
    #: ``None`` until the connection has been checked.
    last_check_ok: bool | None
    created_at: datetime


class ConnectionList(BaseModel):
    items: list[ConnectionRead]


class ConnectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    base_url: str = Field(min_length=1, max_length=500)
    model: str = Field(default="", max_length=255)
    api_key: str = Field(min_length=1, max_length=500)
    #: Make it the active connection straight away.
    activate: bool = False

    @field_validator("base_url")
    @classmethod
    def _url(cls, value: str) -> str:
        return _clean_url(value)

    @field_validator("name", "model")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class ConnectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    base_url: str | None = Field(default=None, min_length=1, max_length=500)
    model: str | None = Field(default=None, max_length=255)
    #: Omit to keep the saved key.
    api_key: str | None = Field(default=None, min_length=1, max_length=500)

    @field_validator("base_url")
    @classmethod
    def _url(cls, value: str | None) -> str | None:
        return None if value is None else _clean_url(value)

    @field_validator("name", "model")
    @classmethod
    def _strip(cls, value: str | None) -> str | None:
        return None if value is None else value.strip()


class SkillRead(BaseModel):
    #: The saved custom instructions; empty when the built-in ones apply.
    instructions: str
    default_instructions: str
    is_custom: bool


class SkillUpdate(BaseModel):
    #: Blank restores the built-in instructions.
    instructions: str = Field(default="", max_length=4000)


class AITestRequest(BaseModel):
    base_url: str = Field(default="", max_length=500)
    #: Blank tests with the saved key of ``connection_id``.
    api_key: str = Field(default="", max_length=500)
    connection_id: uuid.UUID | None = None


class AIModelInfo(BaseModel):
    id: str
    #: The gateway's display name; the id when it gives none.
    name: str
    #: What the gateway says the model can do, when it says.
    reasoning: bool = False
    image: bool = False


class AITestResult(BaseModel):
    ok: bool
    models: list[AIModelInfo] = []
    error: str | None = None
