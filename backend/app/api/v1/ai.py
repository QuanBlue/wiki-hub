"""AI assistant endpoints."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import CurrentSuperuser, CurrentUser, DbSession
from app.modules.ai.admin import AIConnectionService
from app.modules.ai.config import load_config
from app.modules.ai.service import AIService
from app.modules.ai.skills import AISkillService
from app.modules.permissions.service import PermissionService
from app.schemas.ai import (
    AIStatus,
    AITestRequest,
    AITestResult,
    AssistRequest,
    AssistResult,
    ConnectionCreate,
    ConnectionList,
    ConnectionRead,
    ConnectionUpdate,
    ExplainRequest,
    ExplainResult,
    PageClarify,
    PageDraft,
    PageDraftRequest,
    PageSuggestions,
    PageSummary,
    SkillRead,
    SkillUpdate,
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
