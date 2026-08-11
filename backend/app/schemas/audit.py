"""Audit log schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    actor_id: uuid.UUID | None
    actor_username: str
    #: Present when the row was produced under impersonation. The UI must show
    #: it: "alice deleted the space" is misleading if an administrator was the
    #: one holding the keyboard.
    impersonator_username: str | None = None
    action: str
    entity_type: str
    entity_id: uuid.UUID | None
    entity_label: str
    details: dict[str, Any]
    ip_address: str | None
