#!/usr/bin/env bash
# =============================================================================
# WikiHub - run the test suites and report coverage.
#
# QUICK START
#   ./scripts/test.sh              everything, with a coverage summary
#   ./scripts/test.sh --unit       fast pass, no database needed
#   ./scripts/test.sh --html       same, plus browsable HTML reports
#
# OPTIONS
#   --backend        Backend (pytest) only.
#   --frontend       Frontend (vitest) only.
#   --unit           Skip the integration tests, which need PostgreSQL.
#                    Fast, but coverage will be markedly lower - the service
#                    layer is exercised almost entirely by integration tests.
#   --html           Also write HTML reports and print their paths.
#   --open           Imply --html and open the reports in a browser.
#   --watch          Re-run on file change. Implies --no-cov and a single
#                    suite: pass --backend or --frontend with it.
#   --no-cov         Skip coverage measurement (a little faster).
#   --fail-under N   Fail if backend line coverage is under N percent.
#                    Applies to the backend only; vitest thresholds live in
#                    vitest.config.ts.
#   -k EXPR          Passed through to pytest to select tests by name.
#   -- <args...>     Everything after -- goes to the underlying test runner.
#   -h, --help       Print this list.
#
# COMMON WORKFLOWS
#   Quick check while coding ......... ./scripts/test.sh --unit
#   Full run before a commit ......... ./scripts/test.sh
#   "What is actually untested?" ..... ./scripts/test.sh --open
#   Iterate on one test .............. ./scripts/test.sh --backend --watch -- -k backup
#   CI-style gate .................... ./scripts/test.sh --fail-under 75
#
# ABOUT THE DATABASE
#   Integration tests need PostgreSQL. This script finds one in three steps:
#     1. WIKIHUB_TEST_DATABASE_URL from your environment, if set.
#     2. The compose `postgres` service, if it is running. The script then
#        creates a SEPARATE `<db>_test` database and points the tests at it,
#        so a leaked fixture can never write into your development data.
#     3. Nothing - the integration tests skip themselves and the script says
#        so loudly, because skipped tests silently deflate coverage.
#
#   Start the database on its own with:  make deps
#
# READING THE NUMBERS
#   The backend percentage covers app/ (excluding migrations). The frontend
#   percentage covers app/, components/, hooks/, lib/ and middleware.ts with
#   `all: true`, so files no test imports are counted as 0% rather than being
#   left out of the denominator. Server components are mostly reached through
#   Playwright (`make e2e`), which is NOT part of this script and NOT part of
#   this number - expect the frontend figure to be the lower of the two.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/.env"
VENV="$ROOT/backend/.venv"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"

# --- options ----------------------------------------------------------------
RUN_BACKEND=1
RUN_FRONTEND=1
EXPLICIT_SUITE=0
UNIT_ONLY=0
WANT_HTML=0
OPEN_REPORT=0
WATCH=0
COVERAGE=1
FAIL_UNDER=""
PYTEST_K=""
EXTRA_ARGS=()

# --- output helpers ---------------------------------------------------------
if [[ -t 1 ]]; then
    BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'
    YELLOW=$'\033[33m'; BLUE=$'\033[34m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
    BOLD=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; DIM=""; RESET=""
fi

