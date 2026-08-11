#!/usr/bin/env bash
# =============================================================================
# WikiHub - start the whole stack with one command.
#
# QUICK START
#   ./scripts/run.sh --dev        day-to-day development (hot reload)
#   ./scripts/run.sh              production-like run (built images, no reload)
#
#   Then open http://localhost:3000 and sign in with the bootstrap account
#   (default admin / admin123, configurable via WIKIHUB_ADMIN_* in .env).
#
# OPTIONS
#   --dev            Hot reload. Mounts backend/ and frontend/ into the
#                    containers and runs uvicorn --reload, arq --watch and
#                    next dev, so a code edit applies with no rebuild.
#                    Layers docker-compose.dev.yml over docker-compose.yml.
#   --fresh          docker compose down -v first. DESTROYS every volume:
#                    database, Redis and uploaded attachments all go.
#   --rebuild        Rebuild images from scratch (--no-cache). Needed after a
#                    dependency change: pyproject.toml or package.json.
#   --no-build       Skip building entirely and reuse existing images. Fastest
#                    way back up when nothing has changed.
#   --logs           Tail the logs once everything is healthy.
#   --stop           Stop the stack and exit. Volumes are kept.
#   --timeout <sec>  How long to wait for health checks (default 240). Raise it
#                    on a slow machine or a cold first build.
#   -h, --help       Print the option list.
#
# COMMON WORKFLOWS
#   First run / after a git pull ....... ./scripts/run.sh --dev
#   Back up quickly, nothing changed ... ./scripts/run.sh --dev --no-build
#   Added a dependency ................. ./scripts/run.sh --dev --rebuild
#   Database is in a bad state ......... ./scripts/run.sh --dev --fresh
#   Watch what is happening ............ ./scripts/run.sh --dev --logs
#   Done for the day ................... ./scripts/run.sh --stop
#
# WHAT IT DOES, IN ORDER
#   1. Verifies docker, the compose plugin and a reachable daemon.
#   2. Creates .env from .env.example when missing. An existing .env is NEVER
#      overwritten - your local ports and secrets are safe.
#   3. Checks the host ports in .env are free, ignoring ports this stack itself
#      already holds, and aborts with the offending variable names if not.
#   4. Builds images and starts every service.
#   5. Waits for postgres, redis, minio, backend, worker and frontend to report
#      healthy, printing each one as it comes up. On failure it dumps that
#      service's last 40 log lines instead of hanging.
#   6. Applies Alembic migrations (alembic upgrade head).
#   7. Seeds the protected bootstrap administrator. Idempotent: an existing
#      account is left alone and its password is never rewritten.
#   8. Prints the URLs, reading the real ports back out of .env.
#
# The script is idempotent: running it twice is safe and only reconciles what
# has drifted.
#
# NOTE ON MODE SWITCHING
#   --dev and the default mode produce different containers, so switching
#   between them recreates the affected services. That is expected; volumes and
#   therefore your data survive it.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/.env"
ENV_TEMPLATE="$ROOT/.env.example"
DEV_OVERLAY="$ROOT/docker-compose.dev.yml"
COMPOSE=(docker compose)

# --- options ----------------------------------------------------------------
DO_BUILD=1
FORCE_BUILD=0
FRESH=0
FOLLOW_LOGS=0
STOP_ONLY=0
DEV_MODE=0
HEALTH_TIMEOUT=240

# --- output helpers ---------------------------------------------------------
if [[ -t 1 ]]; then
    BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'
    YELLOW=$'\033[33m'; BLUE=$'\033[34m'; DIM=$'\033[2m'; RESET=$'\033[0m'
    CLEAR_LINE=$'\033[2K'
else
    # Piped or redirected: emit no escapes at all, so logs stay greppable.
    BOLD=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; DIM=""; RESET=""
    CLEAR_LINE=""
fi

