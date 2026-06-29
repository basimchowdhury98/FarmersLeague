describe('FarmersLeague shell', () => {
  const alicePasskey = 'alice-1111-1111-1111';

  it('loads the authenticated shell through the API', () => {
    cy.visit(`/${alicePasskey}`);

    cy.contains('h1', 'FarmersLeague').should('be.visible');
    cy.testGet('api-greeting').should('contain.text', 'Welcome back, Alice');
  });

  it('selects the Today tab by default on the home page', () => {
    cy.visit(`/${alicePasskey}`);

    cy.testGet('today-matches-tab')
      .should('have.class', 'active-tab')
      .and('have.attr', 'aria-current', 'page');
    cy.testGet('upcoming-matches-tab')
      .should('not.have.class', 'active-tab')
      .and('not.have.attr', 'aria-current');
  });

  it('shows live scoring rules from the help popup', () => {
    cy.visit(`/${alicePasskey}`);

    cy.testGet('scoring-help-button').should('be.visible').click();
    cy.testGet('scoring-rules-dialog').within(() => {
      cy.testGet('scoring-rules-scoring-tab')
        .should('have.class', 'active-tab')
        .and('have.attr', 'aria-current', 'page');
      cy.contains('[data-test="scoring-rule-row"]', 'Goals').should('contain.text', '+6 pts');
      cy.contains('[data-test="scoring-rule-row"]', 'Big chances missed').should('contain.text', '-3 pts');

      cy.testGet('scoring-rules-zero-tab').click();
      cy.testGet('scoring-rules-zero-tab')
        .should('have.class', 'active-tab')
        .and('have.attr', 'aria-current', 'page');
      cy.contains('[data-test="scoring-rule-row"]', 'Expected goals').should('contain.text', '0 pts');
    });
  });
});
