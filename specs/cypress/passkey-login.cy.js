/**
 * As a provisioned league player, I want to log in by visiting my formatted unique passkey URL,
 * so that only invited friends can access the FarmersLeague home page.
 */
describe('Passkey login', () => {
  const alicePasskey = 'alice-1111-1111-1111';
  const bobPasskey = 'bob-2222-2222-2222';
  let matchLabel;

  before(() => {
    cy.request('/api/matches').then(({ body }) => {
      const match = body[0];

      expect(match, 'scraper match').to.exist;
      matchLabel = `${match.homeTeam} vs ${match.awayTeam}`;
    });
  });

  it('allows Alice to access the home page with her valid passkey', () => {
    cy.intercept('GET', '/api/hello').as('helloApi');
    cy.intercept('GET', '/api/matches').as('matchesApi');

    cy.visit(`/${alicePasskey}`);

    cy.wait('@helloApi').its('response.statusCode').should('equal', 200);
    cy.wait('@matchesApi').its('response.statusCode').should('equal', 200);
    cy.contains('h1', 'FarmersLeague').should('be.visible');
    cy.testGet('api-greeting').should('contain.text', 'Welcome back, Alice');
    cy.testGet('match-teams').should('contain.text', matchLabel);
    cy.testGet('no-access').should('not.exist');
  });

  it('allows Bob to access the home page with his valid passkey', () => {
    cy.intercept('GET', '/api/hello').as('helloApi');
    cy.intercept('GET', '/api/matches').as('matchesApi');

    cy.visit(`/${bobPasskey}`);

    cy.wait('@helloApi').its('response.statusCode').should('equal', 200);
    cy.wait('@matchesApi').its('response.statusCode').should('equal', 200);
    cy.contains('h1', 'FarmersLeague').should('be.visible');
    cy.testGet('api-greeting').should('contain.text', 'Welcome back, Bob');
    cy.testGet('match-teams').should('contain.text', matchLabel);
    cy.testGet('no-access').should('not.exist');
  });

  it('denies access for an unknown passkey', () => {
    cy.visit('/mallory-9999-9999-9999');

    cy.testGet('no-access').should('be.visible').and('contain.text', 'No access');
    cy.contains('h1', 'FarmersLeague').should('not.exist');
    cy.testGet('api-greeting').should('not.exist');
  });

  it('denies access when no passkey is provided', () => {
    cy.visit('/');

    cy.testGet('no-access').should('be.visible').and('contain.text', 'No access');
    cy.contains('h1', 'FarmersLeague').should('not.exist');
    cy.testGet('api-greeting').should('not.exist');
  });
});
