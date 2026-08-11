# 0002 — arq for background jobs, not Celery

**Status:** Accepted · Phase 1

## Context

Confluence imports and space exports can process thousands of pages and
attachments. They must not run inside an HTTP request, and the client needs
progress updates. Redis is already a dependency.

The brief asked not to introduce Celery unless it is actually needed.

## Decision

Use [`arq`](https://arq-docs.helpmanual.io/) as the job queue. The worker runs
from the backend image with `arq app.workers.settings.WorkerSettings`.

## Reasoning

- **Asyncio-native.** The rest of the stack is async (FastAPI, SQLAlchemy
  async, asyncpg). Celery is thread/process-based; using it would mean running
  a second, synchronous database stack alongside the async one.
- **Redis only.** No extra broker, no result backend to operate.
- **Small.** Small enough to read end to end when debugging a stuck job.
- **Built-in health beat.** arq writes a heartbeat to Redis, which the container
  healthcheck reads via `arq … --check`. That detects a *wedged* worker, not
  merely a running process.

What Celery would add — routing, chords, multiple brokers, a large ecosystem —
is not needed by two job types.

## Consequences

- Progress reporting is ours to build: jobs write `progress` onto their job row
  rather than using a framework feature.
- arq has a smaller community; unusual problems mean reading source rather than
  Stack Overflow. Acceptable given its size.
- Job code must be idempotent — arq re-runs a task if a worker dies mid-job.
- Migrating to Celery later is contained, because job bodies are plain async
  functions with no framework types in their signatures.
