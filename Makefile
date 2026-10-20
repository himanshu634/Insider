# Make targets for local dev on macOS. Each one calls bin/insider, which loads .env and
# sets the dev defaults (ports, tokens, fixture DB). Postgres, Redis, the API, the worker and the
# web app run in Docker (compose.yaml); only the collector runs on the Mac. `make help` lists them.

INSIDER := bin/insider

# The WhatsApp Desktop database on this Mac. `make dev-real` and `make collector-real` read it
# (read-only, through a private copy) instead of the synthetic fixture.
WA_REAL_DB ?= $(HOME)/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite

.DEFAULT_GOAL := help

.PHONY: help setup dev dev-web dev-real up down logs psql import-local-db db redis migrate seed \
	api worker web collector collector-real require-wa-db test check build gen

help: ## List the targets
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

setup: ## Install dependencies, create .env, build the dev image
	@$(INSIDER) setup

dev: ## Start the containers (Postgres, Redis, API, worker, web :5173) and the collector on the fixture
	@$(INSIDER) dev

dev-web: ## Start the containers only, no collector
	@$(INSIDER) dev --no-collector

dev-real: require-wa-db ## Start everything, with the collector reading the real WhatsApp database
	@INSIDER_WA_DB="$(WA_REAL_DB)" $(INSIDER) dev

up: ## Start the containers in the background and wait until they are healthy
	@$(INSIDER) up

down: ## Stop and remove the containers (the database volume stays)
	@$(INSIDER) down

logs: ## Follow the container logs
	@$(INSIDER) logs

psql: ## psql into the Postgres container
	@$(INSIDER) psql

import-local-db: ## One-time: copy the old .dev/postgres database into the Postgres container
	@$(INSIDER) import-local-db

db: ## Postgres container on :54329 (foreground)
	@$(INSIDER) db

redis: ## Redis container on :6380 (foreground)
	@$(INSIDER) redis

migrate: ## Apply database migrations and create the dev collector device
	@$(INSIDER) migrate

seed: ## Create the dev collector device
	@$(INSIDER) seed

api: ## API container on :8000
	@$(INSIDER) api

worker: ## Job worker container and IST schedules
	@$(INSIDER) worker

web: ## Web container (SvelteKit dev server) on :5173
	@$(INSIDER) web

collector: ## Collector menu-bar app against the synthetic fixture
	@$(INSIDER) collector

collector-real: require-wa-db ## Collector menu-bar app against the real WhatsApp database
	@INSIDER_WA_DB="$(WA_REAL_DB)" $(INSIDER) collector

# bin/insider builds the synthetic fixture at INSIDER_WA_DB when the file is missing.
# Stop first, so it never writes into WhatsApp's own folder.
require-wa-db:
	@test -f "$(WA_REAL_DB)" || { printf '\033[31m✗ WhatsApp database not found: %s\033[0m\n' "$(WA_REAL_DB)" >&2; exit 1; }

test: ## Run every test suite
	@$(INSIDER) test

check: ## Type-check every package
	@pnpm check

build: ## Build every package
	@pnpm build

gen: ## Regenerate types from packages/contracts/openapi.yaml
	@$(INSIDER) gen
