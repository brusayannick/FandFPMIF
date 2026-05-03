.DEFAULT_GOAL := help
.PHONY: help install dev dev-api dev-web up up-dev down build test typecheck fmt clean codegen

# Tab indentation is required for Make recipes.

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nFlows & Funds — common tasks\n\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

install: ## Resolve all deps (uv + pnpm)
	uv sync --extra dev
	pnpm install

dev: ## Run the API and the web dev server together (no docker)
	@trap 'kill 0' INT; \
	(uv run uvicorn flows_funds.api.main:app --reload --app-dir apps/api/src --host 127.0.0.1 --port 8000) & \
	(cd apps/web && pnpm dev) & \
	wait

dev-api: ## Run only the API (with --reload)
	uv run alembic -c apps/api/alembic.ini upgrade head
	uv run uvicorn flows_funds.api.main:app --reload --app-dir apps/api/src --host 127.0.0.1 --port 8000

dev-web: ## Run only the web dev server
	cd apps/web && pnpm dev

up: ## docker compose up (production-style images)
	docker compose up -d --build

up-dev: ## docker compose with the dev overlay (uvicorn --reload + next dev)
	docker compose -f docker-compose.yml -f compose.dev.yml up --build

down: ## Stop the compose stack
	docker compose down

build: ## Build both Docker images
	docker compose build

test: ## Run the Python test suite
	uv run --extra dev pytest apps/api/tests -v

typecheck: ## Type-check the web app
	cd apps/web && pnpm typecheck

fmt: ## Format Python with ruff
	uv run ruff check --fix .
	uv run ruff format .

codegen: ## Regenerate TS types from the running API's /openapi.json
	cd apps/web && pnpm codegen

clean: ## Wipe local data — irrevocable
	rm -rf data/event_logs/* data/module_results/* data/metadata.db data/metadata.db-wal data/metadata.db-shm
	@echo "data/ wiped. Module folders under modules/ are kept."
