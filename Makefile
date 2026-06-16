SHELL := /bin/bash

.PHONY: mock run val down

CYPRESS_ACCEPTANCE_SPECS := *.cy.js

mock:
	USE_SCRAPER_MOCK_MODE=true docker compose up --build -d

run:
	docker compose up --build app redis

val:
	set -e; \
	trap 'docker compose down' EXIT; \
	USE_SCRAPER_MOCK_MODE=true docker compose up --build -d; \
	until curl -fsS http://localhost:8080/api/hello >/dev/null 2>&1; do sleep 1; done; \
	if [ -f .agile/acceptance/package-lock.json ]; then npm --prefix .agile/acceptance ci; else npm --prefix .agile/acceptance install; fi; \
	npm --prefix .agile/acceptance test -- --spec "$(CYPRESS_ACCEPTANCE_SPECS)"

down:
	docker compose down
