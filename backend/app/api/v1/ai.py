"""AI assistant endpoints."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from typing import Annotated, Literal

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentSuperuser, CurrentUser, DbSession
from app.core import rate_limit
from app.core.config import settings
from app.core.exceptions import BadRequestError, ServiceUnavailableError
from app.db.session import get_session_factory
from app.models.site_settings import SINGLETON_ID, SiteSettings
from app.models.user import User
from app.modules.ai import limits as ai_limits
from app.modules.ai import ollama
from app.modules.ai.actions import PlanRunner, StepInput
from app.modules.ai.admin import AIConnectionService
from app.modules.ai.answer import AnswerService
from app.modules.ai.chat import ChatService
from app.modules.ai.config import load_config
from app.modules.ai.embedding_settings import EmbeddingSettingsService
from app.modules.ai.help_answer import HelpAnswerService
from app.modules.ai.limits import ai_rate_limit
from app.modules.ai.service import AIService
from app.modules.ai.skills import AISkillService
from app.modules.ai.websearch import WebSearchSettingsService
from app.modules.attachments.text import files_read, pending_count
from app.modules.permissions.service import PermissionService
from app.modules.search.indexer import index_status, indexing_paused, set_indexing_paused
from app.schemas.ai import (
    AiLimitsRead,
    AiLimitsUpdate,
    AIStatus,
    AITestRequest,
    AITestResult,
    AnswerRequest,
    AnswerResult,
    AssistRequest,
    AssistResult,
    ChatRequest,
    ConnectionCreate,
    ConnectionList,
    ConnectionRead,
    ConnectionUpdate,
    EmbeddingBenchmark,
    EmbeddingModelsRequest,
    EmbeddingModelsResult,
    EmbeddingSettingsRead,
    EmbeddingSettingsUpdate,
    ExecuteRequest,
    ExplainRequest,
    ExplainResult,
    HelpAnswer,
    HelpAskRequest,
    OllamaEnable,
    OllamaStatus,
    PageClarify,
    PageDraft,
    PageDraftRequest,
    PageSuggestions,
    PageSummary,
    SearchIndexPause,
    SearchIndexStatus,
    SkillRead,
    SkillUpdate,
    WebSearchRead,
    WebSearchTestResult,
    WebSearchUpdate,
)

router = APIRouter(prefix="/ai", tags=["ai"])


def get_ai_service(session: DbSession, user: CurrentUser) -> AIService:
    return AIService(session, user)


AIServiceDep = Annotated[AIService, Depends(get_ai_service)]


@router.get("/status", response_model=AIStatus, summary="Whether the AI assistant is available")
async def ai_status(user: CurrentUser, session: DbSession) -> AIStatus:
    return AIStatus(
        enabled=(await load_config(session)).ready,
        can_configure=await PermissionService(session).is_system_admin(user),
    )


@router.post(
    "/answer",
    response_model=AnswerResult,
    summary="Answer a question from the wiki, citing the pages it came from",
)
async def answer_question(
    payload: AnswerRequest, session: DbSession, user: CurrentUser
) -> AnswerResult:
    # A POST body, not a query string: what people ask must not end up in access logs.
    return await AnswerService(session, user).answer(payload)


@router.post(
    "/help",
    response_model=HelpAnswer,
    summary="Answer a question about using WikiHub from the Help page, naming the guides",
)
async def answer_help(payload: HelpAskRequest, session: DbSession, user: CurrentUser) -> HelpAnswer:
    return await HelpAnswerService(session, user).answer(payload)


def _sse(event: dict) -> str:
    return f"event: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"


@router.post(
    "/chat",
    summary="Answer the latest question of a conversation from the wiki, as it is written",
    response_class=StreamingResponse,
)
async def chat(payload: ChatRequest, session: DbSession, user: CurrentUser) -> StreamingResponse:
    # The pages are found and the quota spent before the first byte, so a refusal is a plain
    # HTTP error; after that the reply is a stream of server-sent events.
    turn = await ChatService(session, user).begin(payload)

    async def stream() -> AsyncIterator[str]:
        async for event in turn.events():
            yield _sse(event)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/chat/execute",
    summary="Carry out the steps of a plan the assistant proposed, after the person confirmed",
    response_class=StreamingResponse,
)
async def execute_plan(payload: ExecuteRequest, user: CurrentUser) -> StreamingResponse:
    """Run confirmed steps as the person - with the permissions they have, and no more.

    One event per step as it finishes (writing a page takes as long as the model does), then a
    final ``done``. The steps are checked again here: what the browser sends is not trusted.
    """
    # Counted before the first byte, like a chat message, so a refusal is a plain HTTP error.
    await rate_limit.enforce(f"aiact:{user.id}", await ai_rate_limit())
    steps = [StepInput(type=step.type, args=step.args) for step in payload.steps]
    user_id = user.id
    lang = payload.lang or "en"

    async def stream() -> AsyncIterator[str]:
        # Its own session: the request's is closed by the time a stream is being written.
        async with get_session_factory()() as session:
            actor = await session.get(User, user_id)
            if actor is None:  # pragma: no cover - the person was deleted a moment ago
                return
            async for event in PlanRunner(session, actor, lang).run(steps):
                yield _sse(event)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/spaces/{key}/pages/{slug}/summary",
    response_model=PageSummary,
    summary="Summarise a page (cached until the page changes)",
)
async def summarize_page(
    key: str,
    slug: str,
    service: AIServiceDep,
    refresh: Annotated[bool, Query()] = False,
    lang: Annotated[
        str | None,
        Query(max_length=8, description="Language code to write in; omit for the page's own"),
    ] = None,
) -> PageSummary:
    return await service.summarize_page(key, slug, refresh=refresh, lang=lang)


@router.post(
    "/spaces/{key}/pages/{slug}/suggest",
    response_model=PageSuggestions,
    summary="Suggest labels and related pages for a page (cached until it changes)",
)
async def suggest_for_page(key: str, slug: str, service: AIServiceDep) -> PageSuggestions:
    return await service.suggest_for_page(key, slug)


@router.post(
    "/spaces/{key}/assist",
    response_model=AssistResult,
    summary="Fix grammar, continue a sentence or harmonise terms in text being written",
)
async def assist_writing(key: str, payload: AssistRequest, service: AIServiceDep) -> AssistResult:
    return await service.assist_writing(key, payload)


@router.post(
    "/spaces/{key}/pages/{slug}/explain",
    response_model=ExplainResult,
    summary="Explain or translate words selected in a page (cached)",
)
async def explain_selection(
    key: str, slug: str, payload: ExplainRequest, service: AIServiceDep
) -> ExplainResult:
    return await service.explain_selection(key, slug, payload)


@router.post(
    "/explain",
    response_model=ExplainResult,
    summary="Explain or translate words selected in a chat answer (cached)",
)
async def explain_text(payload: ExplainRequest, service: AIServiceDep) -> ExplainResult:
    return await service.explain_text(payload)


@router.post(
    "/spaces/{key}/pages/clarify",
    response_model=PageClarify,
    summary="Look a new page's request up in the wiki and ask what is unclear",
)
async def clarify_page(key: str, payload: PageDraftRequest, service: AIServiceDep) -> PageClarify:
    return await service.clarify_page(key, payload)


@router.post(
    "/spaces/{key}/pages/draft",
    response_model=PageDraft,
    summary="Draft a new page from a description (nothing is saved)",
)
async def draft_page(key: str, payload: PageDraftRequest, service: AIServiceDep) -> PageDraft:
    return await service.draft_page(key, payload)


def get_connection_service(session: DbSession, admin: CurrentSuperuser) -> AIConnectionService:
    return AIConnectionService(session, admin)


ConnectionServiceDep = Annotated[AIConnectionService, Depends(get_connection_service)]


@router.get(
    "/search-index",
    response_model=SearchIndexStatus,
    summary="How far semantic-search indexing has got",
)
async def search_index_status(session: DbSession, admin: CurrentSuperuser) -> SearchIndexStatus:
    config = await load_config(session)
    status_ = await index_status(session, config)
    paused = await indexing_paused(session)
    return SearchIndexStatus(
        available=status_.available,
        enabled=config.embeddings_ready,
        total=status_.total,
        indexed=status_.indexed,
        error=status_.error,
        paused=paused,
        eta_seconds=None if paused else status_.eta_seconds,
        files_read=await files_read(session),
        files_waiting=await pending_count(session),
    )


async def _limits_read(session: AsyncSession) -> AiLimitsRead:
    saved = await ai_limits.read(session)
    return AiLimitsRead(
        requests_per_hour=saved.requests_per_hour,
        translate_requests_per_hour=saved.translate_requests_per_hour,
        default_requests_per_hour=ai_limits.per_hour(settings.ai_rate_limit),
        default_translate_requests_per_hour=ai_limits.per_hour(settings.ai_translate_rate_limit),
    )


@router.get(
    "/limits",
    response_model=AiLimitsRead,
    summary="How many AI calls one person may make an hour",
)
async def get_ai_limits(session: DbSession, admin: CurrentSuperuser) -> AiLimitsRead:
    return await _limits_read(session)


@router.put(
    "/limits",
    response_model=AiLimitsRead,
    summary="Set how many AI calls one person may make an hour (empty: the default)",
)
async def put_ai_limits(
    payload: AiLimitsUpdate, session: DbSession, admin: CurrentSuperuser
) -> AiLimitsRead:
    row = await session.get(SiteSettings, SINGLETON_ID)
    if row is None:
        row = SiteSettings(id=SINGLETON_ID)
        session.add(row)
    row.ai_requests_per_hour = payload.requests_per_hour
    row.ai_translate_requests_per_hour = payload.translate_requests_per_hour
    row.updated_by_id = admin.id
    await session.commit()
    ai_limits.forget()
    return await _limits_read(session)


@router.put(
    "/search-index/pause",
    response_model=SearchIndexStatus,
    summary="Pause or resume semantic-search indexing",
)
async def pause_search_index(
    payload: SearchIndexPause, session: DbSession, admin: CurrentSuperuser
) -> SearchIndexStatus:
    """Pausing frees the server while pages wait to be embedded (a self-hosted model is
    unloaded too); resuming carries on from where indexing stopped."""
    config = await load_config(session)
    await set_indexing_paused(session, payload.paused, config.embedding_model)
    return await search_index_status(session, admin)


def get_embedding_service(session: DbSession, admin: CurrentSuperuser) -> EmbeddingSettingsService:
    return EmbeddingSettingsService(session, admin)


EmbeddingServiceDep = Annotated[EmbeddingSettingsService, Depends(get_embedding_service)]


@router.get(
    "/embedding",
    response_model=EmbeddingSettingsRead,
    summary="Where semantic search gets embeddings",
)
async def get_embedding(service: EmbeddingServiceDep) -> EmbeddingSettingsRead:
    return await service.read()


@router.put(
    "/embedding",
    response_model=EmbeddingSettingsRead,
    summary="Choose the embedding source and model (blank model turns semantic search off)",
)
async def put_embedding(
    payload: EmbeddingSettingsUpdate, service: EmbeddingServiceDep
) -> EmbeddingSettingsRead:
    return await service.update(payload)


@router.post(
    "/embedding/models",
    response_model=EmbeddingModelsResult,
    summary="List the embedding models a source offers",
)
async def embedding_models(
    payload: EmbeddingModelsRequest, service: EmbeddingServiceDep
) -> EmbeddingModelsResult:
    return await service.models(payload)


@router.post(
    "/embedding/benchmark",
    response_model=EmbeddingBenchmark,
    summary="Time a few passages with the saved embedding source, for tuning",
)
async def embedding_benchmark(service: EmbeddingServiceDep) -> EmbeddingBenchmark:
    return await service.benchmark()


async def _ollama_status(session: DbSession) -> OllamaStatus:
    return OllamaStatus(**await ollama.describe((await load_config(session)).tuning))


@router.get("/ollama", response_model=OllamaStatus, summary="State of the self-hosted Ollama")
async def ollama_status(admin: CurrentSuperuser, session: DbSession) -> OllamaStatus:
    return await _ollama_status(session)


@router.post(
    "/ollama/enable",
    response_model=OllamaStatus,
    summary="Install (if needed), start Ollama and download an embedding model",
)
async def ollama_enable(
    payload: OllamaEnable, admin: CurrentSuperuser, session: DbSession
) -> OllamaStatus:
    if payload.model not in ollama.ALLOWED_MODELS:
        raise BadRequestError("Pick one of the embedding models WikiHub offers.")
    try:
        pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        await pool.enqueue_job("install_ollama", payload.model)
        await pool.aclose()
    except Exception as exc:
        raise ServiceUnavailableError(
            "The background worker queue is unavailable; Ollama was not started."
        ) from exc
    # Show "installing" at once instead of waiting for the worker to pick the job up.
    await ollama.write_progress(
        ollama.Progress(state="installing", step="image", message="Starting", model=payload.model)
    )
    return await _ollama_status(session)


@router.post("/ollama/cancel", response_model=OllamaStatus, summary="Cancel an install in progress")
async def ollama_cancel(admin: CurrentSuperuser, session: DbSession) -> OllamaStatus:
    await ollama.request_cancel()
    return await _ollama_status(session)


@router.post(
    "/ollama/disable",
    response_model=OllamaStatus,
    summary="Stop and remove the Ollama container (downloaded models stay on disk)",
)
async def ollama_disable(admin: CurrentSuperuser, session: DbSession) -> OllamaStatus:
    try:
        await ollama.disable()
    except ollama.OllamaError as exc:
        raise ServiceUnavailableError(str(exc)) from exc
    return await _ollama_status(session)


@router.delete(
    "/ollama/models",
    response_model=OllamaStatus,
    summary="Delete the downloaded models (Ollama must be disabled)",
)
async def ollama_delete_models(admin: CurrentSuperuser, session: DbSession) -> OllamaStatus:
    try:
        await ollama.delete_models()
    except ollama.OllamaError as exc:
        raise BadRequestError(str(exc)) from exc
    return await _ollama_status(session)


@router.get("/connections", response_model=ConnectionList, summary="List AI connections")
async def list_connections(service: ConnectionServiceDep) -> ConnectionList:
    return await service.list()


@router.post(
    "/connections",
    response_model=ConnectionRead,
    status_code=status.HTTP_201_CREATED,
    summary="Add an AI connection",
)
async def create_connection(
    payload: ConnectionCreate, service: ConnectionServiceDep
) -> ConnectionRead:
    return await service.create(payload)


@router.post("/connections/test", response_model=AITestResult, summary="Test an address and key")
async def test_connection(payload: AITestRequest, service: ConnectionServiceDep) -> AITestResult:
    return await service.test(payload)


@router.patch("/connections/{connection_id}", response_model=ConnectionRead, summary="Edit")
async def update_connection(
    connection_id: uuid.UUID, payload: ConnectionUpdate, service: ConnectionServiceDep
) -> ConnectionRead:
    return await service.update(connection_id, payload)


@router.post(
    "/connections/{connection_id}/activate",
    response_model=ConnectionRead,
    summary="Make this the one active connection",
)
async def activate_connection(
    connection_id: uuid.UUID, service: ConnectionServiceDep
) -> ConnectionRead:
    return await service.activate(connection_id)


@router.post(
    "/connections/{connection_id}/deactivate",
    response_model=ConnectionRead,
    summary="Switch the connection off",
)
async def deactivate_connection(
    connection_id: uuid.UUID, service: ConnectionServiceDep
) -> ConnectionRead:
    return await service.deactivate(connection_id)


@router.post(
    "/connections/{connection_id}/check",
    response_model=AITestResult,
    summary="Check a saved connection now",
)
async def check_connection(connection_id: uuid.UUID, service: ConnectionServiceDep) -> AITestResult:
    return await service.check(connection_id)


@router.delete(
    "/connections/{connection_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a connection",
)
async def delete_connection(connection_id: uuid.UUID, service: ConnectionServiceDep) -> Response:
    await service.delete(connection_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def get_skill_service(session: DbSession, admin: CurrentSuperuser) -> AISkillService:
    return AISkillService(session, admin)


SkillServiceDep = Annotated[AISkillService, Depends(get_skill_service)]


SkillName = Literal[
    "summary", "page-draft", "selection-explain", "selection-translate", "writing", "suggestions"
]


@router.get("/skills/{name}", response_model=SkillRead, summary="Read a skill")
async def read_skill(name: SkillName, service: SkillServiceDep) -> SkillRead:
    return await service.read(name)


@router.put("/skills/{name}", response_model=SkillRead, summary="Customise a skill")
async def save_skill(name: SkillName, payload: SkillUpdate, service: SkillServiceDep) -> SkillRead:
    return await service.save(name, payload.instructions)


@router.get(
    "/web-search",
    response_model=WebSearchRead,
    summary="Whether the chat may look things up on the internet",
)
async def get_web_search(session: DbSession, user: CurrentSuperuser) -> WebSearchRead:
    return await WebSearchSettingsService(session, user).get()


@router.put(
    "/web-search",
    response_model=WebSearchRead,
    summary="Turn internet look-ups for the chat on or off, and set the search service",
)
async def put_web_search(
    payload: WebSearchUpdate, session: DbSession, user: CurrentSuperuser
) -> WebSearchRead:
    return await WebSearchSettingsService(session, user).put(payload)


@router.post(
    "/web-search/test",
    response_model=WebSearchTestResult,
    summary="Try a search with the key being entered (or the saved one)",
)
async def test_web_search(
    payload: WebSearchUpdate, session: DbSession, user: CurrentSuperuser
) -> WebSearchTestResult:
    return await WebSearchSettingsService(session, user).test(payload)
