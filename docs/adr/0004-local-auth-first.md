# 0004 — Local authentication first, OIDC behind an interface

**Status:** Accepted · Phase 1

## Context

The target deployment authenticates against a self-hosted identity provider such
as Keycloak. But requiring an IdP to log in means every developer, test run and
evaluation has to stand one up first.

## Decision

Implement local email/password authentication (Argon2id, short-lived JWT access
tokens, rotating refresh tokens) as the only working provider in this build,
behind an `AuthProvider` interface. Ship `OIDCAuthProvider` as an explicit stub
that raises `NotImplementedFeatureError`.

This was confirmed with the project owner, who chose local-only for the MVP.

## Reasoning

- `docker compose up -d` produces a usable system with no external dependency.
- Tests authenticate without mocking an IdP or running one in CI.
- The interface, the `WIKIHUB_AUTH_PROVIDER` setting and the token plumbing are
  all in place, so adding OIDC later is one class, not a refactor.
- Business logic depends on the resolved `User`, never on how it was
  authenticated — so no service needs to change when the provider does.

## Consequences

- **This build cannot authenticate against Keycloak.** That is a documented
  limitation, surfaced in `/api/v1/meta` as `features.oidc_auth: false`, not a
  hidden gap.
- WikiHub stores password hashes, which brings obligations the OIDC path would
  not have: Argon2id, rate-limited login, and no password material in logs.
- User provisioning is manual (admin-created) rather than driven by IdP claims.
