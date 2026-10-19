# Make targets for local dev on macOS. Each one calls bin/insider, which loads .env and
# sets the dev defaults (ports, tokens, fixture DB). Run `make help` for the list.

INSIDER := bin/insider

# The WhatsApp Desktop database on this Mac. `make dev-real` and `make collector-real` read it
# (read-only, through a private copy) instead of the synthetic fixture.
WA_REAL_DB ?= $(HOME)/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite

.DEFAULT_GOAL := help

.PHONY: help setup dev dev-web dev-real db redis migrate seed api worker web collector \
	collector-real require-wa-db test check build gen

help: ## List the targets
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

setup: ## Install dependencies and create .env
	@$(INSIDER) setup

dev: ## Start everything: Postgres, Redis, API, worker, web (:5173), collector on the fixture
	@$(INSIDER) dev

dev-web: ## Start everything except the collector
	@$(INSIDER) dev --no-collector

dev-real: require-wa-db ## Start everything, with the collector reading the real WhatsApp database
	@INSIDER_WA_DB="$(WA_REAL_DB)" $(INSIDER) dev

db: ## Local Postgres on :54329 (foreground)
	@$(INSIDER) db

redis: ## Local Redis on :6380 (foreground)
	@$(INSIDER) redis

migrate: ## Apply database migrations
	@$(INSIDER) migrate

seed: ## Create the dev collector device
	@$(INSIDER) seed

api: ## API dev server on :8000
	@$(INSIDER) api

worker: ## Job worker and IST schedules (needs Redis)
	@$(INSIDER) worker

web: ## SvelteKit dev server on :5173
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
