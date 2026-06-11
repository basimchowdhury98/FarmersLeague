describe('FarmersLeague shell', () => {
  const alicePasskey = '11111111-1111-1111-1111-111111111111';

  // GIVEN the app and mock football API are running
  // WHEN Alice opens the FarmersLeague shell using her valid passkey URL
  // THEN the UI shows data loaded through the API and mock football API
  it('loads UI data through the API and mock football API', () => {
    cy.request(`${Cypress.env('mockApiUrl')}/api/v1/unique-tournament/16/season/58210/events/next/0`)
      .its('body.events.0.homeTeam.name')
      .should('equal', 'Canada');

    cy.intercept('GET', '/api/hello').as('helloApi');
    cy.intercept('GET', '/api/matches').as('matchesApi');

    cy.visit(`/${alicePasskey}`);

    cy.wait('@helloApi').its('response.statusCode').should('equal', 200);
    cy.wait('@matchesApi').its('response.body.0.homeTeam').should('equal', 'Canada');

    cy.contains('h1', 'FarmersLeague').should('be.visible');
    cy.testGet('api-greeting').should('contain.text', 'Welcome back, Alice');
    cy.testGet('match-league').should('contain.text', 'FIFA World Cup');
    cy.testGet('match-teams').should('contain.text', 'Canada vs Mexico');
  });
});
