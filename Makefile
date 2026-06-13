SHELL := /bin/bash

.PHONY: run val down

CYPRESS_ACCEPTANCE_SPECS := cypress/e2e/acceptance/**/*.cy.js

run:
	docker compose up --build app scraper redis

val:
	set -e; \
	trap 'docker compose down' EXIT; \
	INCLUDE_LINEUPS_IN_MATCH_LIST=true USE_SCRAPER_FIXTURE_DATA=true docker compose up --build -d; \
	until curl -fsS http://localhost:8080/api/hello >/dev/null 2>&1; do sleep 1; done; \
	until curl -fsS http://localhost:5082/health >/dev/null 2>&1; do sleep 1; done; \
	mkdir -p tests/e2e/cypress/e2e/acceptance; \
	cp .agile/acceptance/*.cy.js tests/e2e/cypress/e2e/acceptance/; \
	if [ -f tests/e2e/package-lock.json ]; then npm --prefix tests/e2e ci; else npm --prefix tests/e2e install; fi; \
	npm --prefix tests/e2e test -- --spec "$(CYPRESS_ACCEPTANCE_SPECS)"

down:
	docker compose down
