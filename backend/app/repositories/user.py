"""Data access for :class:`app.models.user.User`.

Repositories own SQL only. Business rules live in the service layer.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.repositories.filters import ilike_contains


class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, user_id: uuid.UUID) -> User | None:
        return await self.session.get(User, user_id)

    async def get_by_username(self, username: str) -> User | None:
        stmt = select(User).where(func.lower(User.username) == username.strip().lower())
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_by_email(self, email: str) -> User | None:
        stmt = select(User).where(func.lower(User.email) == email.strip().lower())
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_by_identifier(self, identifier: str) -> User | None:
        """Look a user up by username or e-mail - the login form accepts both."""
        value = identifier.strip().lower()
        stmt = select(User).where(
            (func.lower(User.username) == value) | (func.lower(User.email) == value)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_protected(self) -> User | None:
        """The built-in bootstrap administrator, if it has been seeded."""
        stmt = select(User).where(User.is_protected.is_(True))
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_all(self, *, limit: int = 100, offset: int = 0) -> Sequence[User]:
        stmt = select(User).order_by(User.username).limit(limit).offset(offset)
        return (await self.session.execute(stmt)).scalars().all()

    async def count(self) -> int:
        stmt = select(func.count()).select_from(User)
        return int((await self.session.execute(stmt)).scalar_one())

    async def count_active_superusers(self) -> int:
        """How many accounts can still administer the instance.

        Used to refuse the change that would drop this to zero.
        """
        stmt = (
            select(func.count())
            .select_from(User)
            .where(User.is_active.is_(True), User.is_superuser.is_(True))
        )
        return int((await self.session.execute(stmt)).scalar_one())

    async def search(
        self,
        *,
        q: str | None = None,
        status: str | None = None,
        role: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[Sequence[User], int]:
        """Filtered page plus the filtered total.

        Both are derived from one ``stmt`` so the count can never disagree with
        the page - the classic bug where the total reports the whole table.
        """
        stmt = select(User)
        if q:
            stmt = stmt.where(
                or_(
                    ilike_contains(User.username, q),
                    ilike_contains(User.email, q),
                    ilike_contains(User.full_name, q),
                )
            )
        if status == "active":
            stmt = stmt.where(User.is_active.is_(True))
        elif status == "disabled":
            stmt = stmt.where(User.is_active.is_(False))
        if role == "admin":
            stmt = stmt.where(User.is_superuser.is_(True))
        elif role == "member":
            stmt = stmt.where(User.is_superuser.is_(False))

        total = int(
            (
                await self.session.execute(select(func.count()).select_from(stmt.subquery()))
            ).scalar_one()
        )
        page = (
            (
                await self.session.execute(
                    stmt.order_by(User.username, User.id).limit(limit).offset(offset)
                )
            )
            .scalars()
            .all()
        )
        return page, total

    def add(self, user: User) -> User:
        self.session.add(user)
        return user
