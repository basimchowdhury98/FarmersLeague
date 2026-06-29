SHELL := /bin/bash

.PHONY: mock run stat val down

CYPRESS_SPECS := *.cy.js

mock:
	trap 'docker compose down' EXIT; \
	FOTMOB_BASE_URL=http://mock-fotmob SEED_TEST_USERS=true LIVE_MATCH_REFRESH_MODE=pulsing LIVE_MATCH_REFRESH_INTERVAL_SECONDS=2 docker compose up --build

run:
	trap 'docker compose down' EXIT; \
	docker compose up --build app redis

stat:
	@if [ ! -f .env ]; then echo "Missing .env. Add Redis__ConnectionString=<prod redis connection string>."; exit 1; fi; \
	set -a; source .env; set +a; \
	if [ -z "$${Redis__ConnectionString:-}" ]; then echo "Missing Redis__ConnectionString in .env"; exit 1; fi; \
	dotnet run --project tools/FarmersLeague.StatsExplorer -- --redis "$${Redis__ConnectionString}"

val:
	set -e; \
	trap 'docker compose down' EXIT; \
	FOTMOB_BASE_URL=http://mock-fotmob SEED_TEST_USERS=true LIVE_MATCH_REFRESH_MODE=continuous DISABLE_MOCK_FOTMOB_DEMO=true docker compose up --build -d; \
	until curl -fsS http://localhost:8080/api/hello >/dev/null 2>&1; do sleep 1; done; \
	if [ -f specs/cypress/package-lock.json ]; then npm --prefix specs/cypress ci; else npm --prefix specs/cypress install; fi; \
	npm --prefix specs/cypress test -- --spec "$(CYPRESS_SPECS)"

down:
	docker compose down
