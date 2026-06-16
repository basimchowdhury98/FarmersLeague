Acceptance tests for agreed user stories live here.

Conventions:

- Use Cypress spec files with the `.cy.js` extension.
- Use `describe` / `it` blocks with one `it` per acceptance criterion.
- Place Given / When / Then comments immediately above each `it` block.
- Use `data-test` attributes for UI assertions and select them with `cy.testGet('selector-name')`.

The Cypress project configuration lives in this directory.
