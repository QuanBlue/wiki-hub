# Architecture decision records

Short records of decisions that were not obvious, with the reasoning that
produced them. They exist so a future maintainer can tell the difference between
a deliberate trade-off and an accident.

| # | Decision | Status |
|---|---|---|
| [0001](0001-modular-monolith.md) | Modular monolith instead of microservices | Accepted |
| [0002](0002-arq-for-background-jobs.md) | arq for background jobs, not Celery | Accepted |
| [0003](0003-tiptap-json-canonical.md) | Tiptap JSON is the canonical content format | Accepted |
| [0004](0004-local-auth-first.md) | Local authentication first, OIDC behind an interface | Accepted |
| [0005](0005-full-revision-snapshots.md) | Revisions store full snapshots, not diffs | Accepted |
| [0006](0006-adjacency-list-hierarchy.md) | Adjacency list for the page tree | Accepted |