step() { printf '\n%s==>%s %s%s%s\n' "$BLUE" "$RESET" "$BOLD" "$*" "$RESET"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
die()  { printf '\n%serror:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

usage() {
    cat <<'EOF'
WikiHub - start the whole stack with one command.

Usage:
  ./scripts/run.sh --dev        development: hot reload for backend + frontend
  ./scripts/run.sh              production-like: built images, no reload

Then open http://localhost:3000 and sign in with the bootstrap account
(default admin / admin123, set via WIKIHUB_ADMIN_* in .env).

Options:
  --dev            Hot reload. Bind-mounts backend/ and frontend/ and runs
                   uvicorn --reload, arq --watch and next dev, so an edit
                   applies with no rebuild.
  --fresh          docker compose down -v first. DESTROYS every volume:
                   database, Redis and uploaded attachments.
  --rebuild        Rebuild images from scratch. Needed after a dependency
                   change (pyproject.toml / package.json).
  --no-build       Skip building; reuse existing images. Fastest restart.
  --logs           Tail the logs once the stack is healthy.
  --stop           Stop the stack and exit. Volumes are kept.
  --timeout <sec>  How long to wait for health checks (default: 240).
  -h, --help       Show this help.

Common workflows:
  First run / after a git pull ....... ./scripts/run.sh --dev
  Back up quickly, nothing changed ... ./scripts/run.sh --dev --no-build
  Added a dependency ................. ./scripts/run.sh --dev --rebuild
  Database is in a bad state ......... ./scripts/run.sh --dev --fresh
  Done for the day ................... ./scripts/run.sh --stop

The script runs migrations and seeds the bootstrap admin for you. It is
idempotent, and it never overwrites an existing .env.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dev)      DEV_MODE=1 ;;
        --fresh)    FRESH=1 ;;
        --rebuild)  FORCE_BUILD=1 ;;
        --no-build) DO_BUILD=0 ;;
        --logs)     FOLLOW_LOGS=1 ;;
        --stop)     STOP_ONLY=1 ;;
        --timeout)  HEALTH_TIMEOUT="${2:?--timeout needs a value}"; shift ;;
        -h|--help)  usage; exit 0 ;;
        *)          die "unknown option: $1  (try --help)" ;;
    esac
    shift
done

# Dev mode layers the hot-reload overlay on top of the base compose file. Every
# later command reuses this array, so the two modes stay in lockstep.
if [[ $DEV_MODE -eq 1 ]]; then
    [[ -f "$DEV_OVERLAY" ]] || die "docker-compose.dev.yml is missing."
    COMPOSE=(docker compose -f "$ROOT/docker-compose.yml" -f "$DEV_OVERLAY")
fi

# --- 1. preflight -----------------------------------------------------------
step "Checking prerequisites"

command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH."
docker compose version >/dev/null 2>&1 \
    || die "'docker compose' (v2) is unavailable. Install the Compose plugin."
docker info >/dev/null 2>&1 \
    || die "the Docker daemon is not reachable. Start Docker and retry."
ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?') with compose plugin"

if [[ $STOP_ONLY -eq 1 ]]; then
    step "Stopping WikiHub"
    "${COMPOSE[@]}" down
    ok "stopped (data volumes kept - use --fresh to wipe them)"
    exit 0
fi

# --- 2. environment file ----------------------------------------------------
step "Preparing environment"

if [[ ! -f "$ENV_FILE" ]]; then
    [[ -f "$ENV_TEMPLATE" ]] || die ".env.example is missing; cannot create .env."
    cp "$ENV_TEMPLATE" "$ENV_FILE"
    ok "created .env from .env.example"
    warn "it ships development-only credentials - never deploy this file as-is"
else
    ok ".env already present (left untouched)"
fi

# Read a key from .env, stripping inline comments, quotes and stray whitespace.
env_get() {
    local key="$1" fallback="${2-}" value
    value="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null | tail -n1 || true)"
    value="${value#*=}"
    value="$(printf '%s' "$value" | sed -E 's/[[:space:]]+#.*$//; s/^[[:space:]]*//; s/[[:space:]]*$//; s/^["'"'"']//; s/["'"'"']$//')"
    printf '%s' "${value:-$fallback}"
}

FRONTEND_PORT="$(env_get FRONTEND_PORT_HOST 3000)"
BACKEND_PORT="$(env_get BACKEND_PORT_HOST 8000)"
POSTGRES_PORT="$(env_get POSTGRES_PORT_HOST 5432)"
REDIS_PORT="$(env_get REDIS_PORT_HOST 6379)"
MINIO_PORT="$(env_get MINIO_PORT_HOST 9000)"
MINIO_CONSOLE_PORT="$(env_get MINIO_CONSOLE_PORT_HOST 9001)"

# --- 3. host port conflicts -------------------------------------------------
# Ports already published by *our own* project are not conflicts - that is just
# a stack that is already running and about to be reconciled.
step "Checking host ports"

owned_ports="$("${COMPOSE[@]}" ps --format json 2>/dev/null \
    | python3 -c '
import json, sys
out = set()
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        row = json.loads(line)
    except ValueError:
        continue
    for pub in row.get("Publishers") or []:
        port = pub.get("PublishedPort")
        if port:
            out.add(str(port))
print(" ".join(sorted(out)))
' 2>/dev/null || true)"

listening="$(ss -ltnH 2>/dev/null | awk '{print $4}' | sed 's/.*://' | sort -u || true)"

