"""Auth endpoint contract tests.

These run without a database: every case here is rejected before the service
layer is reached.
"""

from __future__ import annotations

from httpx import AsyncClient


class TestAuthenticationRequired:
    async def test_me_without_a_token_is_401(self, client: AsyncClient) -> None:
        response = await client.get("/api/v1/auth/me")
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthenticated"

    async def test_me_with_a_garbage_token_is_401(self, client: AsyncClient) -> None:
        response = await client.get(
            "/api/v1/auth/me", headers={"Authorization": "Bearer not-a-real-token"}
        )
        assert response.status_code == 401

    async def test_me_with_a_malformed_scheme_is_401(self, client: AsyncClient) -> None:
        response = await client.get("/api/v1/auth/me", headers={"Authorization": "Basic abc"})
        assert response.status_code == 401

    async def test_listing_users_requires_authentication(self, client: AsyncClient) -> None:
        response = await client.get("/api/v1/users")
        assert response.status_code == 401


class TestLoginValidation:
    async def test_missing_fields_are_422(self, client: AsyncClient) -> None:
        response = await client.post("/api/v1/auth/login", json={"username": "admin"})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_empty_password_is_422(self, client: AsyncClient) -> None:
        response = await client.post(
            "/api/v1/auth/login", json={"username": "admin", "password": ""}
        )
        assert response.status_code == 422


class TestLogout:
    async def test_logout_succeeds_without_a_session(self, client: AsyncClient) -> None:
        # Signing out must never fail, even with an expired or absent token.
        response = await client.post("/api/v1/auth/logout")
        assert response.status_code == 204

    async def test_logout_clears_the_cookie(self, client: AsyncClient) -> None:
        response = await client.post("/api/v1/auth/logout")
        assert "wikihub_access" in response.headers.get("set-cookie", "")


class TestErrorEnvelope:
    async def test_failures_use_the_standard_envelope(self, client: AsyncClient) -> None:
        body = (await client.get("/api/v1/auth/me")).json()
        assert set(body["error"]) >= {"code", "message", "details", "request_id"}
