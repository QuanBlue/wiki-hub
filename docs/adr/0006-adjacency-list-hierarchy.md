# 0006 — Adjacency list for the page tree

**Status:** Accepted · Phase 1

## Context

Pages nest arbitrarily deep inside a Space. The UI renders a navigation tree,
breadcrumbs need the ancestor chain, exports walk subtrees, and moving a page
relocates everything beneath it. The classic options are an adjacency list
(`parent_id`), a materialised path, nested sets, or PostgreSQL's `ltree`.

## Decision

Adjacency list: `parent_id` plus `position` for sibling ordering and a cached
`depth`. Subtrees and ancestor chains are read with recursive CTEs.

## Reasoning

- **Writes are the common case.** Pages are created, renamed and moved
  constantly. Adjacency list writes touch one row; nested sets renumber a large
  part of the table on every insert.
- **Recursive CTEs are fast enough.** A Space's tree is hundreds of rows, not
  millions, and the index on `(space_id, parent_id, position)` covers it.
- **No extension dependency.** `ltree` would work, but it must be enabled in the
  database — an obstacle for managed PostgreSQL and for anyone deploying WikiHub
  into an environment they do not fully control.
- **Materialised paths must be rewritten on every move**, for the whole subtree,
  and go silently stale if any write path forgets. `parent_id` cannot drift from
  the truth because it *is* the truth.

`depth` is a cached convenience for rendering indentation; it is recomputed for
the moved subtree inside the same transaction as the move, so it can never
disagree with `parent_id` after a commit.

## Consequences

- Reading a deep tree is one recursive query, not one query per level.
- Moves need an explicit **cycle check** — a page must not become its own
  descendant — plus recomputation of `depth`/`position` and re-validation of slug
  uniqueness in the destination space. All of it in one transaction.
- If a Space ever grows large enough that tree reads hurt, a materialised path
  can be added as a derived cache without changing the source of truth.
