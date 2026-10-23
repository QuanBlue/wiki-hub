"""Request and response shapes for the AI assistant."""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


class AssistRequest(BaseModel):
    #: fix / complete / terms work on the text; edit rewrites it as instructed;
    #: write makes new content at the caret from an instruction.
    action: Literal["fix", "complete", "terms", "edit", "write"]
    #: The selected words (fix, terms, edit) or the text before the cursor (complete).
    text: str = Field(default="", max_length=4000)
    #: What the author asked for (edit, write).
    instruction: str = Field(default="", max_length=1000)
    #: The content written so far, when the author asks for it to be changed (write).
    draft: str = Field(default="", max_length=8000)
    #: Text before and after the caret, so new content fits in (complete, write).
    before: str = Field(default="", max_length=2000)
    after: str = Field(default="", max_length=800)

    @model_validator(mode="after")
    def _needs(self) -> AssistRequest:
        if self.action in ("fix", "complete", "terms", "edit") and not self.text.strip():
            raise ValueError("There is no text to work on.")
        if self.action in ("edit", "write") and not self.instruction.strip():
            raise ValueError("Say what you want the AI to do.")
        return self


class AssistResult(BaseModel):
    result: str
    #: For "write": the same content as editor HTML, ready to insert.
    html: str | None = None


class SuggestedLabel(BaseModel):
    name: str
    #: The author already uses this label on another page.
    existing: bool = False


class PageSuggestions(BaseModel):
    labels: list[SuggestedLabel]
    related: list[RelatedPage]
    #: Served from the cache, so it cost no model call.
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


class SearchIndexStatus(BaseModel):
    #: ``False`` when the database has no pgvector, so semantic search cannot run.
    available: bool
    #: ``False`` until the active connection has an embedding model.
    enabled: bool
    #: Pages that should be searchable by meaning, and how many already are.
    total: int
    indexed: int
    #: Why indexing last stopped (refused or unreachable gateway), if it did.
    error: str | None = None
    #: An administrator paused indexing; the backlog waits until it is resumed.
    paused: bool = False
    #: Roughly how long the remaining pages will take at the recent pace; ``None``
    #: when paused, finished, or too little was indexed lately to tell.
    eta_seconds: int | None = None
    #: Files attached to pages whose words were read for search and answers, and how many
    #: are still waiting to be read.
    files_read: int = 0
    files_waiting: int = 0


class AiLimitsRead(BaseModel):
    #: What an administrator set; ``None`` means the default (from the environment) applies.
    requests_per_hour: int | None
    translate_requests_per_hour: int | None
    #: The defaults, as calls an hour.
    default_requests_per_hour: int
    default_translate_requests_per_hour: int


class AiLimitsUpdate(BaseModel):
    #: ``None`` goes back to the default.
    requests_per_hour: int | None = Field(default=None, ge=1, le=100_000)
    translate_requests_per_hour: int | None = Field(default=None, ge=1, le=100_000)


class SearchIndexPause(BaseModel):
    paused: bool


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
    #: Whether this is an embedding model (turns text into vectors) rather than
    #: a chat model - the only kind semantic search can use.
    embedding: bool = False


class AITestResult(BaseModel):
    ok: bool
    models: list[AIModelInfo] = []
    error: str | None = None


class TuningSpecRead(BaseModel):
    """One tunable knob: what it is, its default and the range the form should allow."""

    key: str
    label: str
    default: float | int | str
    minimum: float | int | None
    maximum: float | int | None
    #: ``int``, ``float`` or ``choice``.
    kind: str
    choices: list[str]
    #: Only matters for the self-hosted Ollama.
    ollama_only: bool
    #: Takes effect only after Ollama restarts.
    restart: bool


class EmbeddingSettingsRead(BaseModel):
    #: ``provider`` (the active connection), ``custom`` (another endpoint) or ``ollama``.
    source: Literal["provider", "custom", "ollama"]
    #: The other endpoint's address (used when ``source`` is ``custom``).
    base_url: str
    #: Its key with the middle hidden; never the key itself.
    api_key_preview: str
    has_key: bool
    #: Blank when semantic search is off.
    model: str
    #: What an administrator has changed; ``None`` for a knob means "the default".
    tuning: dict[str, float | int | str | None]
    #: The values actually in effect (overrides over defaults).
    effective: dict[str, float | int | str]
    specs: list[TuningSpecRead]


