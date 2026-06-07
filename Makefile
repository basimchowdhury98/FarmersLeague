SHELL := /bin/bash

.PHONY: run val down

CYPRESS_ACCEPTANCE_SPECS := ../../.agile/acceptance/**/*.cy.js

run:
	docker compose up --build

val:
	set -e; \
	trap 'docker compose down' EXIT; \
	docker compose up --build -d; \
	until curl -fsS http://localhost:8080/api/hello >/dev/null 2>&1; do sleep 1; done; \
	until curl -fsS "http://localhost:5081/v3/fixtures?league=1&season=2026" >/dev/null 2>&1; do sleep 1; done; \
	if [ -f tests/e2e/package-lock.json ]; then npm --prefix tests/e2e ci; else npm --prefix tests/e2e install; fi; \
	npm --prefix tests/e2e test -- --spec "$(CYPRESS_ACCEPTANCE_SPECS)"

down:
	docker compose down
