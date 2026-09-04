"""Smoke tests for the system endpoints and the error envelope."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


async def test_health_is_up_without_dependencies(client: AsyncClient) -> None:
    response = await client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "wikihub-api"
    assert body["environment"] == "test"


async def test_health_returns_correlation_id(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.headers["X-Request-ID"]


async def test_inbound_correlation_id_is_echoed(client: AsyncClient) -> None:
    response = await client.get("/health", headers={"X-Request-ID": "trace-abc-123"})
    assert response.headers["X-Request-ID"] == "trace-abc-123"


async def test_ready_reports_every_dependency(client: AsyncClient) -> None:
    """Without infrastructure the probe must fail closed with 503, not crash."""
    response = await client.get("/ready")

    assert response.status_code in (200, 503)
    checks = response.json()["checks"]
    assert set(checks) == {"database", "redis", "object_storage"}
    if response.status_code == 200:
        assert all(state == "ok" for state in checks.values())
    else:
        assert response.json()["status"] == "degraded"


async def test_security_headers_are_applied(client: AsyncClient) -> None:
    response = await client.get("/health")

    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert "content-security-policy" in response.headers


async def test_instance_metadata(client: AsyncClient) -> None:
    response = await client.get("/api/v1/meta")

    assert response.status_code == 200
    body = response.json()
    assert body["site_name"]
    assert body["features"]["local_auth"] is True
    assert body["features"]["oidc_auth"] is False


async def test_metadata_reports_unimplemented_features_as_false(
    client: AsyncClient,
) -> None:
    """A feature flag is a promise the UI acts on.

    Advertising a capability with no implementation behind it sends the client
    to a dead end, so these flags must stay False until their module lands.
    """
    features = (await client.get("/api/v1/meta")).json()["features"]

    assert features["attachments"] is True
    assert features["comments"] is False
    assert features["search"] is True

    # Implemented, and therefore advertised.
    assert features["imports"] == ["confluence"]
    assert features["exports"] == ["pdf", "html", "docx"]
    assert features["spaces"] is True
    assert features["audit_log"] is True
    assert features["backup"] is True


async def test_metadata_survives_a_database_outage(client: AsyncClient) -> None:
    """The frontend renders its shell from /meta.

    In this in-process suite the database host does not resolve at all, so this
    request already exercises the outage path: answering with environment
    defaults beats a 500 that leaves the UI unable to draw anything.
    """
    response = await client.get("/api/v1/meta")

    assert response.status_code == 200
    assert response.json()["site_name"]


async def test_unknown_route_uses_the_error_envelope(client: AsyncClient) -> None:
    response = await client.get("/api/v1/does-not-exist")

    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "not_found"
    assert error["request_id"]


async def test_openapi_schema_is_generated(client: AsyncClient) -> None:
    response = await client.get("/openapi.json")

    assert response.status_code == 200
    schema = response.json()
    assert schema["info"]["version"]
    assert "/api/v1/meta" in schema["paths"]
    assert "/api/v1/spaces/{key}/pages/{slug}/attachments" in schema["paths"]


@pytest.mark.parametrize("path", ["/docs", "/redoc"])
async def test_api_documentation_is_served(client: AsyncClient, path: str) -> None:
    response = await client.get(path)
    assert response.status_code == 200
