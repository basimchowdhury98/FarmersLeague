/**
 * As a logged-in FarmersLeague user, I want to click a game and see both teams' starting 11s,
 * so that I can review the expected lineups for that match.
 */
describe('Match starting lineups', () => {
  const alicePasskey = '11111111-1111-1111-1111-111111111111';

  const canadaStarters = [
    'Dayne St. Clair',
    'Alistair Johnston',
    'Kamal Miller',
    'Alphonso Davies',
    'Ismaël Koné',
    'Jonathan Osorio',
    'Nathan Saliba',
    'Tajon Buchanan',
    'Jonathan David',
    'Cyle Larin',
    'Stephen Eustáquio'
  ];

  const mexicoStarters = [
    'Raúl Rangel',
    'Israel Reyes',
    'César Montes',
    'Johan Vásquez',
    'Jesús Gallardo',
    'Érik Lira',
    'Orbelín Pineda',
    'Brian Gutiérrez',
    'Julián Quiñones',
    'Raúl Jiménez',
    'Roberto Alvarado'
  ];

  // GIVEN Alice is logged in with a valid passkey and the matches list has loaded
  // WHEN she clicks the Canada vs Mexico game
  // THEN she sees Canada's starting 11 and Mexico's starting 11 for that game
  it('shows both teams starting lineups after clicking a game', () => {
    cy.visit(`/${alicePasskey}`);
    cy.testGet('match-card').contains('Canada vs Mexico').click();

    cy.testGet('match-lineups').should('be.visible');
    cy.testGet('lineup-Canada').within(() => {
      cy.contains('h2', 'Canada Starting 11').should('be.visible');
      canadaStarters.forEach((player) => {
        cy.contains('[data-test="lineup-player"]', player).should('be.visible');
      });
    });
    cy.testGet('lineup-Mexico').within(() => {
      cy.contains('h2', 'Mexico Starting 11').should('be.visible');
      mexicoStarters.forEach((player) => {
        cy.contains('[data-test="lineup-player"]', player).should('be.visible');
      });
    });
  });

  // GIVEN Alice has opened the Canada vs Mexico game details
  // WHEN the starting lineups are displayed
  // THEN each lineup shows exactly 11 starters and no bench players
  it('shows exactly 11 starters per team and no bench players', () => {
    cy.visit(`/${alicePasskey}`);
    cy.testGet('match-card').contains('Canada vs Mexico').click();

    cy.testGet('lineup-Canada').find('[data-test="lineup-player"]').should('have.length', 11);
    cy.testGet('lineup-Mexico').find('[data-test="lineup-player"]').should('have.length', 11);
    cy.testGet('bench').should('not.exist');
    cy.contains('Bench').should('not.exist');
  });

  // GIVEN a visitor is not logged in with a valid passkey
  // WHEN they attempt to open the app
  // THEN they still see the no access page and cannot see match lineups
  it('does not show match lineups to visitors without a valid passkey', () => {
    cy.visit('/99999999-9999-9999-9999-999999999999');

    cy.testGet('no-access').should('be.visible').and('contain.text', 'No access');
    cy.testGet('match-lineups').should('not.exist');
    cy.testGet('lineup-Canada').should('not.exist');
    cy.testGet('lineup-Mexico').should('not.exist');
  });
});
