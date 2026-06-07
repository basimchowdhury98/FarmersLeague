Acceptance tests for agreed user stories live here.

Conventions:

- Use Cypress spec files with the `.cy.js` extension.
- Use `describe` / `it` blocks with one `it` per acceptance criterion.
- Place Given / When / Then comments immediately above each `it` block.
- Prefer stable selectors such as `data-cy` or `data-testid` for UI assertions.

The current project Cypress configuration lives in `tests/e2e/cypress.config.js`.
