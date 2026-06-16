Cypress.Commands.add('testGet', (testId, options) => cy.get(`[data-test="${testId}"]`, options));