step() { printf '\n%s==>%s %s%s%s\n' "$BLUE" "$RESET" "$BOLD" "$*" "$RESET"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
info() { printf '  %s%s%s\n' "$DIM" "$*" "$RESET"; }
die()  { printf '\n%serror:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

usage() {
    cat <<'EOF'
WikiHub - run the test suites and report coverage.

Usage:
  ./scripts/test.sh              everything, with a coverage summary
  ./scripts/test.sh --unit       fast pass, no database needed
  ./scripts/test.sh --html       same, plus browsable HTML reports

Options:
  --backend        Backend (pytest) only.
  --frontend       Frontend (vitest) only.
  --unit           Skip integration tests (they need PostgreSQL). Faster, but
                   coverage drops a lot: services are tested there.
  --html           Write HTML reports and print their paths.
  --open           Imply --html and open the reports in a browser.
  --watch          Re-run on change. Implies --no-cov; pick one suite.
  --no-cov         Skip coverage measurement.
  --fail-under N   Fail if backend line coverage is below N percent.
  -k EXPR          Select tests by name (pytest).
  -- <args...>     Pass the rest straight to pytest / vitest.
  -h, --help       Show this help.

Common workflows:
  Quick check while coding ......... ./scripts/test.sh --unit
  Full run before a commit ......... ./scripts/test.sh
  "What is actually untested?" ..... ./scripts/test.sh --open
  Iterate on one test .............. ./scripts/test.sh --backend --watch -- -k backup

Integration tests need PostgreSQL. Start it with `make deps`; this script then
uses a separate <db>_test database automatically. Without it those tests skip
and the coverage number is understated - the script warns when that happens.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --backend)    RUN_BACKEND=1; RUN_FRONTEND=0; EXPLICIT_SUITE=1 ;;
        --frontend)   RUN_FRONTEND=1; RUN_BACKEND=0; EXPLICIT_SUITE=1 ;;
        --unit)       UNIT_ONLY=1 ;;
        --html)       WANT_HTML=1 ;;
        --open)       WANT_HTML=1; OPEN_REPORT=1 ;;
        --watch)      WATCH=1; COVERAGE=0 ;;
        --no-cov)     COVERAGE=0 ;;
        --fail-under) FAIL_UNDER="${2:?--fail-under needs a percentage}"; shift ;;
        -k)           PYTEST_K="${2:?-k needs an expression}"; shift ;;
        --)           shift; EXTRA_ARGS=("$@"); break ;;
        -h|--help)    usage; exit 0 ;;
        *)            die "unknown option: $1  (try --help)" ;;
    esac
    shift
done

# Watch mode hands the terminal to a long-running process, so two of them would
# fight over stdin and neither would be usable.
if [[ $WATCH -eq 1 && $EXPLICIT_SUITE -eq 0 ]]; then
    die "--watch needs one suite: add --backend or --frontend."
fi

# --- 1. preflight -----------------------------------------------------------
step "Checking the toolchain"

if [[ $RUN_BACKEND -eq 1 ]]; then
    # Ensure backend container is running
    docker compose ps --status running --services 2>/dev/null | grep -qx backend \
        || die "The backend container is not running. Please start the stack first using 'make run'."
        
    # Check/install pytest in the container
    if ! docker compose exec -T backend python -c "import pytest" 2>/dev/null; then
        step "Installing test runner dependencies in the backend container..."
        docker compose exec -T --user root backend python -m ensurepip
        docker compose exec -T --user root backend python -m pip install pytest pytest-asyncio pytest-cov httpx faker
    fi
    ok "pytest is installed in container"
fi

if [[ $RUN_FRONTEND -eq 1 ]]; then
    # Ensure frontend container is running
    docker compose ps --status running --services 2>/dev/null | grep -qx frontend \
        || die "The frontend container is not running. Please start the stack first using 'make run'."
    ok "frontend container is running and ready"
fi

# --- 2. database for the integration tests ----------------------------------
# Only the backend needs this, and --unit opts out of it entirely.
INTEGRATION_READY=0
INTEGRATION_NOTE=""

env_get() {
    local key="$1" fallback="${2-}" value
    value="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null | tail -n1 || true)"
    value="${value#*=}"
    value="$(printf '%s' "$value" | sed -E 's/[[:space:]]+#.*$//; s/^[[:space:]]*//; s/[[:space:]]*$//; s/^["'"'"']//; s/["'"'"']$//')"
    printf '%s' "${value:-$fallback}"
}

