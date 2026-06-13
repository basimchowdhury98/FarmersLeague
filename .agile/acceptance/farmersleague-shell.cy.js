describe('FarmersLeague shell', () => {
  const alicePasskey = '11111111-1111-1111-1111-111111111111';

  // GIVEN the app and scraper API are running
  // WHEN Alice opens the FarmersLeague shell using her valid passkey URL
  // THEN the UI shows data loaded through the API and scraper API
  it('loads UI data through the API and scraper API', () => {
    cy.intercept('GET', '/api/hello').as('helloApi');
    cy.intercept('GET', '/api/matches').as('matchesApi');

    cy.visit(`/${alicePasskey}`);

    cy.wait('@helloApi').its('response.statusCode').should('equal', 200);
    cy.wait('@matchesApi').then((interception) => {
      expect(interception.response?.statusCode).to.equal(200);
      expect(interception.response?.body).to.have.length.greaterThan(0);
    });

    cy.contains('h1', 'FarmersLeague').should('be.visible');
    cy.testGet('api-greeting').should('contain.text', 'Welcome back, Alice');
    cy.testGet('match-league').should('contain.text', 'FIFA World Cup');
    cy.testGet('match-card').should('have.length.greaterThan', 0);
  });
});
