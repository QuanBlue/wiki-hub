# Third-party licensing notes

WikiHub itself is Apache-2.0 ([`LICENSE`](../LICENSE), `backend/pyproject.toml`). Most dependencies are
permissive and need no comment. This file records the ones that carry an
obligation, so the decision is written down somewhere other than a commit
message.

## PyMuPDF — AGPL-3.0

`pymupdf` powers PDF import (`backend/app/modules/document_import/convert.py`).
It is the only dependency whose licence is stronger than Apache-2.0.

**Why it was chosen.** pandoc, already in the image, cannot read PDF at all. The
permissive alternatives (`pypdf`, `pdfminer.six`) extract a flat stream of text
and cannot reliably interleave embedded images in reading order or infer heading
levels from font metrics — which is most of what makes an imported PDF usable as
a wiki page rather than a wall of text.

**What the obligation means here.** The AGPL's network clause is triggered by
*conveying* the software, including making a modified version available to users
over a network. For WikiHub as it is used today — self-hosted, deployed by the
same organisation that runs it — this is satisfied by the source already being
available to that organisation.

**What it forecloses.** WikiHub cannot be distributed, or offered as a hosted
service to third parties, as a closed-source product while `pymupdf` is a
dependency. If that ever becomes the goal, the options are:

1. Buy a commercial licence from Artifex (the PyMuPDF copyright holder), or
2. Move PDF extraction behind an optional import path backed by `pypdf` /
   `pdfminer.six`, accepting materially worse fidelity, or
3. Run PyMuPDF out-of-process as a separate, separately-licensed service.

Revisit this before any distribution decision. Do not remove the dependency
without also removing `pdf` from `DOCUMENT_IMPORT_EXTENSIONS`.

## tldr-skill (writing style) — Apache-2.0

The default wording of the AI page-summary skill
(`DEFAULT_SUMMARY_INSTRUCTIONS` in `backend/app/modules/ai/skills.py`) adapts the
tone and "concrete over abstract, no filler words" rules from the writing guide
and overview prompt of [UpayanGhosh/tldr-skill](https://github.com/UpayanGhosh/tldr-skill)
(`repo-tour/references/WRITING_GUIDE.md` and `SECTION_PROMPTS.md`), which is
Apache-2.0 licensed like WikiHub. Only the style rules are reused, reworded for
summarising a wiki page; none of its code, scripts or templates are included.
This note is the attribution Apache-2.0 asks for.

## Everything else

The remaining backend and frontend dependencies are MIT, BSD, Apache-2.0 or
ISC. Two worth naming because they are unusual shapes rather than unusual
licences:

- **pandoc** (GPL-2.0-or-later) is installed as a *binary* in
  `deploy/docker/backend.Dockerfile` and invoked as a subprocess. It is not
  linked into WikiHub, so the GPL does not reach WikiHub's own code. Keep it
  that way: call it over a process boundary, never through a Haskell FFI or a
  GPL-licensed Python binding.
- **nh3** (MIT) bundles the Rust `ammonia` and `html5ever` crates, which are
  MIT/Apache-2.0 dual-licensed.

## Containerised infrastructure services (`docker-compose*.yml`)

The Compose files start companion services alongside WikiHub over network
protocols (HTTP, S3 REST, Redis TCP, PostgreSQL wire protocol). Because WikiHub
communicates with them strictly over network boundaries and neither links nor
modifies their source code, their licences do not govern WikiHub's own repository
code. Keep these obligations in mind if packaging a commercial appliance or
offering a hosted SaaS:

- **ONLYOFFICE Document Server** (`onlyoffice/documentserver`, **AGPL-3.0**) —
  runs as a standalone container integrated via browser iframe + signed JWT
  callbacks. Modifying the Document Server image or bundling it into a
  proprietary redistributable installer requires either complying with AGPL-3.0
  for that component or obtaining a commercial licence from Ascensio System SIA.
- **MinIO** (`bitnamilegacy/minio`, **AGPL-3.0**) — used for local S3-compatible
  storage in Compose. Production deployments can substitute any S3-compatible
  object store (AWS S3, Cloudflare R2, Ceph RGW, SeaweedFS, Garage) via
  `WIKIHUB_S3_*` environment variables without code changes.
- **Redis 7.4** (`redis:7.4-alpine`, dual-licensed **RSALv2 / SSPLv1**) —
  permissible for self-hosted deployments and as an internal cache/queue backing
  an application, provided Redis itself is not offered as a managed database
  service to third parties. For a strictly OSI-approved BSD-3-Clause deployment,
  `redis:7.2-alpine` or `valkey/valkey:8-alpine` is a drop-in replacement.
- **PostgreSQL 16 + pgvector** (`pgvector/pgvector:0.8.1-pg16-bookworm`,
  **PostgreSQL Licence**) — permissive, OSI-approved.