class EmbeddingSettingsUpdate(BaseModel):
    source: Literal["provider", "custom", "ollama"]
    base_url: str = Field(default="", max_length=500)
    #: Omit to keep the saved key.
    api_key: str | None = Field(default=None, min_length=1, max_length=500)
    #: Blank turns semantic search off.
    model: str = Field(default="", max_length=255)
    #: Knobs to change; ``null`` resets one to its default. Omit to leave all as they are.
    tuning: dict[str, float | int | str | None] | None = None

    @field_validator("base_url")
    @classmethod
    def _url(cls, value: str) -> str:
        return _clean_url(value) if value.strip() else ""

    @field_validator("model")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class EmbeddingModelsRequest(BaseModel):
    source: Literal["provider", "custom", "ollama"]
    base_url: str = Field(default="", max_length=500)
    #: Blank uses the saved key of the other endpoint.
    api_key: str = Field(default="", max_length=500)

    @field_validator("base_url")
    @classmethod
    def _url(cls, value: str) -> str:
        return _clean_url(value) if value.strip() else ""


class EmbeddingModelsResult(BaseModel):
    ok: bool
    #: Only models that can create embeddings.
    models: list[AIModelInfo] = []
    error: str | None = None


class OllamaModelChoice(BaseModel):
    name: str
    note: str


class OllamaStatus(BaseModel):
    #: ``not_installed``, ``stopped``, ``installing``, ``starting``, ``running``, ``error``,
    #: ``controller_down`` (the sidecar is not running) or ``docker_unavailable``.
    state: str
    controller_ok: bool
    docker_ok: bool
    image: str
    image_bytes: int
    memory_bytes: int | None
    #: Share of one core (100 = one full core); ``None`` when Ollama is not running.
    cpu_percent: float | None = None
    memory_limit: str
    volume_present: bool
    models: list[str]
    available_models: list[OllamaModelChoice]
    #: Cores on the machine, so the form can bound the CPU setting.
    host_cpus: int
    #: Memory, cores and keep-alive the running container was created with.
    applied_memory_mb: int | None
    applied_cpus: int | None
    applied_keep_alive: str | None
    #: The saved Ollama settings differ from what is running: it needs a restart.
    restart_needed: bool
    #: While installing: the current step (``image``, ``start``, ``ready``, ``model``).
    step: str
    #: The model being downloaded (while installing).
    model: str
    percent: int
    overall: int
    message: str
    current: int
    total: int
    error: str
    #: What happened to the last download while Ollama itself is fine (cancelled, refused).
    notice: str = ""


class OllamaEnable(BaseModel):
    #: One of the embedding models WikiHub offers (see ``OllamaStatus.available_models``).
    model: str = Field(min_length=1, max_length=100)


class EmbeddingBenchmark(BaseModel):
    ok: bool
    error: str | None = None
    #: What was measured with the saved source, model and tuning.
    passages: int = 0
    characters: int = 0
    seconds: float = 0.0
    seconds_per_passage: float = 0.0
    batch_size: int = 0
    #: A plain estimate of how long indexing the whole wiki takes at this speed.
    estimated_minutes_per_100_pages: float = 0.0


