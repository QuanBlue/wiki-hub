"""Comprehensive unit tests for TOTP 2FA, recovery codes, enforcement, and backup."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import jwt
import pytest
from fastapi import Response

from app.api.v1 import auth as auth_api
from app.api.v1 import users as users_api
from app.core.config import settings
from app.core.exceptions import (
    AuthenticationError,
    BadRequestError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
)
from app.core.security import (
    TOKEN_TYPE_2FA_CHALLENGE,
    TOKEN_TYPE_2FA_SETUP,
    create_2fa_token,
    create_access_token,
    decode_2fa_token,
    decode_token_identity,
    hash_password,
)
from app.models.audit import AuditAction
from app.models.site_settings import SINGLETON_ID, SiteSettings
from app.models.user import User
from app.modules.auth.service import AuthService
from app.modules.auth.totp import (
    RECOVERY_CODE_COUNT,
    build_otpauth_uri,
    decrypt_totp_secret,
    encrypt_totp_secret,
    generate_recovery_codes,
    generate_totp_code,
    generate_totp_secret,
    hash_recovery_code,
    hash_recovery_codes,
    is_2fa_enforced_for,
    verify_and_consume_recovery_code,
    verify_totp_code,
)
from app.modules.backup import exporter as backup_exporter
from app.modules.backup import importer as backup_importer
from app.schemas.backup import BackupDocument, BackupMeta, BackupUser
from app.schemas.site_settings import EffectiveSettings, SiteSettingsUpdate
from app.schemas.user import (
    ImpersonateRequest,
    LoginRequest,
    TwoFactorConfirmRequest,
    TwoFactorDisableRequest,
    TwoFactorRegenerateCodesRequest,
    TwoFactorSetupRequest,
    TwoFactorVerifyRequest,
)
from app.services.audit import ClientInfo
from app.services.site_settings import SiteSettingsService


def _make_user(
    *,
    username: str = "alice",
    email: str = "alice@example.com",
    password: str = "Secret123!",
    is_superuser: bool = False,
    is_protected: bool = False,
    is_active: bool = True,
    totp_enabled: bool = False,
    totp_secret_encrypted: str | None = None,
    totp_pending_secret_encrypted: str | None = None,
    totp_enabled_at: datetime | None = None,
    totp_recovery_codes: list[str] | None = None,
) -> User:
    now = datetime.now(UTC)
    return User(
        id=uuid.uuid4(),
        username=username,
        email=email,
        full_name="Alice Example",
        password_hash=hash_password(password),
        bio="",
        pronouns="",
        profile_url="",
        social_links=[],
        company="",
        status_emoji="",
        status_text="",
        welcome_effect="",
        welcome_message="",
        is_active=is_active,
        is_superuser=is_superuser,
        is_protected=is_protected,
        receive_admin_emails=False,
        totp_enabled=totp_enabled,
        totp_secret_encrypted=totp_secret_encrypted,
        totp_pending_secret_encrypted=totp_pending_secret_encrypted,
        totp_enabled_at=totp_enabled_at,
        totp_recovery_codes=list(totp_recovery_codes or []),
        created_at=now,
        updated_at=now,
    )


def _mock_request(host: str = "127.0.0.1") -> MagicMock:
    req = MagicMock()
    req.client = SimpleNamespace(host=host)
    req.cookies = {}
    return req


class TestTotpPrimitives:
    def test_rfc6238_sha1_vectors(self) -> None:
        # RFC 6238 Appendix B SHA-1 test secret: ASCII "12345678901234567890"
        secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
        assert generate_totp_code(secret, now=59) == "287082"
        assert generate_totp_code(secret, now=1111111109) == "081804"
        assert generate_totp_code(secret, now=datetime.fromtimestamp(59, tz=UTC)) == "287082"

    def test_generate_secret_and_current_code(self) -> None:
        secret = generate_totp_secret()
        assert len(secret) == 32
        code = generate_totp_code(secret)
        assert len(code) == 6 and code.isdigit()
        assert verify_totp_code(secret, code) is True
        # Whitespace and hyphens are tolerated
        assert verify_totp_code(secret, f"{code[:3]}-{code[3:]}") is True
        assert verify_totp_code(secret, f" {code[:3]} {code[3:]} ") is True

    def test_generate_code_rejects_invalid_secret(self) -> None:
        with pytest.raises(ValueError, match="Invalid base32"):
            generate_totp_code("not-valid-base32!!!")
        with pytest.raises(ValueError, match="Invalid base32"):
            generate_totp_code("   ")

    def test_verify_window_and_edge_cases(self) -> None:
        secret = generate_totp_secret()
        base_ts = 1_700_000_010.0
        code_prev = generate_totp_code(secret, now=base_ts - 30)
        code_curr = generate_totp_code(secret, now=base_ts)
        code_next = generate_totp_code(secret, now=base_ts + 30)
        code_old = generate_totp_code(secret, now=base_ts - 60)
        code_future = generate_totp_code(secret, now=base_ts + 60)

        assert verify_totp_code(secret, code_prev, now=base_ts) is True
        assert verify_totp_code(secret, code_curr, now=base_ts) is True
        assert verify_totp_code(secret, code_next, now=base_ts) is True
        assert verify_totp_code(secret, code_old, now=base_ts) is False
        assert verify_totp_code(secret, code_future, now=base_ts) is False

        # Counter 0 skips negative step cleanly
        code_zero = generate_totp_code(secret, now=0)
        assert verify_totp_code(secret, code_zero, now=0) is True

        # Malformed codes and secrets
        assert verify_totp_code(secret, "12345") is False
        assert verify_totp_code(secret, "abcdef") is False
        assert verify_totp_code("!!!", code_curr, now=base_ts) is False

    def test_build_otpauth_uri(self) -> None:
        uri = build_otpauth_uri("JBSWY3DPEHPK3PXP", "alice@example.com", "WikiHub Corp")
        assert uri.startswith("otpauth://totp/WikiHub%20Corp:alice%40example.com?")
        assert "secret=JBSWY3DPEHPK3PXP" in uri
        assert "issuer=WikiHub%20Corp" in uri
        assert "algorithm=SHA1" in uri
        assert "digits=6" in uri
        assert "period=30" in uri

    def test_recovery_codes_generate_hash_and_consume(self) -> None:
        codes = generate_recovery_codes()
        assert len(codes) == RECOVERY_CODE_COUNT
        assert all(len(c) == 9 and c[4] == "-" for c in codes)

        hashes = hash_recovery_codes(codes)
        assert len(hashes) == RECOVERY_CODE_COUNT
        assert hashes[0] == hash_recovery_code(codes[0].lower().replace("-", ""))

        matched, remaining = verify_and_consume_recovery_code(
            codes[3].lower().replace("-", " "), hashes
        )
        assert matched is True
        assert len(remaining) == RECOVERY_CODE_COUNT - 1

        # Same code cannot be reused
        matched_again, still_remaining = verify_and_consume_recovery_code(codes[3], remaining)
        assert matched_again is False
        assert still_remaining == remaining

        # Empty code or empty stored list
        assert verify_and_consume_recovery_code("", hashes) == (False, hashes)
        assert verify_and_consume_recovery_code(codes[0], []) == (False, [])

    def test_encrypt_decrypt_secret_round_trip(self) -> None:
        secret = generate_totp_secret()
        encrypted = encrypt_totp_secret(secret)
        assert encrypted != secret
        assert decrypt_totp_secret(encrypted) == secret

    def test_is_2fa_enforced_for_policy(self) -> None:
        member = _make_user(is_superuser=False, is_protected=False)
        admin = _make_user(is_superuser=True, is_protected=False)
        protected = _make_user(is_superuser=True, is_protected=True)

        assert is_2fa_enforced_for(member, "off") is False
        assert is_2fa_enforced_for(admin, "off") is False
        assert is_2fa_enforced_for(protected, "off") is False

        assert is_2fa_enforced_for(member, "admins") is False
        assert is_2fa_enforced_for(member, "admins", is_admin=True) is True
        assert is_2fa_enforced_for(admin, "admins") is True
        assert is_2fa_enforced_for(protected, "admins") is False

        assert is_2fa_enforced_for(member, "all") is True
        assert is_2fa_enforced_for(admin, "all") is True
        assert is_2fa_enforced_for(protected, "all") is False


class TestTwoFactorTokens:
    def test_challenge_and_setup_tokens_round_trip_and_disjoint(self) -> None:
        uid = uuid.uuid4()
        challenge, _ = create_2fa_token(str(uid), token_type=TOKEN_TYPE_2FA_CHALLENGE, expires_in=300)
        setup, _ = create_2fa_token(str(uid), token_type=TOKEN_TYPE_2FA_SETUP, expires_in=600)

        assert decode_2fa_token(challenge, expected_type=TOKEN_TYPE_2FA_CHALLENGE) == uid
        assert decode_2fa_token(setup, expected_type=TOKEN_TYPE_2FA_SETUP) == uid

        # Wrong 2FA token type is rejected
        with pytest.raises(AuthenticationError) as exc_wrong:
            decode_2fa_token(challenge, expected_type=TOKEN_TYPE_2FA_SETUP)
        assert exc_wrong.value.code == "2fa_token_invalid"

        # 2FA tokens can never be used as access tokens
        with pytest.raises(AuthenticationError):
            decode_token_identity(challenge)
        with pytest.raises(AuthenticationError):
            decode_token_identity(setup)

        # Access token cannot be used as 2FA token
        access, _ = create_access_token(str(uid))
        with pytest.raises(AuthenticationError):
            decode_2fa_token(access, expected_type=TOKEN_TYPE_2FA_CHALLENGE)

    def test_expired_and_malformed_2fa_tokens(self) -> None:
        uid = uuid.uuid4()
        expired, _ = create_2fa_token(str(uid), token_type=TOKEN_TYPE_2FA_CHALLENGE, expires_in=-10)
        with pytest.raises(AuthenticationError) as exc_exp:
            decode_2fa_token(expired, expected_type=TOKEN_TYPE_2FA_CHALLENGE)
        assert exc_exp.value.code == "2fa_challenge_expired"

        with pytest.raises(AuthenticationError) as exc_bad:
            decode_2fa_token("not-a-jwt", expected_type=TOKEN_TYPE_2FA_CHALLENGE)
        assert exc_bad.value.code == "2fa_token_invalid"

        bad_sub = jwt.encode(
            {
                "sub": "not-a-uuid",
                "type": TOKEN_TYPE_2FA_CHALLENGE,
                "exp": int((datetime.now(UTC) + timedelta(minutes=5)).timestamp()),
            },
            settings.secret_key,
            algorithm=settings.jwt_algorithm,
        )
        with pytest.raises(AuthenticationError) as exc_sub:
            decode_2fa_token(bad_sub, expected_type=TOKEN_TYPE_2FA_CHALLENGE)
        assert exc_sub.value.code == "2fa_token_invalid"


class TestAuthServiceTwoFactor:
    def _service(self, actor: User | None = None) -> tuple[AuthService, AsyncMock]:
        session = AsyncMock()
        svc = AuthService(session, actor=actor)
        svc.users = AsyncMock()
        svc.audit = AsyncMock()
        return svc, session

    async def test_begin_and_confirm_2fa_setup(self) -> None:
        user = _make_user()
        svc, _ = self._service(actor=user)

        # Confirm before setup fails
        with pytest.raises(BadRequestError) as exc_no_setup:
            await svc.confirm_2fa_setup(user, "123456")
        assert exc_no_setup.value.code == "2fa_setup_not_started"

        secret, uri = await svc.begin_2fa_setup(user, issuer="WikiHub")
        assert user.totp_pending_secret_encrypted is not None
        assert secret in uri

        # Wrong code fails
        with pytest.raises(AuthenticationError) as exc_wrong:
            await svc.confirm_2fa_setup(user, "000000")
        assert exc_wrong.value.code == "2fa_invalid_code"

        # Unreadable pending secret fails
        saved_pending = user.totp_pending_secret_encrypted
        user.totp_pending_secret_encrypted = "bad-prefix:junk"
        with pytest.raises(BadRequestError) as exc_unread:
            await svc.confirm_2fa_setup(user, generate_totp_code(secret))
        assert exc_unread.value.code == "2fa_setup_unreadable"
        user.totp_pending_secret_encrypted = saved_pending

        # Valid code enables 2FA and returns 10 recovery codes
        codes = await svc.confirm_2fa_setup(user, generate_totp_code(secret))
        assert len(codes) == 10
        assert user.totp_enabled is True
        assert user.totp_enabled_at is not None
        assert user.totp_pending_secret_encrypted is None
        assert user.totp_secret_encrypted is not None
        assert len(user.totp_recovery_codes) == 10
        svc.audit.record.assert_awaited_once()
        assert svc.audit.record.call_args.args[0] == AuditAction.two_factor_enabled

        # Starting or confirming again raises ConflictError
        with pytest.raises(ConflictError) as exc_again:
            await svc.begin_2fa_setup(user, issuer="WikiHub")
        assert exc_again.value.code == "2fa_already_enabled"
        with pytest.raises(ConflictError) as exc_confirm_again:
            await svc.confirm_2fa_setup(user, generate_totp_code(secret))
        assert exc_confirm_again.value.code == "2fa_already_enabled"

    async def test_verify_2fa_login_totp_and_recovery_code(self) -> None:
        secret = generate_totp_secret()
        codes = generate_recovery_codes()
        user = _make_user(
            totp_enabled=True,
            totp_secret_encrypted=encrypt_totp_secret(secret),
            totp_recovery_codes=hash_recovery_codes(codes),
        )
        svc, _ = self._service(actor=user)

        # Valid TOTP code
        await svc.verify_2fa_login(user, generate_totp_code(secret))

        # Valid recovery code consumes it and logs audit
        await svc.verify_2fa_login(user, codes[0])
        assert len(user.totp_recovery_codes) == 9
        assert svc.audit.record.call_args.args[0] == AuditAction.two_factor_recovery_used

        # Reusing consumed recovery code fails
        with pytest.raises(AuthenticationError) as exc_reused:
            await svc.verify_2fa_login(user, codes[0])
        assert exc_reused.value.code == "2fa_invalid_code"

        # Unreadable secret fails
        user.totp_secret_encrypted = "bad:secret"
        with pytest.raises(AuthenticationError) as exc_unread:
            await svc.verify_2fa_login(user, "123456")
        assert exc_unread.value.code == "2fa_secret_unreadable"

        # Disabled user fails
        user.totp_enabled = False
        with pytest.raises(AuthenticationError) as exc_disabled:
            await svc.verify_2fa_login(user, "123456")
        assert exc_disabled.value.code == "2fa_not_enabled"

    async def test_disable_2fa_guards_and_success(self) -> None:
        secret = generate_totp_secret()
        codes = generate_recovery_codes()
        user = _make_user(
            password="MyPassword1!",
            totp_enabled=True,
            totp_secret_encrypted=encrypt_totp_secret(secret),
            totp_recovery_codes=hash_recovery_codes(codes),
        )
        svc, _ = self._service(actor=user)

        # Enforced policy blocks disabling
        with pytest.raises(PermissionDeniedError) as exc_enforced:
            await svc.disable_2fa(
                user, password="MyPassword1!", code=generate_totp_code(secret), enforced=True
            )
        assert exc_enforced.value.code == "2fa_enforced"

        # Wrong password fails
        with pytest.raises(AuthenticationError):
            await svc.disable_2fa(
                user, password="WrongPassword", code=generate_totp_code(secret), enforced=False
            )

        # Wrong code fails
        with pytest.raises(AuthenticationError) as exc_code:
            await svc.disable_2fa(user, password="MyPassword1!", code="000000", enforced=False)
        assert exc_code.value.code == "2fa_invalid_code"

        # Disable with recovery code works even if TOTP secret is unreadable
        user.totp_secret_encrypted = "corrupt:token"
        await svc.disable_2fa(user, password="MyPassword1!", code=codes[0], enforced=False)
        assert user.totp_enabled is False
        assert user.totp_secret_encrypted is None
        assert user.totp_recovery_codes == []
        assert svc.audit.record.call_args.args[0] == AuditAction.two_factor_disabled

        # Disabling when already disabled raises ConflictError
        with pytest.raises(ConflictError) as exc_not_enabled:
            await svc.disable_2fa(user, password="MyPassword1!", code="123456", enforced=False)
        assert exc_not_enabled.value.code == "2fa_not_enabled"

    async def test_regenerate_recovery_codes(self) -> None:
        secret = generate_totp_secret()
        user = _make_user(
            password="MyPassword1!",
            totp_enabled=True,
            totp_secret_encrypted=encrypt_totp_secret(secret),
            totp_recovery_codes=hash_recovery_codes(generate_recovery_codes()),
        )
        svc, _ = self._service(actor=user)
        old_hashes = list(user.totp_recovery_codes)

        # Wrong password
        with pytest.raises(AuthenticationError):
            await svc.regenerate_recovery_codes(
                user, password="WrongPassword", code=generate_totp_code(secret)
            )
        # Wrong code
        with pytest.raises(AuthenticationError):
            await svc.regenerate_recovery_codes(user, password="MyPassword1!", code="000000")

        # Success
        new_codes = await svc.regenerate_recovery_codes(
            user, password="MyPassword1!", code=generate_totp_code(secret)
        )
        assert len(new_codes) == 10
        assert user.totp_recovery_codes != old_hashes

        # Unreadable secret
        user.totp_secret_encrypted = "bad:secret"
        with pytest.raises(AuthenticationError) as exc_unread:
            await svc.regenerate_recovery_codes(user, password="MyPassword1!", code="123456")
        assert exc_unread.value.code == "2fa_secret_unreadable"

        # Not enabled
        user.totp_enabled = False
        with pytest.raises(ConflictError):
            await svc.regenerate_recovery_codes(user, password="MyPassword1!", code="123456")

    async def test_admin_reset_2fa_and_guards(self) -> None:
        admin = _make_user(username="admin1", is_superuser=True, is_protected=False)
        peer_admin = _make_user(
            username="admin2", is_superuser=True, is_protected=False, totp_enabled=True
        )
        protected = _make_user(
            username="root", is_superuser=True, is_protected=True, totp_enabled=True
        )
        member = _make_user(
            username="bob",
            totp_enabled=True,
            totp_secret_encrypted=encrypt_totp_secret(generate_totp_secret()),
            totp_recovery_codes=["hash1"],
        )

        svc, _ = self._service(actor=admin)

        # Not found
        svc.users.get.return_value = None
        with pytest.raises(NotFoundError):
            await svc.reset_2fa(uuid.uuid4())

        # Protected account rejected
        svc.users.get.return_value = protected
        with pytest.raises(PermissionDeniedError) as exc_prot:
            await svc.reset_2fa(protected.id)
        assert exc_prot.value.code == "account_protected"

        # Peer admin rejected for non-protected admin
        svc.users.get.return_value = peer_admin
        with pytest.raises(PermissionDeniedError) as exc_peer:
            await svc.reset_2fa(peer_admin.id)
        assert exc_peer.value.code == "peer_admin_protected"

        # Member reset succeeds
        svc.users.get.return_value = member
        updated = await svc.reset_2fa(member.id)
        assert updated.totp_enabled is False
        assert updated.totp_secret_encrypted is None
        assert updated.totp_recovery_codes == []
        assert svc.audit.record.call_args.args[0] == AuditAction.two_factor_reset

        # Protected superadmin CAN reset a peer admin
        root_svc, _ = self._service(actor=protected)
        root_svc.users.get.return_value = peer_admin
        updated_peer = await root_svc.reset_2fa(peer_admin.id)
        assert updated_peer.totp_enabled is False


class TestTwoFactorApiEndpoints:
    async def test_login_flows_normal_challenge_enforced_and_protected_exempt(self) -> None:
        client_info = ClientInfo(ip="127.0.0.1", user_agent="pytest")
        session = AsyncMock()
        service = AsyncMock()

        def _effective(mode: str = "off") -> EffectiveSettings:
            return SiteSettingsService.env_defaults().model_copy(
                update={"require_2fa_mode": mode}
            )

        with (
            patch("app.api.v1.auth.rate_limit.enforce", new=AsyncMock()),
            patch("app.api.v1.auth.SessionService") as mock_session_svc,
            patch("app.api.v1.auth.PermissionService") as mock_perm_svc,
            patch("app.api.v1.auth.SiteSettingsService") as mock_settings_svc,
        ):
            mock_session_svc.return_value.create = AsyncMock()
            mock_perm_svc.return_value.global_permissions = AsyncMock(return_value=[])
            mock_perm_svc.return_value.is_system_admin = AsyncMock(return_value=False)

            # 1. Normal login (2FA off, policy off)
            member = _make_user()
            service.authenticate.return_value = member
            mock_settings_svc.return_value.get_effective = AsyncMock(return_value=_effective("off"))
            resp = Response()
            result = await auth_api.login(
                LoginRequest(username="alice", password="Secret123!"),
                _mock_request(),
                resp,
                service,
                session,
                client_info,
            )
            assert result.access_token is not None
            assert result.requires_2fa is False
            assert result.requires_2fa_setup is False
            assert result.challenge_token is None

            # 2. User with 2FA enabled -> challenge token, no access token
            member.totp_enabled = True
            resp2 = Response()
            result2 = await auth_api.login(
                LoginRequest(username="alice", password="Secret123!"),
                _mock_request(),
                resp2,
                service,
                session,
                client_info,
            )
            assert result2.access_token is None
            assert result2.requires_2fa is True
            assert result2.requires_2fa_setup is False
            assert result2.challenge_token is not None
            assert decode_2fa_token(
                result2.challenge_token, expected_type=TOKEN_TYPE_2FA_CHALLENGE
            ) == member.id

            # 3. User without 2FA when policy is 'all' -> setup challenge
            member.totp_enabled = False
            mock_settings_svc.return_value.get_effective = AsyncMock(return_value=_effective("all"))
            resp3 = Response()
            result3 = await auth_api.login(
                LoginRequest(username="alice", password="Secret123!"),
                _mock_request(),
                resp3,
                service,
                session,
                client_info,
            )
            assert result3.access_token is None
            assert result3.requires_2fa is True
            assert result3.requires_2fa_setup is True
            assert result3.challenge_token is not None
            assert decode_2fa_token(
                result3.challenge_token, expected_type=TOKEN_TYPE_2FA_SETUP
            ) == member.id

            # 4. Protected bootstrap admin exempt even when policy is 'all'
            root = _make_user(username="admin", is_superuser=True, is_protected=True)
            service.authenticate.return_value = root
            mock_perm_svc.return_value.is_system_admin = AsyncMock(return_value=True)
            resp4 = Response()
            result4 = await auth_api.login(
                LoginRequest(username="admin", password="Secret123!"),
                _mock_request(),
                resp4,
                service,
                session,
                client_info,
            )
            assert result4.access_token is not None
            assert result4.requires_2fa is False

    async def test_2fa_status_setup_confirm_verify_disable_regenerate_and_reset(self) -> None:
        client_info = ClientInfo(ip="127.0.0.1", user_agent="pytest")
        session = AsyncMock()
        user = _make_user(password="Secret123!")
        effective = SiteSettingsService.env_defaults()

        with (
            patch("app.api.v1.auth.rate_limit.enforce", new=AsyncMock()),
            patch("app.api.v1.auth.SessionService") as mock_session_svc,
            patch("app.api.v1.auth.PermissionService") as mock_perm_svc,
            patch("app.api.v1.auth.SiteSettingsService") as mock_settings_svc,
            patch("app.api.v1.auth.AuthService") as mock_auth_cls,
        ):
            mock_session_svc.return_value.create = AsyncMock()
            mock_perm_svc.return_value.global_permissions = AsyncMock(return_value=[])
            mock_perm_svc.return_value.is_system_admin = AsyncMock(return_value=False)
            mock_settings_svc.return_value.get_effective = AsyncMock(return_value=effective)

            real_service = AuthService(session, actor=user, client=client_info)
            real_service.users = AsyncMock()
            real_service.users.get = AsyncMock(return_value=user)
            real_service.audit = AsyncMock()
            mock_auth_cls.return_value = real_service

            # Unauthenticated setup raises 401
            with pytest.raises(AuthenticationError):
                await auth_api.setup_2fa(
                    service=real_service, session=session, optional_user=None, payload=None
                )

            # GET /2fa/status
            st = await auth_api.get_2fa_status(user=user, session=session)
            assert st.enabled is False
            assert st.recovery_codes_remaining == 0
            assert st.enforced is False

            # Authenticated setup + confirm
            setup_res = await auth_api.setup_2fa(
                service=real_service, session=session, optional_user=user, payload=None
            )
            confirm_res = await auth_api.confirm_2fa(
                payload=TwoFactorConfirmRequest(code=generate_totp_code(setup_res.secret)),
                request=_mock_request(),
                response=Response(),
                service=real_service,
                session=session,
                client=client_info,
                optional_user=user,
                impersonator=None,
            )
            assert confirm_res.enabled is True
            assert len(confirm_res.recovery_codes) == 10
            assert confirm_res.access_token is None

            # Verify login with challenge token
            challenge_token, _ = create_2fa_token(
                str(user.id), token_type=TOKEN_TYPE_2FA_CHALLENGE, expires_in=300
            )
            verify_res = await auth_api.verify_2fa(
                payload=TwoFactorVerifyRequest(
                    challenge_token=challenge_token,
                    code=generate_totp_code(setup_res.secret),
                ),
                request=_mock_request(),
                response=Response(),
                service=real_service,
                session=session,
                client=client_info,
            )
            assert verify_res.access_token is not None
            assert verify_res.user is not None
            assert verify_res.user.totp_enabled is True

            # Regenerate recovery codes
            regen_res = await auth_api.regenerate_2fa_recovery_codes(
                payload=TwoFactorRegenerateCodesRequest(
                    password="Secret123!", code=generate_totp_code(setup_res.secret)
                ),
                user=user,
                service=real_service,
            )
            assert len(regen_res.recovery_codes) == 10

            # Reconfigure / rotate 2FA QR secret while staying enabled
            reconf_res = await auth_api.reconfigure_2fa(
                payload=TwoFactorDisableRequest(
                    password="Secret123!", code=generate_totp_code(setup_res.secret)
                ),
                request=_mock_request(),
                user=user,
                session=session,
                service=real_service,
            )
            assert reconf_res.secret != setup_res.secret
            assert reconf_res.otpauth_uri.startswith("otpauth://totp/")
            rotated_confirm = await auth_api.confirm_2fa(
                payload=TwoFactorConfirmRequest(code=generate_totp_code(reconf_res.secret)),
                request=_mock_request(),
                response=Response(),
                service=real_service,
                session=session,
                client=client_info,
                optional_user=user,
                impersonator=None,
            )
            assert rotated_confirm.enabled is True
            assert len(rotated_confirm.recovery_codes) == 10

            # Disable 2FA using the newly rotated secret
            disable_res = await auth_api.disable_2fa(
                payload=TwoFactorDisableRequest(
                    password="Secret123!", code=generate_totp_code(reconf_res.secret)
                ),
                user=user,
                session=session,
                service=real_service,
            )
            assert disable_res.enabled is False

            # Enforced login setup + confirm via challenge_token completes login
            setup_token, _ = create_2fa_token(
                str(user.id), token_type=TOKEN_TYPE_2FA_SETUP, expires_in=600
            )
            setup_via_tok = await auth_api.setup_2fa(
                service=real_service,
                session=session,
                optional_user=None,
                payload=TwoFactorSetupRequest(challenge_token=setup_token),
            )
            confirm_via_tok = await auth_api.confirm_2fa(
                payload=TwoFactorConfirmRequest(
                    code=generate_totp_code(setup_via_tok.secret),
                    challenge_token=setup_token,
                ),
                request=_mock_request(),
                response=Response(),
                service=real_service,
                session=session,
                client=client_info,
                optional_user=None,
                impersonator=None,
            )
            assert confirm_via_tok.enabled is True
            assert confirm_via_tok.access_token is not None
            assert confirm_via_tok.user is not None

        # Admin reset endpoint
        with (
            patch("app.api.v1.users.PermissionService") as mock_users_perm,
            patch("app.api.v1.users._read_user", new=AsyncMock()) as mock_read_user,
        ):
            mock_users_perm.return_value.require_global = AsyncMock()
            admin = _make_user(username="admin", is_superuser=True)
            admin_service = AsyncMock()
            user.totp_enabled = False
            admin_service.reset_2fa = AsyncMock(return_value=user)
            mock_read_user.return_value = SimpleNamespace(id=user.id, totp_enabled=False)

            res = await users_api.reset_user_2fa(
                user_id=user.id, user=admin, session=session, service=admin_service
            )
            assert res.totp_enabled is False
            admin_service.reset_2fa.assert_awaited_once_with(user.id)

    async def test_impersonation_bypasses_target_2fa(self) -> None:
        admin = _make_user(username="admin", is_superuser=True)
        target = _make_user(username="bob", totp_enabled=True)
        service = AsyncMock()
        service.actor = admin
        service.begin_impersonation = AsyncMock(return_value=target)
        session = AsyncMock()
        client_info = ClientInfo(ip="127.0.0.1", user_agent="pytest")

        with (
            patch("app.api.v1.auth.SessionService") as mock_session_svc,
            patch("app.api.v1.auth.SiteSettingsService") as mock_settings_svc,
        ):
            mock_session_svc.return_value.create = AsyncMock()
            mock_settings_svc.return_value.get_effective = AsyncMock(
                return_value=SiteSettingsService.env_defaults()
            )
            result = await auth_api.start_impersonation(
                payload=ImpersonateRequest(user_id=target.id),
                response=Response(),
                service=service,
                session=session,
                client=client_info,
            )
            assert result.access_token is not None
            assert result.requires_2fa is False
            assert result.user is not None
            assert result.user.totp_enabled is True


class TestSiteSettingsRequire2FA:
    async def test_update_and_reset_require_2fa_mode(self) -> None:
        session = AsyncMock()
        row = SiteSettings(id=SINGLETON_ID, require_2fa_mode="off")
        service = SiteSettingsService(session)
        service.audit = AsyncMock()

        with patch.object(service, "_get_row", new=AsyncMock(return_value=row)):
            res = await service.update(SiteSettingsUpdate(require_2fa_mode="admins"))
            assert res.effective.require_2fa_mode == "admins"
            assert res.overrides.require_2fa_mode == "admins"

            res_reset = await service.update(SiteSettingsUpdate(require_2fa_mode=None))
            assert res_reset.effective.require_2fa_mode == "off"
            assert row.require_2fa_mode == "off"


class TestBackupTwoFactorRoundTrip:
    async def test_export_and_import_preserves_or_strips_totp(self) -> None:
        secret_enc = encrypt_totp_secret(generate_totp_secret())
        codes_hash = hash_recovery_codes(generate_recovery_codes())
        enabled_at = datetime.now(UTC)
        user_with_2fa = _make_user(
            username="carol",
            email="carol@example.com",
            totp_enabled=True,
            totp_enabled_at=enabled_at,
            totp_secret_encrypted=secret_enc,
            totp_recovery_codes=codes_hash,
        )

        # Export with credentials preserves 2FA fields
        def _fake_export_service() -> MagicMock:
            svc = MagicMock()
            svc.session = AsyncMock()
            svc.site_settings = AsyncMock()
            svc.site_settings.read = AsyncMock(
                return_value=SimpleNamespace(overrides=SiteSettingsService.env_defaults())
            )
            svc.site_settings.get_effective = AsyncMock(
                return_value=SiteSettingsService.env_defaults()
            )
            svc._load_comments = AsyncMock(return_value=([], []))
            svc._issue_entries = AsyncMock(return_value=([], []))
            svc.audit = AsyncMock()

            empty_result = MagicMock()
            empty_result.scalars.return_value = []
            users_result = MagicMock()
            users_result.scalars.return_value = [user_with_2fa]

            call_idx = 0

            async def _execute(_stmt: object) -> MagicMock:
                nonlocal call_idx
                call_idx += 1
                if call_idx == 1:
                    return users_result
                return empty_result

            svc.session.execute = AsyncMock(side_effect=_execute)
            return svc

        doc_with_creds = await backup_exporter.export_document(
            _fake_export_service(), include_credentials=True
        )
        exported_u = doc_with_creds.users[0]
        assert exported_u.totp_enabled is True
        assert exported_u.totp_enabled_at == enabled_at
        assert exported_u.totp_secret_encrypted == secret_enc
        assert exported_u.totp_recovery_codes == codes_hash

        # Export without credentials strips 2FA secret/codes and sets totp_enabled=False
        doc_no_creds = await backup_exporter.export_document(
            _fake_export_service(), include_credentials=False
        )
        exported_no = doc_no_creds.users[0]
        assert exported_no.totp_enabled is False
        assert exported_no.totp_secret_encrypted is None
        assert exported_no.totp_recovery_codes == []

        # Import restores 2FA fields when present and defaults safely when absent
        added_users: list[User] = []
        imp_svc = MagicMock()
        imp_svc.session = AsyncMock()
        imp_svc.session.add = MagicMock(
            side_effect=lambda obj: added_users.append(obj) if isinstance(obj, User) else None
        )
        imp_svc.users = AsyncMock()
        imp_svc.users.get_protected = AsyncMock(return_value=None)
        imp_svc.users.get_by_username = AsyncMock(return_value=None)
        imp_svc.users.get_by_email = AsyncMock(return_value=None)
        imp_svc.users.get = AsyncMock(return_value=None)

        legacy_user = BackupUser(
            id=uuid.uuid4(),
            username="legacy",
            email="legacy@example.com",
            password_hash=hash_password("Pass123!"),
        )
        import_doc = BackupDocument(
            wikihub_backup=BackupMeta(
                app_version="0.1.0",
                site_name="WikiHub",
                includes_credentials=True,
                exported_at=datetime.now(UTC),
            ),
            users=[exported_u, legacy_user],
        )
        report = backup_importer._ReportBuilder()
        await backup_importer.apply_document(imp_svc, import_doc, report, [])

        by_name = {u.username: u for u in added_users}
        assert by_name["carol"].totp_enabled is True
        assert by_name["carol"].totp_enabled_at == enabled_at
        assert by_name["carol"].totp_secret_encrypted == secret_enc
        assert by_name["carol"].totp_recovery_codes == codes_hash

        assert by_name["legacy"].totp_enabled is False
        assert by_name["legacy"].totp_secret_encrypted is None
        assert by_name["legacy"].totp_recovery_codes == []
