"""Bootstrap the instance with its protected superadmin account.

Idempotent - safe to run on every start. If the protected account already
exists, its username/e-mail/full name/password are resynced to whatever is
currently configured - only fields that actually changed are rewritten, and
nothing is touched at all when everything still matches.

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
        user, created, password_rotated, profile_changed = await service.ensure_bootstrap_admin(
            username=settings.admin_username,
            password=settings.admin_password,
            email=settings.admin_email,
            full_name=settings.admin_full_name,
        )

    if created:
        print(f"Created protected superadmin: {user.username}")
    elif password_rotated or profile_changed:
        # WIKIHUB_ADMIN_* no longer matches what is stored, so the account
        # was just resynced to match it - the intended way to change this
        # account's identity or rotate its credential is editing .env and
        # restarting, not a DB write, since it is otherwise immutable
        # through every normal path.
        changed = []
        if profile_changed:
            changed.append("username/email/full name")
        if password_rotated:
            changed.append("password")
        print(
            f"Protected superadmin updated from WIKIHUB_ADMIN_* in .env "
            f"({', '.join(changed)}): {user.username}"
        )
    else:
        print(f"Protected superadmin already exists: {user.username} (unchanged)")

    if (created or password_rotated) and settings.admin_password == "admin123":
        print(
            "WARNING: using the default password 'admin123'. Set "
            "WIKIHUB_ADMIN_PASSWORD before exposing this instance to a network.",
            file=sys.stderr,
        )

    return 0


async def _main() -> int:
    try:
        return await seed()
    finally:
        await dispose_engine()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
