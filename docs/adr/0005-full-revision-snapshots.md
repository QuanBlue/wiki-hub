# 0005 — Revisions store full snapshots, not diffs

**Status:** Accepted · Phase 1

## Context

Every page edit creates a revision. Users view history, compare versions and
restore old ones. Revisions could store deltas against the previous version or a
complete copy of the document.

## Decision

Each `page_revisions` row holds the **complete** Tiptap document for that
version. History is **append-only**: restoring revision *N* writes a new
revision *N+1*; nothing is ever deleted or rewritten.

## Reasoning

- **Reading one version is one row.** With diffs, viewing an old revision means
  replaying a chain from the beginning — slow, and it fails entirely if any link
  is corrupt.
- **The failure mode is asymmetric.** A storage cost is a bill; an
  unreconstructable document is lost work, discovered at the exact moment
  someone needs it back.
- **The volume does not justify it.** A large page is tens of kilobytes of JSON.
  Thousands of revisions are megabytes — irrelevant next to attachments.
- **Diffing is a read-time concern.** Comparing versions works fine by diffing
  two full documents on demand; that does not require storing deltas.

## Consequences

- `page_revisions` is the largest text table. If it ever matters, PostgreSQL
  already TOAST-compresses large `jsonb` values, and old revisions could be
  archived to object storage without changing the model.
- There is no code path anywhere in WikiHub that deletes a `page_revisions` row,
  and a test asserts the row count only ever grows across a restore.
- Restore is trivially correct: copy content forward, add a change summary.