if [[ $RUN_BACKEND -eq 1 && $UNIT_ONLY -eq 0 ]]; then
    step "Locating a PostgreSQL for the integration tests"

    if [[ -n "${WIKIHUB_TEST_DATABASE_URL:-}" ]]; then
        INTEGRATION_READY=1
        # Never print the URL: it carries the password.
        ok "using WIKIHUB_TEST_DATABASE_URL from the environment"

    elif [[ -f "$ENV_FILE" ]] \
        && docker compose ps --status running --services 2>/dev/null | grep -qx postgres; then

        PG_USER="$(env_get POSTGRES_USER wikihub)"
        PG_PASS="$(env_get POSTGRES_PASSWORD "")"
        PG_DB="$(env_get POSTGRES_DB wikihub)"
        PG_PORT="$(env_get POSTGRES_PORT_HOST 5432)"
        TEST_DB="${PG_DB}_test"

        # A dedicated database rather than the development one. The fixtures
        # already isolate themselves in a throwaway schema, but a bug in a
        # fixture then costs real data instead of nothing.
        if docker compose exec -T postgres \
            psql -U "$PG_USER" -d postgres -tAc \
            "SELECT 1 FROM pg_database WHERE datname='${TEST_DB}'" 2>/dev/null | grep -qx 1; then
            ok "test database ${TEST_DB} already exists"
        elif docker compose exec -T postgres \
            createdb -U "$PG_USER" -O "$PG_USER" "$TEST_DB" >/dev/null 2>&1; then
            ok "created test database ${TEST_DB}"
        else
            TEST_DB=""
            warn "could not create ${PG_DB}_test in the postgres container"
        fi

        if [[ -n "$TEST_DB" ]]; then
            # Inside the container, connect using internal 'postgres' host rather than localhost
            INTEGRATION_READY=1
            ok "integration tests will run against ${TEST_DB} inside compose network"
        fi
    fi

    if [[ $INTEGRATION_READY -eq 0 ]]; then
        INTEGRATION_NOTE="integration tests skipped - no PostgreSQL"
        warn "no database found; the integration tests will skip themselves"
        info "start one with 'make deps', then re-run for a truthful number"
    fi
fi

# --- 3. backend -------------------------------------------------------------
BACKEND_STATUS="skipped"
BACKEND_PCT=""

if [[ $RUN_BACKEND -eq 1 ]]; then
    step "Backend tests"

    PYTEST=(pytest)
    [[ -n "$PYTEST_K" ]] && PYTEST+=(-k "$PYTEST_K")
    [[ $UNIT_ONLY -eq 1 ]] && PYTEST+=(-m "not integration" --ignore=tests/integration)

    if [[ $COVERAGE -eq 1 ]]; then
        # Run inside container, paths are relative to /app
        PYTEST+=(--cov=app --cov-report=term-missing:skip-covered --cov-report=json:coverage.json)
        [[ $WANT_HTML -eq 1 ]] && PYTEST+=(--cov-report=html:htmlcov)
        [[ -n "$FAIL_UNDER" ]] && PYTEST+=(--cov-fail-under="$FAIL_UNDER")
    fi

    # -ra prints the reason for every skip, which is how you notice that the
    # integration tests opted out rather than passed.
    PYTEST+=(-ra)
    [[ $WATCH -eq 1 ]] && warn "pytest has no built-in watch mode; running once"
    PYTEST+=("${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}")

    # Set up environment args for database connection
    ENV_ARGS=()
    if [[ $INTEGRATION_READY -eq 1 ]]; then
        ENV_ARGS+=(-e WIKIHUB_TEST_DATABASE_URL="postgresql+asyncpg://${PG_USER}:${PG_PASS}@postgres:5432/${TEST_DB}")
    fi

    if docker compose exec -T "${ENV_ARGS[@]+"${ENV_ARGS[@]}"}" backend "${PYTEST[@]}"; then
        BACKEND_STATUS="passed"
    else
        BACKEND_STATUS="FAILED"
    fi

    if [[ $COVERAGE -eq 1 && -f "$BACKEND_DIR/coverage.json" ]]; then
        BACKEND_PCT="$(docker compose exec -T backend python - - <<'PY'
import json
try:
    with open("coverage.json") as fh:
        print(f"{json.load(fh)['totals']['percent_covered']:.1f}")
except (OSError, ValueError, KeyError):
    print("")
PY
        )"
    fi
fi

