"""The People directory's column sorts, against real PostgreSQL.

Requires ``WIKIHUB_TEST_DATABASE_URL``; skipped otherwise.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.permission import Group, GroupMember
from app.models.user import User
from app.modules.auth.service import AuthService
from app.repositories.user import UserRepository
from app.schemas.user import UserCreate
from tests.integration.conftest import unique

pytestmark = pytest.mark.integration


async def _people(session: AsyncSession) -> tuple[str, list[User]]:
    """Three accounts sharing a search prefix: ``a`` signed in earliest and is
    in group "beta", ``b`` signed in later and is in "alpha", ``c`` never
    signed in and is in no group."""
    prefix = unique("sort")
    people = [
        await AuthService(session).create_user(
            UserCreate(
                username=f"{prefix}{letter}",
                email=f"{prefix}{letter}@example.org",
                full_name=letter,
                password="password-1234",
            )
        )
        for letter in ("a", "b", "c")
    ]
    a, b, _c = people
    a.last_login_at = datetime(2026, 1, 1, tzinfo=UTC)
    b.last_login_at = datetime(2026, 2, 1, tzinfo=UTC)
    b.is_superuser = True
    for user, name in ((a, "beta"), (b, "alpha")):
        group = Group(name=f"{unique(name)}", description="", owner_id=user.id)
        session.add(group)
        await session.flush()
        session.add(GroupMember(group_id=group.id, user_id=user.id))
    await session.flush()
    return prefix, people


async def _order(session: AsyncSession, prefix: str, sort: str, order: str) -> list[str]:
    users, _total = await UserRepository(session).search(q=prefix, sort=sort, order=order)
    return [user.full_name for user in users]


@pytest.mark.parametrize(
    ("sort", "order", "expected"),
    [
        # Never signed in sinks to the bottom in either direction.
        ("last_login", "desc", ["b", "a", "c"]),
        ("last_login", "asc", ["a", "b", "c"]),
        # No group sinks to the bottom too; "alpha" < "beta".
        ("groups", "asc", ["b", "a", "c"]),
        ("groups", "desc", ["a", "b", "c"]),
        ("email", "asc", ["a", "b", "c"]),
        ("username", "desc", ["c", "b", "a"]),
        # Administrators first when descending; then by username.
        ("role", "desc", ["b", "a", "c"]),
        ("status", "asc", ["a", "b", "c"]),
    ],
)
async def test_each_column_sorts_the_directory(
    session: AsyncSession, sort: str, order: str, expected: list[str]
) -> None:
    prefix, _people_list = await _people(session)

    assert await _order(session, prefix, sort, order) == expected
