from __future__ import annotations

import uuid
from pydantic import BaseModel, Field, field_validator, ConfigDict


class PageLabelRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str


class PageLabelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        return value.strip()
