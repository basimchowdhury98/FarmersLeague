describe('FarmersLeague shell', () => {
  const alicePasskey = 'alice-1111-1111-1111';

  // GIVEN the app is running with scraper services
  // WHEN Alice opens the FarmersLeague shell using her valid passkey URL
  // THEN the UI shows data loaded through the API and scraper services
  it('loads UI data through the API and scraper services', () => {
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

  // GIVEN Alice opens the FarmersLeague home page with her valid passkey
  // WHEN the home page loads
  // THEN the Today tab is selected by default and the Upcoming tab is not selected
  it('selects the Today tab by default on the home page', () => {
    cy.visit(`/${alicePasskey}`);

    cy.testGet('today-matches-tab')
      .should('have.class', 'active-tab')
      .and('have.attr', 'aria-current', 'page');
    cy.testGet('upcoming-matches-tab')
      .should('not.have.class', 'active-tab')
      .and('not.have.attr', 'aria-current');
  });
});
