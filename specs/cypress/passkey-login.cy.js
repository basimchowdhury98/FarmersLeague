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

  // GIVEN local test users have been seeded with formatted passkeys and Alice is an admin
  // WHEN Alice visits the app using her valid passkey URL
  // THEN she sees the current FarmersLeague home page
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

  // GIVEN local test users have been seeded with formatted passkeys and Bob is not an admin
  // WHEN Bob visits the app using his valid passkey URL
  // THEN he sees the current FarmersLeague home page
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

  // GIVEN access requires a known formatted passkey
  // WHEN a visitor opens the app with an unknown formatted passkey URL
  // THEN they see a “no access” page instead of the FarmersLeague home page
  it('denies access for an unknown passkey', () => {
    cy.visit('/mallory-9999-9999-9999');

    cy.testGet('no-access').should('be.visible').and('contain.text', 'No access');
    cy.contains('h1', 'FarmersLeague').should('not.exist');
    cy.testGet('api-greeting').should('not.exist');
  });

  // GIVEN access requires a valid passkey in the URL
  // WHEN a visitor opens the app root without a passkey
  // THEN they see a “no access” page instead of the FarmersLeague home page
  it('denies access when no passkey is provided', () => {
    cy.visit('/');

    cy.testGet('no-access').should('be.visible').and('contain.text', 'No access');
    cy.contains('h1', 'FarmersLeague').should('not.exist');
    cy.testGet('api-greeting').should('not.exist');
  });
});
