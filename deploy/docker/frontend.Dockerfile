# syntax=docker/dockerfile:1.7
# =============================================================================
# WikiHub web frontend (Next.js standalone output)
# =============================================================================

FROM node:20-trixie-slim AS deps
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# --- build ------------------------------------------------------------------
FROM node:20-trixie-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ ./
# The PDF renderer loads this worker at runtime from /public. Copy it in the
# builder stage as well as postinstall so multi-stage builds cannot lose the
# generated asset from the dependency stage.
RUN node node_modules/@lamberl-lee/file-preview/scripts/copy-pdf-worker.mjs

# NEXT_PUBLIC_* values are inlined at build time. The API proxy destination is
# also resolved while Next.js builds, so keep the container-internal backend
# URL available here; browser requests themselves use the current origin.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ARG API_INTERNAL_BASE_URL=http://backend:8000
ARG NEXT_PUBLIC_SITE_NAME=WikiHub
ARG NEXT_PUBLIC_ONLYOFFICE_DOCUMENT_SERVER_URL=http://localhost:8080
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    API_INTERNAL_BASE_URL=$API_INTERNAL_BASE_URL \
    NEXT_PUBLIC_SITE_NAME=$NEXT_PUBLIC_SITE_NAME \
    NEXT_PUBLIC_ONLYOFFICE_DOCUMENT_SERVER_URL=$NEXT_PUBLIC_ONLYOFFICE_DOCUMENT_SERVER_URL

RUN npm run build

# --- dev ---------------------------------------------------------------------
# Hot-reload stage used by docker-compose.dev.yml. Source is bind-mounted over
# /app at runtime, so what matters here is node_modules plus the Next.js dev
# server; the COPY only seeds the image for a standalone run.
FROM node:20-trixie-slim AS dev
WORKDIR /app

ENV NODE_ENV=development \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ ./

EXPOSE 3000

# `next dev` compiles on first request, so allow a generous start period before
# the container is judged unhealthy.
HEALTHCHECK --interval=15s --timeout=10s --start-period=120s --retries=10 \
    CMD curl -fsS http://localhost:3000/ >/dev/null || exit 1

CMD ["npm", "run", "dev"]

# --- runtime ----------------------------------------------------------------
FROM node:20-trixie-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Pick up base-image security patches, install curl for the healthcheck, then
# delete npm: the standalone server runs with plain `node`, and npm's bundled
# dependency tree (tar, minimatch, cross-spawn, ...) is pure attack surface here.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm \
              /usr/local/bin/npm /usr/local/bin/npx /opt/yarn-*

# `output: "standalone"` emits a self-contained server with only the modules it
# actually imports - a much smaller attack surface than shipping node_modules.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -fsS http://localhost:3000/ >/dev/null || exit 1

CMD ["node", "server.js"]
