"""Bootstrap the instance with its protected superadmin account.

Idempotent - safe to run on every start. If the protected account already
exists it is left completely untouched (in particular, its password is never
rewritten).

    python -m scripts.seed

Credentials come from the environment:

    WIKIHUB_ADMIN_USERNAME   (default: admin)
    WIKIHUB_ADMIN_PASSWORD   (default: admin123)
    WIKIHUB_ADMIN_EMAIL
    WIKIHUB_ADMIN_FULL_NAME
"""

from __future__ import annotations

import asyncio
import sys

from app.core.config import settings
from app.db.session import dispose_engine, session_scope
from app.modules.auth.service import AuthService


async def seed() -> int:
    async with session_scope() as session:
        service = AuthService(session)
        user, created = await service.ensure_bootstrap_admin(
            username=settings.admin_username,
            password=settings.admin_password,
            email=settings.admin_email,
            full_name=settings.admin_full_name,
        )

    if created:
        print(f"Created protected superadmin: {user.username}")
        if settings.admin_password == "admin123":
            print(
                "WARNING: using the default password 'admin123'. Set "
                "WIKIHUB_ADMIN_PASSWORD before exposing this instance to a network.",
                file=sys.stderr,
            )
    else:
        print(f"Protected superadmin already exists: {user.username} (unchanged)")

    return 0


async def _main() -> int:
    try:
        return await seed()
    finally:
        await dispose_engine()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