class AnswerRequest(BaseModel):
    #: The question, as typed in the search box.
    query: str = Field(min_length=2, max_length=300)

    @field_validator("query")
    @classmethod
    def _tidy(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2:
            raise ValueError("Ask a longer question.")
        return value


class HelpAskRequest(BaseModel):
    #: The question, as typed in the search box of the Help centre.
    question: str = Field(min_length=2, max_length=300)
    #: The language of the interface: the answer and the guide titles come in it.
    locale: Literal["en", "vi"] = "en"

    @field_validator("question")
    @classmethod
    def _tidy(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2:
            raise ValueError("Ask a longer question.")
        return value


class HelpGuide(BaseModel):
    #: The Help section's id: the guide opens at ``/help/<topic>#<id>``.
    id: str
    title: str
    #: Its Help category (Workspace, Writing, Attachments & Media, Account, Administration).
    category: str


class HelpAnswer(BaseModel):
    #: Whether the Help page answers the question; when not, ``answer`` is empty.
    found: bool
    #: The answer, in Markdown.
    answer: str
    #: The guides to open for more, best first.
    guides: list[HelpGuide] = []
    #: Pages of the application the answer is about, as buttons (only those the person may open).
    actions: list[AnswerAction] = []


class AnswerFile(BaseModel):
    """A file attached to the source page that the answer was read from."""

    id: uuid.UUID
    filename: str


class AnswerSource(BaseModel):
    #: The number the answer cites it by: ``[1]``.
    n: int
    id: uuid.UUID
    title: str
    slug: str
    space_key: str
    space_name: str
    #: The part of the page the answer was read from.
    excerpt: str
    #: Attached files of the page the excerpt was read from, if any.
    files: list[AnswerFile] = []


class WebSource(BaseModel):
    #: The number the answer cites it by: ``[w1]``.
    n: int
    title: str
    url: str
    host: str
    snippet: str


class FileSource(BaseModel):
    """A file attached in the chat that the answer was read from."""

    #: The number the answer cites it by: ``[f1]``.
    n: int
    filename: str
    #: The part of the file the answer was read from.
    excerpt: str


class ChatFileRead(BaseModel):
    """A file attached in the chat, read and kept for a day (only its words, never the file)."""

    id: uuid.UUID
    filename: str
    #: How many characters of text were read from it.
    chars: int


class AnswerAction(BaseModel):
    """A button under an answer that opens a page of the application."""

    id: str
    #: An address inside WikiHub (always starts with ``/``).
    href: str
    label_en: str
    label_vi: str


class AnswerPlanStep(BaseModel):
    """One thing the assistant proposes to do, shown to the person before it runs."""

    type: Literal["create_space", "create_page", "favorite_space", "add_space_member"]
    #: Checked values for the step; sent back unchanged to run it.
    args: dict[str, Any]
    label_en: str
    label_vi: str


class AnswerPlanSkip(BaseModel):
    """Something that was asked for but cannot be offered, and why."""

    label: str
    reason_en: str
    reason_vi: str


class AnswerPlan(BaseModel):
    steps: list[AnswerPlanStep]
    skipped: list[AnswerPlanSkip] = []


class ExecuteStep(BaseModel):
    type: Literal["create_space", "create_page", "favorite_space", "add_space_member"]
    args: dict[str, Any] = Field(default_factory=dict)


class ExecuteRequest(BaseModel):
    steps: list[ExecuteStep] = Field(min_length=1, max_length=6)
    lang: str | None = Field(default=None, max_length=8)


class AnswerResult(BaseModel):
    #: ``False`` when the wiki does not answer the question; the pages in ``related`` may help.
    found: bool
    #: Markdown with ``[n]`` marks, each naming one of ``sources``. When not found, empty, or the
    #: chat assistant's own words: that it found nothing, and where to look.
    answer: str = ""
    #: ``no_match`` (nothing relevant), ``not_in_pages`` (relevant pages, but no answer in
    #: them) or ``ungrounded`` (the model answered without pointing at a page).
    reason: str = ""
    #: The pages the answer cites, by their number.
    sources: list[AnswerSource] = []
    #: Other pages that were read, or that may help when there is no answer.
    related: list[AnswerSource] = []
    #: Served from a short-lived copy: no model call was made.
    cached: bool = False
    #: What the answer stands on: ``wiki`` (cited pages), ``web`` (cited internet pages, with
    #: or without wiki pages), ``general`` (the model's own knowledge, not checked against
    #: anything) or ``clarify`` (a question put back to the person, claiming nothing).
    #: ``app`` is an answer about the person's own account or about how WikiHub works.
    basis: Literal["wiki", "web", "general", "clarify", "app", "plan"] = "wiki"
    #: The internet pages the answer cites, as ``[w1]``, ``[w2]``...
    web_sources: list[WebSource] = []
    #: The files attached in the chat that the answer cites, as ``[f1]``, ``[f2]``...
    file_sources: list[FileSource] = []
    #: Buttons that open the pages the answer is about (settings, account, the user guide).
    actions: list[AnswerAction] = []
    #: Steps the assistant proposes to carry out once the person confirms (``basis`` is ``plan``).
    plan: AnswerPlan | None = None


#: How much of a conversation goes to the model: the latest turns, each kept short.
CHAT_MAX_MESSAGES = 10
#: The longest message: room for a test of twenty questions pasted whole.
CHAT_MAX_CHARS = 4000
#: An earlier turn is cut to this before it goes to the model again, so a long conversation
#: does not crowd out the pages (a small self-hosted model has little room).
CHAT_HISTORY_CHARS = 2000
#: Files the person attaches to a conversation from their computer.
CHAT_MAX_FILES = 3


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=CHAT_MAX_CHARS)

    @field_validator("content")
    @classmethod
    def _trim(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A message cannot be empty.")
        return value


class ChatRequest(BaseModel):
    #: The conversation so far, oldest first, ending with the question to answer.
    messages: list[ChatMessage] = Field(min_length=1, max_length=CHAT_MAX_MESSAGES * 2)
    #: How much the person wants in the answer: the gist, the usual, or everything relevant.
    detail: Literal["brief", "normal", "detailed"] = "normal"
    #: Ask about one file attached to a page ("Ask about this file"): the answer is read from
    #: that file alone - not the rest of the wiki, Help or the internet.
    attachment_id: uuid.UUID | None = None
    #: Files attached in the chat itself (``POST /ai/chat/files``): read together with the wiki.
    file_ids: list[uuid.UUID] = Field(default_factory=list, max_length=CHAT_MAX_FILES)

    @model_validator(mode="after")
    def _ends_with_a_question(self) -> ChatRequest:
        if self.messages[-1].role != "user":
            raise ValueError("The last message must be a question from the user.")
        return self


class WebSearchRead(BaseModel):
    enabled: bool
    provider: Literal["gateway", "tavily", "brave", "serper"]
    has_key: bool
    key_preview: str


class WebSearchUpdate(BaseModel):
    enabled: bool
    provider: Literal["gateway", "tavily", "brave", "serper"]
    #: Omit to keep the saved key; an empty string removes it.
    api_key: str | None = Field(default=None, max_length=500)


class WebSearchTestResult(BaseModel):
    ok: bool
    error: str | None = None
    results: int = 0


class QuestionPage(BaseModel):
    id: uuid.UUID
    title: str
    slug: str
    space_key: str


class QuestionAsker(BaseModel):
    id: uuid.UUID
    username: str
    name: str


class QuestionGroup(BaseModel):
    """One question the wiki did not answer, however many times and by whom it was asked."""

    #: What the entry is acted on by.
    key: str
    #: The most recent wording, and that follow-up rewritten to stand alone.
    question: str
    standalone: str | None = None
    #: Other wordings that fold to the same question.
    variants: list[str]
    count: int
    askers: list[QuestionAsker]
    first_asked_at: datetime
    last_asked_at: datetime
    #: ``no_match``, ``not_in_pages``, ``ungrounded``, ``web_failed``, ``general``, ``web``,
    #: ``disliked``.
    reasons: list[str]
    #: ``chat`` and/or ``search``.
    surfaces: list[str]
    #: Pages the search found that came close.
    near_pages: list[QuestionPage]
    #: The start of an answer marked unhelpful.
    answer_excerpt: str | None = None
    resolution: Literal["answered", "dismissed"] | None = None
    resolved_at: datetime | None = None
    answer_page: QuestionPage | None = None


class QuestionGroupList(BaseModel):
    items: list[QuestionGroup]
    #: Whether questions are being recorded.
    recording: bool
    retention_days: int


class QuestionResolve(BaseModel):
    resolution: Literal["answered", "dismissed"]
    #: The page that answers it now; whoever asked is told.
    space_key: str | None = Field(default=None, max_length=255)
    slug: str | None = Field(default=None, max_length=255)


class QuestionRecording(BaseModel):
    enabled: bool


class AnswerFeedback(BaseModel):
    """An answer the person marked unhelpful."""

    surface: Literal["chat", "search"]
    question: str = Field(min_length=1, max_length=CHAT_MAX_CHARS)
    answer: str = Field(default="", max_length=20_000)
    #: The pages the answer cited.
    page_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)
