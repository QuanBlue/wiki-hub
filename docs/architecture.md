# Architecture

## Shape of the system

WikiHub is a **modular monolith**: one deployable backend containing clearly
separated feature modules, one frontend, and a background worker that runs the
same codebase under a different entrypoint.

```
Browser
   │
   ▼
Next.js 16 ── React Server Components render reads; the editor is a client component
   │
   │  REST /api/v1  (Bearer access token)
   ▼
FastAPI
   │
   ├──▶ PostgreSQL   application data, page hierarchy, full-text search index
   ├──▶ Redis        arq job queue, login rate limits, short-lived caches
   └──▶ S3 / MinIO   attachments, uploaded import archives, export packages
             ▲
   arq worker ┘
```

### Why not microservices

Every candidate service (pages, search, import) shares the same transactional
data and the same permission model. Splitting them would replace local function
calls and database transactions with network calls and distributed consistency
problems, in exchange for independent scaling nobody needs at this size. The
module boundaries below give the same separation of concerns at a fraction of
the operational cost, and any module can be extracted later if its load profile
genuinely diverges.

## Layering

```
Router      HTTP only: parse, validate, authorise, serialise.
   ▼
Service     Business logic and transaction boundaries. Framework-agnostic.
   ▼
Repository  The only place that builds SQL.
   ▼
Database
```

Two rules make this hold:

1. **A router never contains business logic.** If a handler branches on domain
   state, that branch belongs in a service.
2. **A SQLAlchemy model never leaves the service layer.** Responses are Pydantic
   schemas, so the storage shape can change without breaking clients.

## Module layout

```
app/
  api/            routers, dependencies, error envelope, health probes
  core/           config, logging, security, middleware, exceptions
  db/             engine and session management
  models/         SQLAlchemy ORM models
  schemas/        Pydantic request/response models
  repositories/   data access
  services/       cross-cutting services (object storage, audit)
  modules/
    auth/         authentication providers
    users/ groups/           identity
    spaces/ pages/ revisions/ hierarchical content
    attachments/ comments/   page-attached data
    search/       search backends
    audit/        audit trail
    import_export/
      tiptap/           canonical document schema + HTML/Markdown/text renderers
      html_to_tiptap/   HTML → Tiptap conversion with a handler registry
      importers/        base + confluence, markdown, html
      exporters/        base + markdown, html
  workers/        arq worker definition and tasks
  alembic/        migrations
```

## Extension points

These interfaces exist so that new capability does not require touching core
domain code:

| Interface | Shipped implementation | Designed to also support |
|---|---|---|
| `AuthProvider` | `LocalAuthProvider` | OIDC / Keycloak |
| `SearchBackend` | `PostgresSearchBackend` | OpenSearch |
| `ObjectStorage` | `S3ObjectStorage` | any S3-compatible endpoint |
| `BaseImporter` | Confluence, Markdown, HTML | any archive format |
| `BaseExporter` | Markdown, HTML | PDF, DOCX, JSON |
| `MacroHandler` registry | Confluence macro mappings | new macros without core changes |

Confluence-specific parsing lives **only** inside
`modules/import_export/importers/confluence/`. The page domain has no knowledge
of Confluence; it accepts a generic intermediate representation.

## Content model

**Tiptap JSON is the canonical page representation.** HTML and Markdown are
derived from it, never the other way round.

- Stored as `jsonb`, validated on every write against an allowlist of node and
  mark types — this is the XSS boundary, since the server also renders that JSON
  to HTML for export.
- Rendered server-side by Python renderers in `import_export/tiptap/`, because
  export jobs run in the worker, which has no Node runtime.
- A plain-text projection is extracted at save time into `pages.content_text` and
  feeds the full-text search vector.

## Page hierarchy

An adjacency list (`parent_id`) plus a `position` for sibling order and a cached
`depth`. Subtrees are read with recursive CTEs. This avoids a materialised-path
column that must be rewritten on every move, and avoids depending on the `ltree`
extension.

Moves happen in a single transaction with a cycle check (a page may not be moved
beneath its own descendant) and re-validation of slug uniqueness in the
destination space.

## Revisions

Every meaningful save appends a row to `page_revisions` holding a **full content
snapshot**, not a diff. Storage is cheap; reconstructing a document from a diff
chain is a correctness risk during exactly the operation people rely on most.

**History is append-only.** Restoring revision *N* reads its content and writes a
new revision *N+1*; it never deletes or rewrites anything. There is no code path
in WikiHub that deletes a `page_revisions` row.

Autosave writes only to `pages.content` so a revision is not created per
keystroke. A revision is created on an explicit save or publish, or when the
previous revision by the same author is older than five minutes.

## Background jobs

Imports and exports can run for many minutes, so they never execute inside an
HTTP request. The API creates a job row, enqueues it in Redis, and returns
immediately; the client polls for progress.

`arq` was chosen over Celery: it is asyncio-native (matching the rest of the
stack), needs only Redis, and is small enough to reason about. The worker runs
from the same image as the API, so its code and dependencies cannot drift.

## Observability

- **Structured logs** (JSON in production) with a redaction processor that
  strips anything matching password/token/secret/key/cookie patterns.
- **Correlation IDs**: every request gets an `X-Request-ID`, propagated into all
  log lines and returned in error responses so a user can quote it in a report.
- **`/health`** touches no dependency — a database blip must not cause
  Kubernetes to restart a healthy pod.
- **`/ready`** probes PostgreSQL, Redis and object storage in parallel with a
  3-second timeout each, returning 503 with a per-dependency breakdown.

Prometheus metrics and OpenTelemetry traces are deliberately deferred; the
structured-log foundation is what they would build on.

## Error handling

All failures share one envelope:

```json
{
  "error": {
    "code": "permission_denied",
    "message": "You do not have permission to perform this action.",
    "details": {},
    "request_id": "3f9a…"
  }
}
```

Services raise domain exceptions from `app.core.exceptions`, which carry their
own status code and stable machine-readable `code`. The API layer translates
them; unhandled exceptions are logged with a stack trace and returned as a
generic 500 that leaks nothing.
