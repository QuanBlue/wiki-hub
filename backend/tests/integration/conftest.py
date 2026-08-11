"""Shared fixtures for database-backed tests.

Each test gets its own throwaway PostgreSQL schema. The obvious alternative -
running against the development database's ``public`` schema - would both see
the admin account that ``scripts.seed`` already created (making "was it
created?" assertions meaningless) and write test rows into real data.

Note the schema is built with ``Base.metadata.create_all``, **not** Alembic, so
migrations are not exercised here. ``alembic upgrade head && alembic check``
stays a separate verification step.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.models.base import Base

TEST_DB_URL = os.environ.get("WIKIHUB_TEST_DATABASE_URL")


@pytest.fixture
async def session() -> AsyncIterator[AsyncSession]:
    """An ``AsyncSession`` bound to a schema created and dropped per test."""
    if not TEST_DB_URL:
        pytest.skip("WIKIHUB_TEST_DATABASE_URL is not set")

    schema = f"test_{uuid.uuid4().hex[:12]}"

    # Admin connection on the default search_path, used only to build and tear
    # down the schema itself.
    admin_engine = create_async_engine(TEST_DB_URL, poolclass=NullPool)
    try:
        async with admin_engine.begin() as conn:
            await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    except (OSError, SQLAlchemyError):
        await admin_engine.dispose()
        pytest.skip("PostgreSQL is not reachable")

    # Every connection from this engine resolves unqualified names inside the
    # throwaway schema, so create_all and the ORM both land there.
    engine = create_async_engine(
        TEST_DB_URL,
        poolclass=NullPool,
        connect_args={"server_settings": {"search_path": schema}},
    )
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
        async with factory() as s:
            yield s
            await s.rollback()
    finally:
        await engine.dispose()
        async with admin_engine.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await admin_engine.dispose()


def unique(prefix: str) -> str:
    """A name that cannot collide with the case-insensitive unique indexes."""
    return f"{prefix}{uuid.uuid4().hex[:10]}"