conflicts=()
for entry in "FRONTEND_PORT_HOST:$FRONTEND_PORT" "BACKEND_PORT_HOST:$BACKEND_PORT" \
             "POSTGRES_PORT_HOST:$POSTGRES_PORT" "REDIS_PORT_HOST:$REDIS_PORT" \
             "MINIO_PORT_HOST:$MINIO_PORT" "MINIO_CONSOLE_PORT_HOST:$MINIO_CONSOLE_PORT"; do
    name="${entry%%:*}"; port="${entry##*:}"
    [[ " $owned_ports " == *" $port "* ]] && continue
    if printf '%s\n' "$listening" | grep -qx "$port"; then
        conflicts+=("$name=$port")
    fi
done

if [[ ${#conflicts[@]} -gt 0 ]]; then
    printf '\n%serror:%s these host ports are already taken by something else:\n' "$RED" "$RESET" >&2
    for c in "${conflicts[@]}"; do printf '    %s\n' "$c" >&2; done
    printf '\n  Edit %s and pick free ports. If you change BACKEND_PORT_HOST or\n' "$ENV_FILE" >&2
    printf '  MINIO_PORT_HOST, update NEXT_PUBLIC_API_BASE_URL / \n' >&2
    printf '  WIKIHUB_S3_PUBLIC_ENDPOINT_URL to match - the browser needs the\n' >&2
    printf '  host-visible URL.\n' >&2
    exit 1
fi
ok "no conflicts on ${FRONTEND_PORT}, ${BACKEND_PORT}, ${POSTGRES_PORT}, ${REDIS_PORT}, ${MINIO_PORT}, ${MINIO_CONSOLE_PORT}"

# --- 4. optional clean slate ------------------------------------------------
if [[ $FRESH -eq 1 ]]; then
    step "Removing containers and data volumes (--fresh)"
    "${COMPOSE[@]}" down -v --remove-orphans
    ok "volumes removed"
fi

# --- 5. start ---------------------------------------------------------------
step "Starting services"

up_args=(up -d --remove-orphans)
if [[ $DO_BUILD -eq 1 ]]; then
    up_args+=(--build)
    [[ $FORCE_BUILD -eq 1 ]] && "${COMPOSE[@]}" build --no-cache
fi
"${COMPOSE[@]}" "${up_args[@]}"

# --- 6. wait for health -----------------------------------------------------
# minio-init is a one-shot bucket bootstrapper: it is expected to exit 0 and is
# therefore judged on exit code, not on health.
step "Waiting for services to become healthy"

export WIKIHUB_SERVICES="postgres redis minio backend worker frontend"
deadline=$(( SECONDS + HEALTH_TIMEOUT ))
declare -A reported=()

# Emits shell assignments (READY_LIST / PENDING_LIST / UNHEALTHY_LIST) from the
# compose JSONL status. Services are passed via the environment so no shell
# value is ever interpolated into the Python source.
read -r -d '' PY_HEALTH <<'PYEOF' || true
import json, os, sys

want = set(os.environ["WIKIHUB_SERVICES"].split())
state = {}
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        row = json.loads(line)
    except ValueError:
        continue
    svc = row.get("Service")
    if svc not in want:
        continue
    health = (row.get("Health") or "").lower()
    running = (row.get("State") or "").lower() == "running"
    if health:
        state[svc] = health if health != "starting" else "starting"
    else:
        state[svc] = "healthy" if running else (row.get("State") or "missing").lower()

ready = [s for s in want if state.get(s) == "healthy"]
unhealthy = [s for s in want if state.get(s) == "unhealthy"]
pending = sorted(s for s in want if s not in ready and s not in unhealthy)

print("READY_LIST=%s" % json.dumps(" ".join(sorted(ready))))
print("PENDING_LIST=%s" % json.dumps(" ".join(pending)))
print("UNHEALTHY_LIST=%s" % json.dumps(" ".join(sorted(unhealthy))))
PYEOF

while :; do
    status_json="$("${COMPOSE[@]}" ps --format json 2>/dev/null || true)"

    eval "$(printf '%s' "$status_json" | python3 -c "$PY_HEALTH" 2>/dev/null \
        || printf 'READY_LIST="" PENDING_LIST="starting" UNHEALTHY_LIST=""\n')"

    for svc in $READY_LIST; do
        if [[ -z "${reported[$svc]:-}" ]]; then
            reported[$svc]=1
            ok "$svc"
        fi
    done

    if [[ -n "$UNHEALTHY_LIST" ]]; then
        printf '\n%serror:%s unhealthy: %s\n' "$RED" "$RESET" "$UNHEALTHY_LIST" >&2
        for svc in $UNHEALTHY_LIST; do
            printf '\n%s--- last 40 log lines: %s ---%s\n' "$DIM" "$svc" "$RESET" >&2
            "${COMPOSE[@]}" logs --tail=40 "$svc" >&2 || true
        done
        exit 1
    fi

    [[ -z "$PENDING_LIST" ]] && break

    if (( SECONDS >= deadline )); then
        printf '\n%serror:%s timed out after %ss waiting for: %s\n' \
            "$RED" "$RESET" "$HEALTH_TIMEOUT" "$PENDING_LIST" >&2
        printf '  Inspect with:  docker compose logs -f %s\n' "${PENDING_LIST%% *}" >&2
        exit 1
    fi

    if [[ -n "$CLEAR_LINE" ]]; then
        printf '  %swaiting: %s%s\r' "$DIM" "$PENDING_LIST" "$RESET"
    fi
    sleep 3
done
printf '%s' "$CLEAR_LINE"

# minio-init must have completed cleanly, otherwise uploads fail later.
init_exit="$("${COMPOSE[@]}" ps -a --format json 2>/dev/null \
    | python3 -c '
import json, sys
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        row = json.loads(line)
    except ValueError:
        continue
    if row.get("Service") == "minio-init":
        print(row.get("ExitCode", 0))
        break
' 2>/dev/null || echo 0)"
if [[ "${init_exit:-0}" != "0" ]]; then
    warn "minio-init exited with code $init_exit - the attachment bucket may be missing"
    warn "inspect with: docker compose logs minio-init"
else
    ok "minio-init (bucket ready)"
fi

# --- 7. database schema + bootstrap account ---------------------------------
step "Applying database migrations"

if [[ -f "$ROOT/backend/alembic.ini" ]]; then
    if migrate_output="$("${COMPOSE[@]}" exec -T backend alembic upgrade head 2>&1)"; then
        applied="$(printf '%s' "$migrate_output" | grep -c 'Running upgrade' || true)"
        if [[ "${applied:-0}" -gt 0 ]]; then
            ok "applied ${applied} migration(s); schema is at head"
        else
            ok "schema already at head"
        fi
    else
        printf '%s\n' "$migrate_output" >&2
        die "alembic upgrade failed - see the output above"
    fi
else
    warn "skipped: backend/alembic.ini does not exist yet"
fi

# Idempotent: creates the protected superadmin on first run, no-ops afterwards
# and never rewrites an existing account's password.
step "Seeding the bootstrap administrator"

if [[ -f "$ROOT/backend/scripts/seed.py" ]]; then
    if seed_output="$("${COMPOSE[@]}" exec -T backend python -m scripts.seed 2>&1)"; then
        printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$(printf '%s' "$seed_output" | grep -E 'superadmin' | tail -1)"
        if printf '%s' "$seed_output" | grep -q "WARNING"; then
            warn "default password in use - change WIKIHUB_ADMIN_PASSWORD before exposing this instance"
        fi
    else
        printf '%s' "$seed_output" >&2
        die "seeding failed - see the output above"
    fi
else
    warn "skipped: backend/scripts/seed.py does not exist yet"
fi

# --- 8. summary -------------------------------------------------------------
if [[ $DEV_MODE -eq 1 ]]; then
    step "WikiHub is up (DEV MODE - hot reload)"
else
    step "WikiHub is up"
fi

cat <<EOF

  ${BOLD}Frontend${RESET}      http://localhost:${FRONTEND_PORT}
  ${BOLD}API docs${RESET}      http://localhost:${BACKEND_PORT}/docs
  ${BOLD}Health${RESET}        http://localhost:${BACKEND_PORT}/health
  ${BOLD}MinIO console${RESET} http://localhost:${MINIO_CONSOLE_PORT}
  ${BOLD}PostgreSQL${RESET}    localhost:${POSTGRES_PORT}
  ${BOLD}Redis${RESET}         localhost:${REDIS_PORT}

  ${DIM}logs:${RESET}  docker compose logs -f
  ${DIM}stop:${RESET}  ./scripts/run.sh --stop
  ${DIM}reset:${RESET} ./scripts/run.sh --fresh

EOF

if [[ $DEV_MODE -eq 1 ]]; then
    cat <<EOF
  ${BOLD}Hot reload is active${RESET} - edits apply without a rebuild:
    backend/   -> uvicorn --reload
    worker     -> arq --watch
    frontend/  -> next dev --turbopack

  ${DIM}Rebuild is only needed when dependencies change${RESET}
  ${DIM}(pyproject.toml / package.json): ./scripts/run.sh --dev --rebuild${RESET}

EOF
fi

if [[ $FOLLOW_LOGS -eq 1 ]]; then
    exec "${COMPOSE[@]}" logs -f --tail=50
fi
