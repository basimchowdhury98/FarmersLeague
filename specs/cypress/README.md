Cypress specs for agreed user stories live here.

Testing principles:

- Each `it` should verify one unit of observable behavior.
- Each `it` should have one primary reason to fail: the behavior under test changed.
- Arrange state through test-specific domain commands in `cypress/support/commands.js`, not raw Redis/cache shapes or UI setup flows.
- Act through the UI only. The act should be one specific user behavior, such as clicking a draft button or opening a match card.
- Prefer user-visible/API-visible outcomes over implementation details.
- Prefer UI-visible outcomes over implementation details. Use test-specific API assertions only when the UI cannot prove the important state change.
- Use browser or network monkey-patching only when the behavior itself is about that browser/network integration.

Arrange / Act / Assert contract:

- Arrange: use Cypress domain commands/tasks that set Redis-backed app state and mock FotMob state.
- Act: use browser UI interactions only, and keep each test to one behavior under test.
- Assert: prefer UI assertions. Non-UI assertions must go through named test-specific commands and should be rare.
- Do not use UI flows to create unrelated preconditions. If a draft must already exist, arrange it directly.
- Do not call raw `cy.request(...)`, raw `cy.task(...)`, or response-stubbing `cy.intercept(...)` from specs. Add a named domain command first.
- Do not duplicate a backend/cache assertion when the UI already proves the write succeeded.

Conventions:

- Use Cypress spec files with the `.cy.js` extension.
- Use `describe` / `it` blocks with one `it` per user-story criterion or behavior rule.
- Use `data-test` attributes for UI assertions and select them with `cy.testGet('selector-name')`.
- Arrange FotMob scraper scenarios through the generated mock FotMob site tasks/commands, not API scraper mock endpoints.
- Call `cy.resetScraperMatches()` in tests that need the default generated FotMob fixture pages.
- Use `cy.arrangeNoDraft`, `cy.arrangeOpenDraft`, `cy.arrangeStartedDraft`, `cy.arrangeCompletedDraft`, `cy.arrangeUpcomingMatch`, `cy.arrangeOngoingMatch`, and `cy.arrangeFinishedMatch` for app state.
- Do not call low-level Redis/cache commands from specs. If a scenario is hard to arrange, add a domain command first.

The Cypress project configuration lives in this directory.
