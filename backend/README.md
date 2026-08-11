# WikiHub backend

FastAPI modular monolith serving the WikiHub REST API and the background worker.

```
app/
  api/          HTTP layer: routers, dependencies, error envelope
  core/         config, logging, security, middleware, exceptions
  db/           SQLAlchemy engine + session management
  models/       SQLAlchemy ORM models
  schemas/      Pydantic request/response models
  repositories/ data access, the only place that builds SQL
  services/     cross-cutting services (object storage, audit, ...)
  modules/      feature modules (auth, spaces, pages, import_export, ...)
  workers/      arq background worker definition
  alembic/      database migrations
```

Layering is strict: **router → service → repository → database**. Routers never
contain business logic and SQLAlchemy models are never returned from an endpoint.

See the repository root `README.md` for setup, and `docs/` for architecture,
database, API and deployment documentation.
