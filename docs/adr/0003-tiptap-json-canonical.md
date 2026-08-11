# 0003 — Tiptap JSON is the canonical content format

**Status:** Accepted · Phase 1

## Context

Page content must be editable in a rich editor, rendered as HTML, exported as
Markdown and HTML, indexed for search, and produced by the Confluence importer.
Something has to be the source of truth.

## Decision

Store the Tiptap ProseMirror document as `jsonb`. Derive HTML, Markdown and
plain text from it. Never store HTML as the primary representation.

## Reasoning

- **HTML is lossy in the wrong direction.** Parsing HTML back into a structured
  document is guesswork; rendering structure to HTML is deterministic. Storing
  HTML would make every export a parsing problem.
- **A structured tree is queryable.** Rewriting internal links and attachment
  references during import and export means walking typed nodes, not running
  regexes over markup.
- **It is what the editor already speaks.** No conversion on load or save, so no
  round-trip drift.
- **Extensible.** New node types (callouts, unsupported-macro placeholders) are
  additive and carry their attributes losslessly.

## Consequences

- **Renderers must exist in Python**, not only in JavaScript, because export
  jobs run in the worker where there is no Node runtime. They live in
  `app/modules/import_export/tiptap/`.
- **Validation is a security boundary.** The stored JSON is user-controlled and
  the server renders it to HTML, so every write is validated against an
  allowlist of node and mark types, and the renderer escapes text and emits only
  whitelisted tags and attributes.
- A plain-text projection is denormalised into `pages.content_text` at save time
  to feed full-text search, since PostgreSQL cannot usefully index the JSON tree.
- Renderers in two languages risk drift; the Python HTML renderer is the one
  tested against fixtures, and it is what exports actually use.
