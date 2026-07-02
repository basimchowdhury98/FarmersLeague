SHELL := /bin/bash

.PHONY: mock run stat val down

CYPRESS_SPECS := *.cy.js

mock:
	set -e; \
	trap 'docker compose down' EXIT; \
	FOTMOB_BASE_URL=http://mock-fotmob SEED_TEST_USERS=true LIVE_MATCH_REFRESH_MODE=pulsing LIVE_MATCH_REFRESH_INTERVAL_SECONDS=2 docker compose up --build -d; \
	until curl -fsS http://localhost:8080/api/hello >/dev/null 2>&1; do sleep 1; done; \
	open_browser_window() { \
		url="$$1"; \
		if command -v google-chrome >/dev/null 2>&1; then google-chrome --new-window "$$url" >/dev/null 2>&1 & \
		elif command -v chromium >/dev/null 2>&1; then chromium --new-window "$$url" >/dev/null 2>&1 & \
		elif command -v chromium-browser >/dev/null 2>&1; then chromium-browser --new-window "$$url" >/dev/null 2>&1 & \
		elif command -v firefox >/dev/null 2>&1; then firefox --new-window "$$url" >/dev/null 2>&1 & \
		else xdg-open "$$url" >/dev/null 2>&1 & \
		fi; \
	}; \
	open_browser_window http://localhost:8080/alice-1111-1111-1111; \
	open_browser_window http://localhost:8080/bob-2222-2222-2222; \
	open_browser_window http://localhost:8081; \
	docker compose logs -f

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
