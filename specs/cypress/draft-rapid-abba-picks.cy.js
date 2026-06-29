/**
 * As a drafting user with consecutive ABBA turns, I want rapid back-to-back picks to keep the visible draft state in sync,
 * so that both selected players show as drafted and the remaining turns advance to the next manager.
 */
describe('Draft rapid ABBA picks', () => {
  const alicePasskey = 'alice-1111-1111-1111';
  const matchId = Cypress.env('mockMatches').confirmedLineups;

  let match;
  let alicePlayers;
  let bobPlayers;

  const loadDraftableMatch = () => {
    cy.getMockMatch(matchId).then((mockMatch) => {
      match = mockMatch;

      cy.getDraftLineups(matchId, alicePasskey).then((draft) => {
        expect(draft.lineups, 'draft page lineups').to.have.length(2);
        expect(draft.lineups.every((lineup) => lineup.starters.length === 11)).to.equal(true);

        alicePlayers = draft.homeStarters.slice(0, 3);
        bobPlayers = draft.awayStarters.slice(0, 1);
      });
    });
  };

  const draftPath = () => `/${alicePasskey}/matches/${match.id}/draft`;

  const clickDraft = (playerName) => {
    cy.contains('[data-test="draft-player"]', playerName)
      .find('button')
      .click();
  };

  beforeEach(() => {
    cy.resetTestState();
    loadDraftableMatch();
    cy.then(() => cy.arrangeNoDraft(match.id));
  });

  it('keeps the visible draft state in sync when Alice rapidly makes two back-to-back ABBA picks', () => {
    cy.arrangeStartedDraft(match.id, {
      draftOrder: ['Bob', 'Alice'],
      draftTurnOrder: ['Bob', 'Alice', 'Alice', 'Bob', 'Bob', 'Alice'],
      picks: [{ userName: 'Bob', playerName: bobPlayers[0] }]
    });

    cy.visit(draftPath());

    cy.testGet('draft-turn-queue-item').first().should('contain.text', 'Alice');

    clickDraft(alicePlayers[0]);
    clickDraft(alicePlayers[1]);

    cy.contains('[data-test="draft-player"]', alicePlayers[0])
      .should('contain.text', 'Drafted by Alice');
    cy.contains('[data-test="draft-player"]', alicePlayers[1])
      .should('contain.text', 'Drafted by Alice');

    cy.testGet('draft-picks-Alice')
      .should('contain.text', alicePlayers[0])
      .and('contain.text', alicePlayers[1]);

    cy.testGet('draft-turn-queue-item').first().should('contain.text', 'Bob');
    cy.contains('[data-test="draft-player"]', alicePlayers[2])
      .find('button')
      .should('be.disabled');
    cy.testGet('draft-error').should('not.exist');
  });
});
