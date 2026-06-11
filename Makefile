SHELL := /bin/bash

.PHONY: run mock val down

CYPRESS_ACCEPTANCE_SPECS := cypress/e2e/acceptance/**/*.cy.js

run:
	APP_BUILD_TARGET=prod docker compose up --build app redis

mock:
	APP_BUILD_TARGET=test docker compose up --build app mock-football-api redis

val:
	set -e; \
	trap 'docker compose down' EXIT; \
	docker compose up --build -d; \
	until curl -fsS http://localhost:8080/api/hello >/dev/null 2>&1; do sleep 1; done; \
	until curl -fsS "http://localhost:5081/api/v1/unique-tournament/16/season/58210/events/next/0" >/dev/null 2>&1; do sleep 1; done; \
	mkdir -p tests/e2e/cypress/e2e/acceptance; \
	cp .agile/acceptance/*.cy.js tests/e2e/cypress/e2e/acceptance/; \
	if [ -f tests/e2e/package-lock.json ]; then npm --prefix tests/e2e ci; else npm --prefix tests/e2e install; fi; \
	npm --prefix tests/e2e test -- --spec "$(CYPRESS_ACCEPTANCE_SPECS)"

down:
	docker compose down
