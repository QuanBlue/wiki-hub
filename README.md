# WikiHub

A self-hosted internal documentation platform — Spaces, hierarchical Pages, a
rich editor with full revision history, attachments, search, Confluence import
and Markdown/HTML export. Built as a **modular monolith**, deployable with
Docker Compose or Kubernetes.

> **Status: Phase 1 of 9 complete.** The platform foundation (infrastructure,
> API skeleton, observability, design system, container images) is running.
> See [Roadmap](#roadmap) for what lands in each phase.

---

## Architecture

```
Browser
   │
   ▼
Next.js 16 (App Router)          ── React Server Components for reads,
   │                                client components for the editor
   │  REST /api/v1
   ▼
FastAPI modular monolith         ── Router → Service → Repository → DB
   │
   ├──▶ PostgreSQL 16   application data + full-text search
   ├──▶ Redis 7         job queue, rate limits, short-lived cache
   └──▶ S3 / MinIO      attachments and export packages
             ▲
   arq worker ┘         same image, different entrypoint
```

Business logic lives in **services**, never in route handlers. SQLAlchemy models
never cross the API boundary — every response is a Pydantic schema.

Detailed design: [`docs/architecture.md`](docs/architecture.md).

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 (async), Alembic |
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Tiptap 3 |
| Data | PostgreSQL 16, Redis 7 |
| Objects | S3-compatible (MinIO locally, AWS S3 or equivalent in production) |
| Jobs | arq (asyncio Redis queue) |
| Auth | Local email/password (Argon2id + JWT); OIDC behind an interface |
| Search | PostgreSQL full-text search behind a swappable backend interface |
| Deploy | Docker Compose, Kubernetes manifests, Helm chart |

## Requirements

- Docker 24+ and Docker Compose v2
- For running outside containers: Python 3.12+ and Node.js 20+

## Quick start

```bash
cp .env.example .env      # then edit WIKIHUB_SECRET_KEY and the passwords
docker compose up -d
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| API docs (Swagger) | http://localhost:8000/docs |
| API docs (ReDoc) | http://localhost:8000/redoc |
| Health / readiness | http://localhost:8000/health · `/ready` |
| MinIO console | http://localhost:9001 |

### Port conflicts

If something already owns 3000/5432/6379/8000/9000 on your machine, change the
`*_PORT_HOST` values in `.env`. Only the host-side mapping moves; containers keep
talking to each other on standard ports. Browser API requests use the current
WikiHub origin and are proxied by Next.js, so this also works when the frontend
is opened through a reverse proxy or an ngrok URL. `API_INTERNAL_BASE_URL` is
the only URL used for server-side requests inside Docker.

## Local development (without Docker)

Run the infrastructure in Docker and the app on your machine for fast reloads:

```bash
make deps              # postgres + redis + minio only
make install           # backend virtualenv
make install-frontend  # npm install

make dev-backend       # http://localhost:8000
make dev-worker        # background job worker
make dev-frontend      # http://localhost:3000
```

Run `make help` to see every target.

## Database migrations

Schema is owned entirely by Alembic — tables are never created by hand, and a
fresh database is built purely from migrations.

```bash
make migrate                        # apply all migrations (in Docker)
make migrate-local                  # apply from the host virtualenv
make migration m="add page labels"  # autogenerate a new revision
make downgrade                      # roll back one revision
make seed                           # bootstrap admin user + demo content
```

## Tests

```bash
./scripts/test.sh    # every suite + coverage summary  (also: make test-all)
./scripts/test.sh --unit    # fast pass, no database needed
./scripts/test.sh --open    # coverage + open the HTML reports
```

`./scripts/test.sh --help` lists the rest (`--backend`, `--frontend`,
`--watch`, `--fail-under N`, `-k EXPR`). Individual gates:

```bash
make test            # backend: pytest
make test-frontend   # frontend: vitest
make e2e             # end-to-end: Playwright
make lint            # ruff + eslint + prettier
make typecheck       # mypy + tsc
make check           # everything above
```

Tests marked `integration` need PostgreSQL, Redis and MinIO; start them with
`make deps`. `scripts/test.sh` then wires them up automatically against a
separate `wikihub_test` database, so test rows never reach your development
data. Without a database those tests skip themselves and coverage drops from
~81% to ~64% — the script warns when that happens, so the number is never
quietly wrong.

## Importing from Confluence

WikiHub imports Confluence space exports and detects the format automatically:

- **XML space export** (`entities.xml` + `attachments/`) — richest fidelity:
  page IDs, hierarchy, labels, authors and timestamps.
- **HTML export** (`index.html` + per-page HTML) — hierarchy is recovered from
  breadcrumbs; metadata that the format does not carry is reported as missing.

Imports run as background jobs with live progress and produce a downloadable
report listing every unsupported macro and failed attachment. Nothing is
discarded silently — unrecognised macros become visible callouts in the page.

Full guide: [`docs/import-confluence.md`](docs/import-confluence.md) *(Phase 6)*.

## Exporting

Export a single page, a page subtree, a whole Space or the entire instance to
**Markdown** or **HTML**, packaged as a ZIP with assets and rewritten relative
links so the archive works offline.

Full guide: [`docs/export.md`](docs/export.md) *(Phase 6)*.

## Deployment

Kubernetes manifests and a Helm chart live in [`deploy/`](deploy/). Container
images run as a non-root user, contain no package manager, and are scanned with
Trivy in CI.

Full guide: [`docs/deployment.md`](docs/deployment.md) *(Phase 9)*.

## Security

- Secrets come from environment variables only; nothing sensitive is committed.
- Passwords hashed with Argon2id; short-lived JWT access tokens plus rotating
  refresh tokens.
- Uploads validated by extension, MIME type **and** magic bytes, with a size cap
  and generated object keys — the original filename is never trusted.
- Structured logs pass through a redaction filter, so passwords, tokens, keys
  and cookies never reach a log sink.
- Security headers and a strict CSP on every API response.

### Account switching (impersonation)

Administrators can view WikiHub as another user from the account menu, without
knowing that user's password. The rules:

- **Administrators only**, and never the protected bootstrap account — that one
  is the guaranteed way back into the instance.
- Deactivated accounts cannot be impersonated, and impersonation cannot be
  nested.
- The administrator's identity travels in the signed token's `act` claim, so it
  cannot be stripped without invalidating the signature.
- Starting and stopping are both audited, and **every action taken meanwhile
  records the administrator behind it** (`impersonator_username` in
  `audit_logs`, shown as a `via <admin>` badge in the audit log). Without that
  column the trail would read "alice deleted the space" when an administrator
  did it as alice.
- A non-dismissible banner stays on screen for the whole session.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Infrastructure, API skeleton, health checks, design system | ✅ Done |
| 2 | Data model, migrations, Spaces, Pages, Revisions | ⏳ Next |
| 3 | Authentication and RBAC | |
| 4 | Page/Space UI, Tiptap editor, revision history | |
| 5 | Attachments, comments, search | |
| 6 | Import/export framework, Confluence importer, exporters | |
| 7 | Background jobs, Import Center, export packages | |
| 8 | Audit logs, admin UI, security hardening | |
| 9 | Full test suite, Kubernetes/Helm, CI, documentation | |

## Documentation

| Document | Contents |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | System design and module layout |
| [`docs/development.md`](docs/development.md) | Day-to-day workflow and conventions |
| [`docs/design-system.md`](docs/design-system.md) | Visual language and layout tokens |
| [`docs/user-guide.md`](docs/user-guide.md) | Hướng dẫn sử dụng WikiHub bằng tiếng Việt |
| [`docs/adr/`](docs/adr/) | Architecture decision records |

`database.md`, `api.md`, `authentication.md`, `permissions.md`,
`import-confluence.md`, `export.md` and `deployment.md` are written as their
phases land.

## License

Apache-2.0.

WikiHub is an independent project. It is not affiliated with, endorsed by, or
derived from Atlassian, and contains no Atlassian branding or proprietary
assets. "Confluence" is referenced only to name a supported import format.
