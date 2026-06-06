describe('FarmersLeague shell', () => {
  it('loads UI data through the API and mock football API', () => {
    cy.request(`${Cypress.env('mockApiUrl')}/v3/fixtures?league=1&season=2026`)
      .its('body.response.0.teams.home.name')
      .should('equal', 'Canada');

    cy.intercept('GET', '/api/hello').as('helloApi');
    cy.intercept('GET', '/api/matches').as('matchesApi');

    cy.visit('/');

    cy.wait('@helloApi').its('response.statusCode').should('equal', 200);
    cy.wait('@matchesApi').its('response.body.0.homeTeam').should('equal', 'Canada');

    cy.contains('h1', 'FarmersLeague').should('be.visible');
    cy.get('[data-cy="api-greeting"]').should('contain.text', 'Hello from FarmersLeague API');
    cy.get('[data-cy="match-league"]').should('contain.text', 'FIFA World Cup');
    cy.get('[data-cy="match-teams"]').should('contain.text', 'Canada vs Mexico');
  });
});
