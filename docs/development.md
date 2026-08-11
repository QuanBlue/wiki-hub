# Development guide

## Setup

```bash
git clone <repo> && cd wiki-hub
cp .env.example .env
```

Edit `.env`: at minimum set `WIKIHUB_SECRET_KEY` to a strong random value
(`python -c "import secrets; print(secrets.token_urlsafe(64))"`) and change the
default passwords.

### Everything in Docker

```bash
make up      # build and start all six services
make ps      # status
make logs    # tail logs
make down    # stop (keeps data)
make clean   # stop and DELETE volumes
```

### Hybrid (recommended for day-to-day work)

Infrastructure in Docker, application on the host — much faster reloads:

```bash
make deps               # postgres, redis, minio only
make install            # backend virtualenv at backend/.venv
make install-frontend

make dev-backend        # uvicorn with --reload
make dev-worker         # arq worker
make dev-frontend       # next dev
```

When running on the host, point the app at the published host ports — set
`WIKIHUB_DATABASE_URL`, `WIKIHUB_REDIS_URL` and `WIKIHUB_S3_ENDPOINT_URL` to
`localhost` with the `*_PORT_HOST` values from `.env`.

## Quality gates

Run before every commit:

```bash
make check   # lint + typecheck + test
```

Individually:

| Command | Covers |
|---|---|
| `make lint` | ruff (check + format), eslint |
| `make typecheck` | mypy (strict), tsc |
| `make test` | pytest |
| `make test-frontend` | vitest |
| `make e2e` | Playwright |

### Conventions enforced by tooling

- **mypy runs strict**: every function in `app/` needs annotations.
- **ruff** includes `S` (bandit) and `BLE` (no bare `except Exception`). Silence
  a rule only with a targeted `# noqa: CODE - reason`.
- **Deprecation warnings from our own modules fail the test suite.** This is
  deliberate: it catches renamed upstream APIs at upgrade time rather than in
  production.

## Adding a feature

The layering is not optional. To add an endpoint:

1. **Model** — `app/models/`, then `make migration m="…"` and review the
   generated SQL. Never edit the schema by hand.
2. **Schema** — `app/schemas/`, request and response Pydantic models. A
   SQLAlchemy model must never be returned from a route.
3. **Repository** — `app/repositories/`, the only place that builds queries.
4. **Service** — `app/modules/<feature>/service.py`, business rules, permission
   checks and the transaction boundary.
5. **Router** — `app/modules/<feature>/router.py`, HTTP wiring only. Register it
   in `app/api/v1/router.py`.
6. **Tests** — service tests for the rules, API tests for the contract.

## Migrations

```bash
make migration m="add page labels"   # autogenerate
make migrate-local                   # apply
make downgrade                       # roll back one
```

Always read the generated migration. Autogenerate misses table renames, column
renames (it emits drop + add, which loses data), server defaults, and index
changes on expressions.

Verify a migration works from scratch before pushing:

```bash
make clean && make deps && make migrate-local
```

## Testing

```bash
cd backend && ../backend/.venv/bin/pytest -q                 # all
../backend/.venv/bin/pytest tests/unit -q                    # fast only
../backend/.venv/bin/pytest -m integration -q                # needs make deps
../backend/.venv/bin/pytest --cov=app --cov-report=term-missing
```

- `tests/unit/` — pure logic, no I/O.
- `tests/integration/` — real PostgreSQL/Redis/MinIO, marked `integration`.
- `tests/api/` — full request/response cycle through the ASGI app.

Frontend tests live in `frontend/tests/` (vitest) and `frontend/e2e/`
(Playwright).

## Debugging

```bash
make logs                        # everything
docker compose logs -f backend   # one service
make psql                        # database shell
docker compose exec backend sh   # shell inside the API container
```

Check dependency health:

```bash
curl -s localhost:8000/ready | jq
```

Every response carries `X-Request-ID`; grep the logs for it to see the full
story of one request.

Verify the job queue is actually consuming work:

```bash
docker compose exec backend python -c "
import asyncio
from arq import create_pool
from app.workers.settings import redis_settings
async def main():
    pool = await create_pool(redis_settings())
    job = await pool.enqueue_job('ping')
    print(await job.result(timeout=20))
    await pool.aclose()
asyncio.run(main())"
```

## Configuration

All settings come from the environment with the `WIKIHUB_` prefix and are
defined in `app/core/config.py`. To add one:

1. Add a typed field with a safe default.
2. Document it in `.env.example`.
3. If it is a list, use the `CsvList` type so both `a,b` and `["a","b"]` parse.

Never read `os.environ` directly outside that module, and never commit a `.env`.
