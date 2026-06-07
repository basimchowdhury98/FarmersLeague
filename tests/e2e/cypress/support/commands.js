Cypress.Commands.add('testGet', (testId) => cy.get(`[data-test="${testId}"]`));
