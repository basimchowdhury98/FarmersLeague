Cypress.Commands.add('testGet', (testId, options) => cy.get(`[data-test="${testId}"]`, options));

Cypress.Commands.add('resetScraperMatches', () => {
  cy.request('POST', '/api/testing/world-cup-2026/games/reset')
    .its('status')
    .should('equal', 204);
});

Cypress.Commands.add('setScraperMatchStatus', (matchId, status) => {
  cy.request('PUT', `/api/testing/world-cup-2026/games/${matchId}/status`, status)
    .its('status')
    .should('equal', 204);
});
