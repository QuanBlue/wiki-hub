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

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

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
RUN pip install --upgrade pip setuptools wheel \
    && pip install . \
    # Keep the resolved dependencies, drop the stub project itself so the only
    # importable `app` package is the real source tree at /app.
    && pip uninstall -y wikihub

# --- runtime stage -----------------------------------------------------------
FROM python:3.12-slim-trixie AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PATH="/opt/venv/bin:$PATH"

# Base-image security patches, then libpq for asyncpg's fallbacks and curl for
# the container healthcheck.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends \
        libpq5 curl fonts-dejavu-core libcairo2 libpango-1.0-0 libpangoft2-1.0-0 \
        libgdk-pixbuf-2.0-0 libffi8 libjpeg62-turbo \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin wikihub

COPY --from=builder /opt/venv /opt/venv

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
