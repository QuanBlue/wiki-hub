.DEFAULT_GOAL := help
SHELL := /bin/bash

COMPOSE ?= docker compose
BACKEND_DIR := backend
FRONTEND_DIR := frontend
VENV := $(BACKEND_DIR)/.venv
PY := $(VENV)/bin/python
PIP := $(VENV)/bin/pip

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------
.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_.-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
.env: ## Create .env from .env.example if missing
	@test -f .env || (cp .env.example .env && echo "Created .env from .env.example")

.PHONY: env
env: .env ## Ensure .env exists

# ---------------------------------------------------------------------------
# Docker Compose
# ---------------------------------------------------------------------------
.PHONY: run
run: ## Start everything with one command (build, wait for health, migrate)
	./scripts/run.sh

.PHONY: fresh
fresh: ## Wipe all data volumes and start clean
	./scripts/run.sh --fresh

.PHONY: up
up: env ## Start the whole stack in the background (no health wait)
	$(COMPOSE) up -d --build

.PHONY: deps
deps: env ## Start only infrastructure (postgres, redis, minio)
	$(COMPOSE) up -d postgres redis minio minio-init

.PHONY: down
down: ## Stop the stack (keeps volumes)
	$(COMPOSE) down

.PHONY: clean
clean: ## Stop the stack and DELETE all data volumes
	$(COMPOSE) down -v

.PHONY: logs
logs: ## Tail all service logs
	$(COMPOSE) logs -f --tail=100

.PHONY: ps
ps: ## Show service status
	$(COMPOSE) ps

.PHONY: restart
restart: ## Rebuild and restart backend + worker
	$(COMPOSE) up -d --build backend worker

# ---------------------------------------------------------------------------
# Backend (local, outside Docker)
# ---------------------------------------------------------------------------
$(VENV): ## Create the backend virtualenv
	python3 -m venv $(VENV)
	$(PIP) install --upgrade pip

.PHONY: install
install: $(VENV) ## Install backend dependencies locally
	$(PIP) install -e "$(BACKEND_DIR)[dev]"

.PHONY: install-frontend
install-frontend: ## Install frontend dependencies
	cd $(FRONTEND_DIR) && npm install

.PHONY: dev-backend
dev-backend: ## Run the API with autoreload (needs `make deps`)
	cd $(BACKEND_DIR) && ../$(VENV)/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

.PHONY: dev-worker
dev-worker: ## Run the background worker locally
	cd $(BACKEND_DIR) && ../$(VENV)/bin/arq app.workers.settings.WorkerSettings

.PHONY: dev-frontend
dev-frontend: ## Run the Next.js dev server
	cd $(FRONTEND_DIR) && npm run dev

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
.PHONY: migrate
migrate: ## Apply all migrations inside the backend container
	$(COMPOSE) run --rm backend alembic upgrade head

.PHONY: migrate-local
migrate-local: ## Apply all migrations from the host venv
	cd $(BACKEND_DIR) && ../$(VENV)/bin/alembic upgrade head

.PHONY: migration
migration: ## Autogenerate a migration:  make migration m="add pages"
	cd $(BACKEND_DIR) && ../$(VENV)/bin/alembic revision --autogenerate -m "$(m)"

.PHONY: downgrade
downgrade: ## Roll back one migration
	cd $(BACKEND_DIR) && ../$(VENV)/bin/alembic downgrade -1

.PHONY: seed
seed: ## Seed admin user + demo content
	$(COMPOSE) run --rm backend python -m scripts.seed

.PHONY: psql
psql: ## Open a psql shell
	$(COMPOSE) exec postgres psql -U wikihub -d wikihub

# ---------------------------------------------------------------------------
# Quality gates
# ---------------------------------------------------------------------------
.PHONY: test
test: ## Run backend tests
	cd $(BACKEND_DIR) && ../$(VENV)/bin/pytest -q

.PHONY: test-frontend
test-frontend: ## Run frontend unit/component tests
	cd $(FRONTEND_DIR) && npm run test -- --run

.PHONY: test-all
test-all: ## Run every test suite with a coverage report
	./scripts/test.sh

.PHONY: coverage
coverage: ## Run every suite and open the HTML coverage reports
	./scripts/test.sh --open

.PHONY: e2e
e2e: ## Run Playwright end-to-end tests
	cd $(FRONTEND_DIR) && npx playwright test

.PHONY: lint
lint: ## Lint backend + frontend
	cd $(BACKEND_DIR) && ../$(VENV)/bin/ruff check app tests scripts \
		&& ../$(VENV)/bin/ruff format --check app tests scripts
	cd $(FRONTEND_DIR) && npm run lint

.PHONY: format
format: ## Auto-format backend + frontend
	cd $(BACKEND_DIR) && ../$(VENV)/bin/ruff check --fix app tests scripts \
		&& ../$(VENV)/bin/ruff format app tests scripts
	cd $(FRONTEND_DIR) && npm run format

.PHONY: typecheck
typecheck: ## Type-check backend + frontend
	cd $(BACKEND_DIR) && ../$(VENV)/bin/mypy app scripts
	cd $(FRONTEND_DIR) && npx tsc --noEmit

.PHONY: check
check: lint typecheck test ## Run every quality gate

.PHONY: openapi
openapi: ## Write the OpenAPI schema to docs/openapi.json
	cd $(BACKEND_DIR) && ../$(VENV)/bin/python -m scripts.gen_openapi ../docs/openapi.json
