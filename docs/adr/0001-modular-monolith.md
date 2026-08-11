# 0001 — Modular monolith instead of microservices

**Status:** Accepted · Phase 1

## Context

WikiHub covers identity, spaces, pages, revisions, attachments, comments,
search, import and export. Each of those is a plausible service boundary.

## Decision

Ship one backend deployable containing separate feature modules under
`app/modules/`, with a strict `router → service → repository → database`
layering. The background worker runs the same image with a different entrypoint.

## Reasoning

Every candidate service reads and writes the same core tables and enforces the
same permission model. A page edit touches pages, revisions, the search index
and the audit log in one transaction. Splitting that across services replaces a
database transaction with a distributed one — for no benefit at this scale.

Microservices buy independent scaling and independent deployment. Neither is a
current constraint: the load profile is a few hundred internal users, and the
whole team deploys together.

## Consequences

- One database transaction spans a whole business operation. Consistency is free.
- Module boundaries are enforced by convention and review, not by the network,
  so they need discipline: no module reaches into another's repositories.
- If one module's load genuinely diverges later — search is the likeliest — it
  can be extracted, because its interface (`SearchBackend`) is already isolated.
