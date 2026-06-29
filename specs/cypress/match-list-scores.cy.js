/**
 * As a logged-in league user, I want past and ongoing matches on the home page to show any score available from the
 * matches list, so that I can see match results and live scorelines without opening match details.
 */
describe('Match list scores', () => {
  const alicePasskey = 'alice-1111-1111-1111';
  const matchId = Cypress.env('mockMatches').confirmedLineups;

  let match;

  const matchCard = () => cy.findMatchCard(match.homeTeam);

  beforeEach(() => {
    cy.resetTestState();
    cy.getMockMatch(matchId).then((mockMatch) => {
      match = mockMatch;
      cy.arrangeNoDraft(match.id);
    });
  });

  it('shows an ongoing match score with the team names on the Today page', () => {
    cy.arrangeOngoingMatch(match.id, { score: '2 - 1' });

    cy.visit(`/${alicePasskey}`);

    matchCard().within(() => {
      cy.testGet('match-teams').should('contain.text', `${match.homeTeam} 2 - 1 ${match.awayTeam}`);
      cy.testGet('match-score').should('be.visible').and('contain.text', '2 - 1');
      cy.testGet('match-draft-status').should('contain.text', 'Match ongoing');
    });
  });

  it('shows a finished match score on the Today page when the match date is today', () => {
    cy.arrangeFinishedMatch(match.id, { score: '3 - 0' });

    cy.visit(`/${alicePasskey}`);

    matchCard().within(() => {
      cy.testGet('match-teams').should('contain.text', `${match.homeTeam} 3 - 0 ${match.awayTeam}`);
      cy.testGet('match-score').should('be.visible').and('contain.text', '3 - 0');
      cy.testGet('match-draft-status').should('contain.text', 'Match ended');
    });
  });

  it('continues to show kickoff information without a score for an unscored upcoming match', () => {
    cy.arrangeUpcomingMatch(match.id);

    cy.visit(`/${alicePasskey}`);

    matchCard().within(() => {
      cy.testGet('match-teams').should('contain.text', `${match.homeTeam} vs ${match.awayTeam}`);
      cy.testGet('match-kickoff').should('be.visible').and('contain.text', 'Kickoff');
      cy.testGet('match-score').should('not.exist');
    });
  });
});
