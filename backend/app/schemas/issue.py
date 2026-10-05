"""Request and response shapes for issues."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.modules.issues.labels import ISSUE_LABELS

IssueStatusName = Literal["open", "in_progress", "done"]


class IssueCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=10_000)
    page_url: str | None = Field(default=None, max_length=500)
    labels: list[str] = Field(default_factory=list, max_length=len(ISSUE_LABELS))

    @field_validator("labels")
    @classmethod
    def _known_labels(cls, value: list[str]) -> list[str]:
        unknown = [label for label in value if label not in ISSUE_LABELS]
        if unknown:
            raise ValueError(f"Unknown label: {unknown[0]}")
        # One of each, in the order the labels are defined.
        return [label for label in ISSUE_LABELS if label in value]

    @field_validator("title")
    @classmethod
    def _strip_title(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("The title must not be blank.")
        return stripped


class IssueStatusUpdate(BaseModel):
    status: IssueStatusName
    #: Written when closing: shown to the reporter and quoted in the email.
    note: str | None = Field(default=None, max_length=2000)


class IssueAssign(BaseModel):
    #: ``None`` hands the issue back to nobody.
    assignee_id: uuid.UUID | None = None


class IssueBulkRequest(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=100)
    action: Literal["status", "assign", "unassign"]
    status: IssueStatusName | None = None
    assignee_id: uuid.UUID | None = None
    note: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _needs_its_argument(self) -> IssueBulkRequest:
        if self.action == "status" and self.status is None:
            raise ValueError("A status is required.")
        if self.action == "assign" and self.assignee_id is None:
            raise ValueError("An assignee is required.")
        return self


class IssueBulkFailure(BaseModel):
    id: uuid.UUID
    #: Why it was skipped, as an error code (e.g. ``permission_denied``).
    reason: str


class IssueBulkResult(BaseModel):
    updated: int
    failed: list[IssueBulkFailure] = []
    #: How many reporters were emailed because their issue was closed.
    emailed: int = 0


class IssueNoteCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)

    @field_validator("body")
    @classmethod
    def _strip_body(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("The note must not be blank.")
        return stripped


class IssuePerson(BaseModel):
    id: uuid.UUID
    username: str
    full_name: str


class IssueAttachmentRead(BaseModel):
    id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int
    #: Authenticated, access-checked URL of the image.
    content_url: str


class IssueNoteRead(BaseModel):
    id: uuid.UUID
    author: IssuePerson | None = None
    body: str
    #: Visible to the reporter too (the closing note); otherwise managers only.
    public: bool
    created_at: datetime


class IssueRead(BaseModel):
    id: uuid.UUID
    title: str
    description: str
    status: IssueStatusName
    page_url: str | None = None
    labels: list[str] = []
    reporter: IssuePerson
    assignee: IssuePerson | None = None
    attachments: list[IssueAttachmentRead] = []
    #: Managers see every note; the reporter sees only the public ones.
    notes: list[IssueNoteRead] = []
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None
    #: Whether the *requesting* user may claim it / change its status. Computed
    #: server-side so the client never re-derives the rule.
    can_claim: bool = False
    can_set_status: bool = False
    #: Only set on the response to closing an issue: whether the reporter was
    #: emailed (``sent``), the email failed (``failed``), or there was nobody or
    #: nothing to send (``skipped``).
    email: Literal["sent", "failed", "skipped"] | None = None


class IssueCounts(BaseModel):
    open: int = 0
    in_progress: int = 0
    done: int = 0
