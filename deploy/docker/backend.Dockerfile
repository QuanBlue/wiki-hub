# syntax=docker/dockerfile:1.7
# =============================================================================
# WikiHub API + background worker
#
# One image, two entrypoints: `uvicorn app.main:app` and
# `arq app.workers.settings.WorkerSettings`. The worker is part of the modular
# monolith, so it must never drift from the API's code or dependencies.
# =============================================================================

# --- build stage: compile wheels so the runtime image needs no toolchain -----
FROM python:3.12-slim-trixie AS builder

# Unlike the runtime stage, this one deliberately does NOT set
# PIP_NO_CACHE_DIR: downloads go into the BuildKit cache mount on the pip step
# below, which lives outside the image and so costs the final image nothing.
# On a slow or lossy link that cache is what makes a failed build cheap to
# retry - every wheel that already came down is reused instead of re-fetched.
#
# The retry/timeout bumps exist for the same reason. pip's defaults assume a
# healthy connection; at ~100 kB/s one stalled read raises `IncompleteRead`
# and kills the build after minutes of otherwise fine downloading.
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_RETRIES=10 \
    PIP_TIMEOUT=120

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY backend/pyproject.toml backend/README.md ./
# A stub package is enough for setuptools to resolve the project metadata; the
# real source is mounted/copied at runtime, which keeps this layer cached across
# every source change and only re-runs when dependencies actually move.
RUN mkdir -p app && touch app/__init__.py

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
# `--resume-retries` is the one that matters on a lossy link: PIP_RETRIES only
# covers failures to *establish* a request, so a transfer that dies part-way
# through the body surfaces as `OSError: Connection broken: IncompleteRead` and
# fails the build outright. It exists only in pip >= 25.1, which is why it is
# passed here rather than as a PIP_* env var - the distro pip on the line above
# is older and rejects options it does not know.
#
# The loop is the backstop for everything resume cannot rescue (a dropped
# connection to the index, a DNS blip). Each attempt starts from the cache
# mount, so a retry re-fetches only what is still missing.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip setuptools wheel \
    && installed=0 \
    && for attempt in 1 2 3 4 5; do \
         if pip install --resume-retries 5 .; then installed=1; break; fi; \
         echo "pip install attempt $attempt failed; retrying in 5s"; \
         sleep 5; \
       done \
    && [ "$installed" = 1 ] \
    # Keep the resolved dependencies, drop the stub project itself so the only
    # importable `app` package is the real source tree at /app.
    && pip uninstall -y wikihub

# --- runtime stage -----------------------------------------------------------
FROM python:3.12-slim-trixie AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PATH="/opt/venv/bin:$PATH" \
    # Page export launches a real Chromium to render the app's real CSS
    # instead of a second, hand-maintained stylesheet (see
    # app/services/browser.py). Installed under a fixed, world-readable path
    # rather than the default `~/.cache/ms-playwright` - that default resolves
    # under /root at install time (this stage still runs as root here) and
    # would be unreadable once the process drops to the non-root `wikihub`
    # user below.
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright

# Base-image security patches, then:
#   - libpq + curl: asyncpg fallback / container healthcheck (unchanged)
#   - fonts-*: Chromium needs real fonts to render text at all; emoji in page
#     content would render as tofu without fonts-noto-color-emoji
# WeasyPrint's native libs (libcairo2/libpango/libgdk-pixbuf/libffi/libjpeg)
# are gone along with the WeasyPrint-based PDF export they existed for.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends \
        libpq5 curl fonts-dejavu-core fonts-liberation2 fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin wikihub

COPY --from=builder /opt/venv /opt/venv

# Chromium + its OS-level dependencies, for page export. Must run as root
# (installs system packages), and must come before the pip-strip block below
# needs `playwright` importable, which it already is via the copied venv.
ARG PANDOC_VERSION=3.5
RUN /opt/venv/bin/playwright install --with-deps chromium \
    && chmod -R a+rX /opt/playwright \
    # Word export converts the captured page snapshot with pandoc. The
    # official .deb (pinned + checksummed) over Debian's apt package: it is
    # self-contained, needs no Haskell runtime pulled in from apt, and is a
    # current release with better HTML-reader/skylighting behaviour.
    # --retry for the same reason pip gets PIP_RETRIES above; --retry-all-errors
    # because a truncated transfer is not one of the statuses --retry covers.
    && curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors \
        -o /tmp/pandoc.deb \
        "https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-1-amd64.deb" \
    && dpkg -i /tmp/pandoc.deb \
    && rm -f /tmp/pandoc.deb \
    && rm -rf /var/lib/apt/lists/*

# Strip the packaging toolchain from the runtime image. It is not needed to run
# the app, and leaving it in ships pip's vendored dependencies plus setuptools
# into production - a steady source of scanner findings and a way for an
# attacker with code execution to install more software.
RUN python -m pip uninstall -y pip setuptools wheel 2>/dev/null || true \
    && /opt/venv/bin/python -m pip uninstall -y pip setuptools wheel 2>/dev/null || true \
    && rm -rf /opt/venv/lib/python3.12/site-packages/pip* \
              /opt/venv/lib/python3.12/site-packages/setuptools* \
              /opt/venv/lib/python3.12/site-packages/pkg_resources \
              /usr/local/lib/python3.12/site-packages/pip* \
              /usr/local/lib/python3.12/site-packages/setuptools* \
              /usr/local/lib/python3.12/site-packages/pkg_resources \
              /usr/local/bin/pip /usr/local/bin/pip3 /usr/local/bin/pip3.12

WORKDIR /app
COPY --chown=wikihub:wikihub backend/ /app/

USER wikihub
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
