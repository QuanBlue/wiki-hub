"""Page template schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.page import MAX_PAGE_CONTENT_CHARS

TemplateScope = Literal["builtin", "global", "space"]
WritableTemplateScope = Literal["global", "space"]
TemplateLang = Literal["en", "vi"]
TemplateContentFormat = Literal["html", "markdown"]


class PageTemplateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    scope: TemplateScope
    is_builtin: bool = False
    space_id: uuid.UUID | None = None
    space_key: str | None = None
    name: str
    description: str = ""
    category: str = "general"
    icon: str = ""
    content: str = ""
    content_format: TemplateContentFormat = "html"
    created_by_username: str | None = None
    updated_by_username: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class PageTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=500)
    category: str = Field(default="general", min_length=1, max_length=64)
    icon: str = Field(default="", max_length=32)
    content: str = Field(default="", max_length=MAX_PAGE_CONTENT_CHARS)
    content_format: TemplateContentFormat = "html"


class PageTemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    category: str | None = Field(default=None, min_length=1, max_length=64)
    icon: str | None = Field(default=None, max_length=32)
    content: str | None = Field(default=None, max_length=MAX_PAGE_CONTENT_CHARS)
    content_format: TemplateContentFormat | None = None


class SavePageAsTemplateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=500)
    category: str = Field(default="general", min_length=1, max_length=64)
    icon: str = Field(default="", max_length=32)
    scope: WritableTemplateScope = "space"
