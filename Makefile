SHELL := /bin/bash

.PHONY: mock run stat val down

CYPRESS_ACCEPTANCE_SPECS := *.cy.js

mock:
	USE_SCRAPER_MOCK_MODE=true docker compose up --build -d

run:
	docker compose up --build app redis

stat:
	@if [ ! -f .env ]; then echo "Missing .env. Add Redis__ConnectionString=<prod redis connection string>."; exit 1; fi; \
	set -a; source .env; set +a; \
	if [ -z "$${Redis__ConnectionString:-}" ]; then echo "Missing Redis__ConnectionString in .env"; exit 1; fi; \
	dotnet run --project tools/FarmersLeague.StatsExplorer -- --redis "$${Redis__ConnectionString}"

val:
	set -e; \
	trap 'docker compose down' EXIT; \
	USE_SCRAPER_MOCK_MODE=true docker compose up --build -d; \
	until curl -fsS http://localhost:8080/api/hello >/dev/null 2>&1; do sleep 1; done; \
	if [ -f .agile/acceptance/package-lock.json ]; then npm --prefix .agile/acceptance ci; else npm --prefix .agile/acceptance install; fi; \
	npm --prefix .agile/acceptance test -- --spec "$(CYPRESS_ACCEPTANCE_SPECS)"

down:
	docker compose down
