"""Authentication and user-account business rules.

Everything that decides *who may do what to an account* lives here, so the API
layer stays a thin translation of HTTP to domain calls and the same rules apply
to the seed script and future admin tooling.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    AuthenticationError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
)
from app.core.logging import get_logger
from app.core.security import hash_password, needs_rehash, verify_password
from app.models.audit import AuditAction
from app.models.user import User
from app.repositories.user import UserRepository
from app.schemas.user import SelfProfileUpdate, UserCreate, UserUpdate
from app.services.audit import AuditService, ClientInfo

logger = get_logger(__name__)

#: Why the bootstrap administrator is immutable, phrased for the API consumer.
PROTECTED_ACCOUNT_MESSAGE = (
    "The built-in administrator account is protected: it cannot be modified, "
    "deactivated or deleted. This guarantees there is always a way back into "
    "the instance."
)

#: Fields worth recording in the audit trail when an account changes. An
#: explicit allowlist - `password_hash` must never appear in a diff.
#: `username` is included for `ensure_bootstrap_admin`'s sake: it is the only
#: write path in the app that can ever change it.
AUDITED_USER_FIELDS = (
    "username",
    "email",
    "full_name",
    "avatar_url",
    "bio",
    "pronouns",
    "profile_url",
    "social_links",
    "company",
    "is_active",
    "is_superuser",
)


class AuthService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        actor: User | None = None,
        client: ClientInfo | None = None,
        impersonator: User | None = None,
    ) -> None:
        self.session = session
        self.users = UserRepository(session)
        #: Who is performing the operation. Optional so the seed script and the
        #: token-verification path can build a service without one.
        self.actor = actor
        #: The administrator behind ``actor`` when this request runs under
        #: impersonation. Passed straight through to the audit trail.
        self.impersonator = impersonator
        self.audit = AuditService(session, actor=actor, client=client, impersonator=impersonator)

    # -- guards ------------------------------------------------------------
    @staticmethod
    def assert_mutable(user: User) -> None:
        """Reject any write against the protected bootstrap administrator."""
        if user.is_protected:
            raise PermissionDeniedError(PROTECTED_ACCOUNT_MESSAGE, code="account_protected")

    def assert_peer_admin_editable(self, target: User) -> None:
        """Reject a write to another Administrator account unless the actor
        is the protected super administrator.

        An ordinary Administrator (``is_superuser``, not ``is_protected``)
        can manage every Member, but not a peer Administrator - only the
        one account this instance can never lock itself out of may touch
        those, the same way only it may touch a protected account at all.
        Without this, any Administrator could silently demote, deactivate,
        delete or reset the password of any other - including one senior to
        them - since ``manage_users`` alone does not otherwise distinguish
        between the two.

        Excludes the actor's own account: editing yourself is governed by
        the self-lock guards (``_assert_not_self``/``_assert_superuser_remains``)
        instead, not this one. Also excludes a system-level call with no
        actor at all (the seed script, a token-verification path), which
        this was never meant to constrain.
        """
        if not target.is_superuser:
            return
        if self.actor is None or self.actor.id == target.id:
            return
        if self.actor.is_protected:
            return
        raise PermissionDeniedError(
            "Only the built-in super administrator can modify another "
            "administrator's account.",
            code="peer_admin_protected",
        )

    def _assert_not_self(self, target: User, *, code: str, message: str) -> None:
        """Block an action an administrator would regret performing on itself.

        409 rather than 403: the actor *does* have permission, but the end state
        they asked for would lock them out of the instance.
        """
        if self.actor is not None and self.actor.id == target.id:
            raise ConflictError(message, code=code)

    async def _assert_superuser_remains(self, target: User) -> None:
        """Refuse a change that would leave the instance with no active admin.

        The count includes the protected bootstrap account, so in a normally
        seeded instance this never fires - correctly, because that account
        genuinely is the way back in. It fires in the install where it matters:
        one where ``scripts.seed`` was never run.
        """
        if not (target.is_active and target.is_superuser):
            return  # This change cannot reduce the count.
        if await self.users.count_active_superusers() <= 1:
            raise ConflictError(
                "This is the only active administrator. Promote another account "
                "before removing this one.",
                code="last_superuser",
            )

    # -- authentication ----------------------------------------------------
    async def authenticate(self, identifier: str, password: str) -> User:
        """Verify credentials and return the user.

        Unknown accounts and invalid credentials share one generic error. Once
        credentials have been verified, an inactive account receives a clear
        recovery message so its owner knows to contact an administrator.
        """
        invalid = AuthenticationError("Incorrect username or password.")

        user = await self.users.get_by_identifier(identifier)
        if user is None:
            # Still run a hash comparison so timing does not leak existence.
            verify_password(password, None)
            raise invalid

        if not verify_password(password, user.password_hash):
            logger.info("login_failed", username=user.username, reason="bad_password")
            raise invalid

        if not user.is_active:
            logger.info("login_failed", username=user.username, reason="inactive")
            raise AuthenticationError(
                "This account has been deactivated. Contact your workspace "
                "administrator to reactivate it.",
                code="account_inactive",
            )

        # Transparently upgrade the stored hash when Argon2 parameters change.
        if user.password_hash and needs_rehash(user.password_hash):
            user.password_hash = hash_password(password)

        user.last_login_at = datetime.now(UTC)
        await self.session.flush()
        logger.info("login_succeeded", username=user.username)
        return user

    async def search_users(
        self,
        *,
        q: str | None = None,
        status: str | None = None,
        role: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[User], int]:
        """Filtered, paginated user listing. Returns ``(page, total)``."""
        users, total = await self.users.search(
            q=q, status=status, role=role, limit=limit, offset=offset
        )
        return list(users), total

    async def get_active_user(self, user_id: uuid.UUID) -> User:
        user = await self.users.get(user_id)
        if user is None or not user.is_active:
            raise AuthenticationError("Your account is no longer active.")
        return user

    # -- impersonation -----------------------------------------------------
    async def begin_impersonation(self, target_id: uuid.UUID) -> User:
        """Authorise an administrator to act as ``target_id``.

        Returns the target; minting the token is the API layer's job. Every
        refusal below is a rule that must not be relaxed casually:

        * **Superuser only.** Impersonation reads and writes everything the
          target can, so it is exactly as privileged as administration itself.
        * **Not the protected account.** That account is documented as
          unmodifiable and is the guaranteed way back into the instance;
          borrowing its identity would be a way around that promise.
        * **Not already impersonating.** A token can carry one actor, so a
          nested session would have no path back to the real human.
        * **Not yourself**, and not an inactive account - deactivation must
          actually keep someone out.
        """
        actor = self.actor
        if actor is None or not actor.is_superuser:
            raise PermissionDeniedError(
                "Impersonation requires administrator privileges.",
                code="impersonation_forbidden",
            )
        if self.impersonator is not None:
            raise ConflictError(
                "You are already viewing WikiHub as another user. Return to your own "
                "account before switching again.",
                code="impersonation_nested",
            )

        target = await self.users.get(target_id)
        if target is None:
            raise NotFoundError("User not found.")
        if target.id == actor.id:
            raise ConflictError(
                "You are already signed in as this account.", code="impersonation_self"
            )
        if target.is_protected:
            raise PermissionDeniedError(PROTECTED_ACCOUNT_MESSAGE, code="account_protected")
        if not target.is_active:
            raise ConflictError(
                f"{target.username} is deactivated. Activate the account before "
                "viewing WikiHub as this user.",
                code="user_inactive",
            )

        await self.audit.record(
            AuditAction.impersonation_started,
            entity_type="user",
            entity_id=target.id,
            entity_label=target.username,
            details={"target_is_superuser": target.is_superuser},
        )
        logger.info("impersonation_started", actor=actor.username, target=target.username)
        return target

    async def end_impersonation(self) -> User:
        """Hand the session back to the administrator behind it."""
        if self.impersonator is None:
            raise ConflictError(
                "This session is not impersonating anyone.", code="impersonation_absent"
            )

        # Re-read rather than trusting the token: an administrator whose account
        # was deactivated or deleted mid-session must not be handed a fresh
        # token for it.
        admin = await self.users.get(self.impersonator.id)
        if admin is None or not admin.is_active:
            raise AuthenticationError(
                "Your administrator account is no longer active. Please sign in again."
            )

        await self.audit.record(
            AuditAction.impersonation_stopped,
            entity_type="user",
            entity_id=self.actor.id if self.actor else None,
            entity_label=self.actor.username if self.actor else "",
        )
        logger.info("impersonation_stopped", actor=admin.username)
        return admin

    # -- account management ------------------------------------------------
    async def create_user(self, payload: UserCreate, *, is_protected: bool = False) -> User:
        if await self.users.get_by_username(payload.username):
            raise ConflictError(
                f"Username '{payload.username}' is already taken.", code="username_taken"
            )
        if await self.users.get_by_email(payload.email):
            raise ConflictError(
                f"E-mail '{payload.email}' is already registered.", code="email_taken"
            )

        user = User(
            username=payload.username.strip(),
            email=str(payload.email).strip().lower(),
            full_name=payload.full_name.strip(),
            password_hash=hash_password(payload.password),
            is_active=True,
            is_superuser=payload.is_superuser or is_protected,
            is_protected=is_protected,
        )
        self.users.add(user)
        await self.session.flush()
        logger.info("user_created", username=user.username, protected=is_protected)
        await self.audit.record(
            AuditAction.user_created,
            entity_type="user",
            entity_id=user.id,
            entity_label=user.username,
            details={"is_superuser": user.is_superuser, "protected": is_protected},
        )
        return user

    async def update_user(self, user_id: uuid.UUID, payload: UserUpdate) -> User:
        user = await self.users.get(user_id)
        if user is None:
            raise NotFoundError("User not found.")

        # The protected account is immutable even for a superuser.
        self.assert_mutable(user)
        self.assert_peer_admin_editable(user)

        data = payload.model_dump(exclude_unset=True)

        # Guard the two ways an administrator can lock themselves out, before
        # anything is mutated.
        if data.get("is_active") is False:
            self._assert_not_self(
                user,
                code="self_deactivation",
                message="You cannot deactivate your own account.",
            )
            await self._assert_superuser_remains(user)
            from app.modules.permissions.service import PermissionService

            await PermissionService(self.session).assert_user_can_be_removed(user)
        if data.get("is_superuser") is False:
            self._assert_not_self(
                user,
                code="self_demotion",
                message="You cannot remove your own administrator role.",
            )
            await self._assert_superuser_remains(user)

        before = {field: getattr(user, field, None) for field in AUDITED_USER_FIELDS}
        if "email" in data and data["email"] is not None:
            email = str(data["email"]).strip().lower()
            existing = await self.users.get_by_email(email)
            if existing and existing.id != user.id:
                raise ConflictError(f"E-mail '{email}' is already registered.", code="email_taken")
            user.email = email
        if data.get("full_name") is not None:
            user.full_name = str(data["full_name"]).strip()
        if data.get("is_active") is not None:
            user.is_active = bool(data["is_active"])
        if data.get("is_superuser") is not None:
            user.is_superuser = bool(data["is_superuser"])

        overrides = data.get("global_permission_overrides")
        if overrides:
            from app.modules.permissions.service import PermissionService

            await PermissionService(self.session).set_user_permission_overrides(user, overrides)

        await self.session.flush()

        after = {field: getattr(user, field, None) for field in AUDITED_USER_FIELDS}
        diff = AuditService.changes(before, after, AUDITED_USER_FIELDS)

        # Emit the specific intent alongside the generic update, so the log can
        # be filtered by "who was deactivated" without diffing every row.
        if "is_active" in diff:
            await self.audit.record(
                AuditAction.user_activated if user.is_active else AuditAction.user_deactivated,
                entity_type="user",
                entity_id=user.id,
                entity_label=user.username,
            )
        if "is_superuser" in diff:
            await self.audit.record(
                AuditAction.user_role_changed,
                entity_type="user",
                entity_id=user.id,
                entity_label=user.username,
                details={"is_superuser": user.is_superuser},
            )
        if overrides:
            await self.audit.record(
                AuditAction.user_permissions_changed,
                entity_type="user",
                entity_id=user.id,
                entity_label=user.username,
                details={"overrides": {str(k): v for k, v in overrides.items()}},
            )
        if diff:
            await self.audit.record(
                AuditAction.user_updated,
                entity_type="user",
                entity_id=user.id,
                entity_label=user.username,
                details={"changes": diff},
            )
        return user

    async def update_own_profile(self, user_id: uuid.UUID, payload: SelfProfileUpdate) -> User:
        """Change presentation and contact fields for the signed-in account.

        This deliberately does not call ``assert_mutable``: a protected account
        must remain impossible to disable, delete, rename or demote, but its
        owner may update profile details.
        """
        user = await self.users.get(user_id)
        if user is None:
            raise NotFoundError("User not found.")
        if self.actor is None or self.actor.id != user.id:
            raise PermissionDeniedError(
                "You can only edit your own profile.", code="profile_forbidden"
            )

        data = payload.model_dump(exclude_unset=True)
        before = {field: getattr(user, field, None) for field in AUDITED_USER_FIELDS}
        if "email" in data and data["email"] is not None:
            email = str(data["email"]).strip().lower()
            existing = await self.users.get_by_email(email)
            if existing and existing.id != user.id:
                raise ConflictError(f"E-mail '{email}' is already registered.", code="email_taken")
            user.email = email
        if "full_name" in data and data["full_name"] is not None:
            user.full_name = str(data["full_name"]).strip()
        if "avatar_url" in data:
            user.avatar_url = str(data["avatar_url"]) if data["avatar_url"] else None
        for field in ("bio", "pronouns", "profile_url", "company"):
            if field in data:
                setattr(user, field, str(data[field]).strip() if data[field] else "")
        if "social_links" in data and data["social_links"] is not None:
            user.social_links = [
                str(link).strip() for link in data["social_links"] if str(link).strip()
            ]

        await self.session.flush()
        after = {field: getattr(user, field, None) for field in AUDITED_USER_FIELDS}
        diff = AuditService.changes(before, after, AUDITED_USER_FIELDS)
        if diff:
            await self.audit.record(
                AuditAction.user_updated,
                entity_type="user",
                entity_id=user.id,
                entity_label=user.username,
                details={"changes": diff},
            )
        return user

    async def change_password(
        self, user_id: uuid.UUID, current_password: str, new_password: str
    ) -> User:
        user = await self.users.get(user_id)
        if user is None:
            raise NotFoundError("User not found.")

        # Checked before the current-password comparison so the protected
        # account gives the same answer regardless of what was submitted.
        if user.is_protected and (self.actor is None or self.actor.id != user.id):
            self.assert_mutable(user)

        if not verify_password(current_password, user.password_hash):
            raise AuthenticationError("Your current password is incorrect.")

        user.password_hash = hash_password(new_password)
        await self.session.flush()
        logger.info("password_changed", username=user.username)
        await self.audit.record(
            AuditAction.user_password_changed,
            entity_type="user",
            entity_id=user.id,
            entity_label=user.username,
        )
        return user

    async def reset_password(self, user_id: uuid.UUID, new_password: str) -> User:
        """Set a user's password without knowing the old one (administrator).

        This is the recovery path for a forgotten password, and the only way to
        give a sign-in credential to an account restored from a backup that was
        exported without credentials.

        The protected bootstrap administrator is excluded like every other write
        path - its password is fixed at creation by design.
        """
        user = await self.users.get(user_id)
        if user is None:
            raise NotFoundError("User not found.")

        self.assert_mutable(user)
        self.assert_peer_admin_editable(user)

        user.password_hash = hash_password(new_password)
        await self.session.flush()
        logger.info("password_reset", username=user.username)
        await self.audit.record(
            AuditAction.user_password_reset,
            entity_type="user",
            entity_id=user.id,
            entity_label=user.username,
            # The password itself is never recorded, here or anywhere.
            details={"self_service": bool(self.actor and self.actor.id == user.id)},
        )
        return user

    async def delete_user(self, user_id: uuid.UUID) -> None:
        user = await self.users.get(user_id)
        if user is None:
            raise NotFoundError("User not found.")

        self.assert_mutable(user)
        self.assert_peer_admin_editable(user)
        self._assert_not_self(
            user,
            code="self_deletion",
            message="You cannot delete your own account.",
        )
        await self._assert_superuser_remains(user)
        from app.modules.permissions.service import PermissionService

        await PermissionService(self.session).assert_user_can_be_removed(user)

        # Captured before the row goes away: the audit entry has to outlive it.
        username, user_uuid = user.username, user.id

        await self.session.delete(user)
        await self.session.flush()
        logger.info("user_deleted", username=username)
        await self.audit.record(
            AuditAction.user_deleted,
            entity_type="user",
            entity_id=user_uuid,
            entity_label=username,
        )

    # -- bootstrap ---------------------------------------------------------
    async def ensure_bootstrap_admin(
        self, username: str, password: str, email: str, full_name: str
    ) -> tuple[User, bool, bool, bool]:
        """Create the protected superadmin if it does not exist yet, and keep
        its whole identity in sync with .env on every restart.

        Idempotent: returns ``(user, created, password_rotated, profile_changed)``.
        An existing protected account has its username/email/full_name
        resynced to whatever ``WIKIHUB_ADMIN_*`` is currently configured, and
        its password re-hashed whenever it no longer matches. This is
        deliberate: the whole point of a *protected* account - no other write
        path in the app can rename it, change its e-mail, or touch its
        password (see ``TestProtectedAccountIsImmutable`` /
        ``TestBootstrapAdmin``) - is that its entire identity can still be
        fixed by editing .env and restarting, with no DB access needed.
        Re-seeding with unchanged values every normal restart is still a true
        no-op: nothing is rewritten, nothing is logged.

        A username or e-mail that would collide with a *different* account is
        left untouched rather than failing the whole bootstrap; a warning is
        logged so the clash is visible without ever blocking startup.
        """
        existing = await self.users.get_protected()
        if existing is not None:
            before = {field: getattr(existing, field, None) for field in AUDITED_USER_FIELDS}

            new_username = username.strip()
            if new_username and new_username.lower() != existing.username.lower():
                clash = await self.users.get_by_username(new_username)
                if clash is not None and clash.id != existing.id:
                    logger.warning(
                        "bootstrap_admin_username_clash",
                        wanted=new_username,
                        kept=existing.username,
                    )
                else:
                    existing.username = new_username

            new_email = email.strip().lower()
            if new_email and new_email != existing.email.lower():
                clash = await self.users.get_by_email(new_email)
                if clash is not None and clash.id != existing.id:
                    logger.warning(
                        "bootstrap_admin_email_clash", wanted=new_email, kept=existing.email
                    )
                else:
                    existing.email = new_email

            new_full_name = full_name.strip()
            if new_full_name and new_full_name != existing.full_name:
                existing.full_name = new_full_name

            rotated = False
            if not verify_password(password, existing.password_hash):
                existing.password_hash = hash_password(password)
                rotated = True

            after = {field: getattr(existing, field, None) for field in AUDITED_USER_FIELDS}
            diff = AuditService.changes(before, after, AUDITED_USER_FIELDS)

            if diff or rotated:
                await self.session.flush()
                logger.info(
                    "bootstrap_admin_synced",
                    username=existing.username,
                    changed_fields=sorted(diff),
                    password_rotated=rotated,
                )
                # No HTTP actor exists at seed time - AuditService already
                # falls back to "system" for that, which is exactly right
                # here: this happens because a WIKIHUB_ADMIN_* value changed,
                # not because anyone signed in and edited a profile.
                if diff:
                    await self.audit.record(
                        AuditAction.user_updated,
                        entity_type="user",
                        entity_id=existing.id,
                        entity_label=existing.username,
                        details={
                            "changes": diff,
                            "source": "bootstrap admin synced from configuration",
                        },
                    )
                if rotated:
                    await self.audit.record(
                        AuditAction.user_password_reset,
                        entity_type="user",
                        entity_id=existing.id,
                        entity_label=existing.username,
                        details={"reason": "bootstrap admin password rotated from configuration"},
                    )
            return existing, False, rotated, bool(diff)

        # A non-protected account may already own the username (e.g. an older
        # install); promote it rather than failing the whole bootstrap. Its
        # password is left alone - unlike the protected-account path above,
        # this account was not necessarily meant to be the admin credential.
        clash = await self.users.get_by_username(username)
        if clash is not None:
            clash.is_protected = True
            clash.is_superuser = True
            clash.is_active = True
            await self.session.flush()
            logger.info("bootstrap_admin_promoted", username=clash.username)
            return clash, False, False, False

        # Built directly rather than through UserCreate: the bootstrap address is
        # an internal one (``admin@wikihub.local``) and must not be subject to
        # public e-mail deliverability rules.
        user = User(
            username=username.strip(),
            email=email.strip().lower(),
            full_name=full_name.strip(),
            password_hash=hash_password(password),
            is_active=True,
            is_superuser=True,
            is_protected=True,
        )
        self.users.add(user)
        await self.session.flush()
        logger.info("bootstrap_admin_created", username=user.username)
        return user, True, False, False
