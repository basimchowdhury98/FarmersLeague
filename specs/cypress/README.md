Cypress specs for agreed user stories live here.

Testing principles:

- Each `it` should verify one unit of observable behavior.
- Each `it` should have one primary reason to fail: the behavior under test changed.
- Arrange state through domain commands in `cypress/support/commands.js`, not raw Redis/cache shapes.
- Prefer user-visible/API-visible outcomes over implementation details.
- Use browser or network monkey-patching only when the behavior itself is about that browser/network integration.

Conventions:

- Use Cypress spec files with the `.cy.js` extension.
- Use `describe` / `it` blocks with one `it` per user-story criterion or behavior rule.
- Use `data-test` attributes for UI assertions and select them with `cy.testGet('selector-name')`.
- Arrange FotMob scraper scenarios through the generated mock FotMob site tasks/commands, not API scraper mock endpoints.
- Call `cy.resetScraperMatches()` in tests that need the default generated FotMob fixture pages.
- Use `cy.arrangeNoDraft`, `cy.arrangeOpenDraft`, `cy.arrangeStartedDraft`, `cy.arrangeCompletedDraft`, `cy.arrangeUpcomingMatch`, `cy.arrangeOngoingMatch`, and `cy.arrangeFinishedMatch` for app state.
- Do not call low-level Redis/cache commands from specs. If a scenario is hard to arrange, add a domain command first.

The Cypress project configuration lives in this directory.
