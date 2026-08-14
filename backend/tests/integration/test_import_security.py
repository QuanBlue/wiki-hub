"""Confluence actor handling must not create broken accounts."""

from __future__ import annotations

from typing import cast

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.modules.import_export.service import (
    INVALID_IMPORT_USERNAME,
    ConfluenceImportService,
)
from app.services.storage import ObjectStorage

pytestmark = pytest.mark.integration


async def test_invalid_confluence_actor_is_not_persisted(
    session: AsyncSession,
) -> None:
    service = ConfluenceImportService(session, cast(ObjectStorage, object()))
    invalid_username = "8a9e2ef3775bd448017765ec6a120000"

    assert await service._resolve_or_create_user(invalid_username) is None
    assert (
        await session.scalar(select(User).where(User.username == invalid_username))
    ) is None
    assert INVALID_IMPORT_USERNAME == "invalid_user"