# --- 4. frontend ------------------------------------------------------------
FRONTEND_STATUS="skipped"
FRONTEND_PCT=""

if [[ $RUN_FRONTEND -eq 1 ]]; then
    step "Frontend tests"

    VITEST=(npx vitest)
    if [[ $WATCH -eq 1 ]]; then
        VITEST+=(watch)
    else
        VITEST+=(run)
        [[ $COVERAGE -eq 1 ]] && VITEST+=(--coverage)
    fi
    VITEST+=("${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}")

    if docker compose exec -T frontend "${VITEST[@]}"; then
        FRONTEND_STATUS="passed"
    else
        FRONTEND_STATUS="FAILED"
    fi

    if [[ $COVERAGE -eq 1 && -f "$FRONTEND_DIR/coverage/coverage-summary.json" ]]; then
        FRONTEND_PCT="$(docker compose exec -T frontend node -e '
          try {
            const t = require("./coverage/coverage-summary.json").total;
            process.stdout.write(t.lines.pct.toFixed(1));
          } catch { process.stdout.write(""); }
        ')"
    fi
fi

# --- 5. summary -------------------------------------------------------------
step "Summary"

report_line() {
    local name="$1" status="$2" pct="$3"
    local mark="$GREEN✓$RESET"
    [[ "$status" == "FAILED"  ]] && mark="$RED✗$RESET"
    [[ "$status" == "skipped" ]] && mark="$DIM-$RESET"
    printf '  %b %-10s %-8s %s\n' "$mark" "$name" "$status" \
        "${pct:+${BOLD}${pct}%${RESET} lines covered}"
}

report_line "backend"  "$BACKEND_STATUS"  "$BACKEND_PCT"
report_line "frontend" "$FRONTEND_STATUS" "$FRONTEND_PCT"

if [[ -n "$INTEGRATION_NOTE" ]]; then
    printf '\n'
    warn "$INTEGRATION_NOTE"
    info "the backend percentage above is lower than the suite can actually reach"
fi

if [[ $UNIT_ONLY -eq 1 ]]; then
    printf '\n'
    warn "--unit was used: integration tests did not run"
fi

if [[ $WANT_HTML -eq 1 ]]; then
    printf '\n'
    # Guarded on "did this suite run", not just "does the file exist": a report
    # left behind by an earlier run would otherwise be presented as this one's.
    BACKEND_REPORT=""
    FRONTEND_REPORT=""
    [[ $RUN_BACKEND -eq 1 && -f "$BACKEND_DIR/htmlcov/index.html" ]] \
        && BACKEND_REPORT="$BACKEND_DIR/htmlcov/index.html"
    [[ $RUN_FRONTEND -eq 1 && -f "$FRONTEND_DIR/coverage/index.html" ]] \
        && FRONTEND_REPORT="$FRONTEND_DIR/coverage/index.html"

    [[ -n "$BACKEND_REPORT"  ]] && info "backend report:  $BACKEND_REPORT"
    [[ -n "$FRONTEND_REPORT" ]] && info "frontend report: $FRONTEND_REPORT"

    if [[ $OPEN_REPORT -eq 1 ]]; then
        # wslview covers WSL, where xdg-open exists but does nothing useful.
        opener=""
        for candidate in wslview xdg-open open; do
            command -v "$candidate" >/dev/null 2>&1 && { opener="$candidate"; break; }
        done
        if [[ -n "$opener" ]]; then
            [[ -n "$BACKEND_REPORT"  ]] && { "$opener" "$BACKEND_REPORT"  >/dev/null 2>&1 || true; }
            [[ -n "$FRONTEND_REPORT" ]] && { "$opener" "$FRONTEND_REPORT" >/dev/null 2>&1 || true; }
        else
            warn "no browser opener found (tried wslview, xdg-open, open)"
        fi
    fi
fi

printf '\n'
if [[ "$BACKEND_STATUS" == "FAILED" || "$FRONTEND_STATUS" == "FAILED" ]]; then
    die "some tests failed (see the output above)"
fi
ok "all selected suites passed"
