# Third-party licensing notes

WikiHub itself is Apache-2.0 (`backend/pyproject.toml`). Most dependencies are
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
