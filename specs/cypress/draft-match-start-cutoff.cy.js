/**
 * As an admin drafting World Cup matches, I want drafts to be creatable, startable, and completable only before the real
 * match starts and only when confirmed lineups exist, so that users cannot create invalid live matches or draft after kickoff.
 */
describe('Draft match start cutoff', () => {
  const alicePasskey = 'alice-1111-1111-1111';
  const bobPasskey = 'bob-2222-2222-2222';
  const draftableMatchId = Cypress.env('mockMatches').confirmedLineups;
  const noLineupMatchId = Cypress.env('mockMatches').noLineups;
  const predictedLineupMatchId = Cypress.env('mockMatches').predictedLineups;
  const incompleteBenchMatchId = Cypress.env('mockMatches').shortBench;

  let match;
  let noLineupMatch;
  let predictedLineupMatch;
  let incompleteBenchMatch;
  let matchLabel;
  let homeStarters;
  let awayStarters;

  const loadMatches = () => {
    cy.getMockMatches().then((body) => {
      match = body.find((candidate) => candidate.id === draftableMatchId);
      noLineupMatch = body.find((candidate) => candidate.id === noLineupMatchId);
      predictedLineupMatch = body.find((candidate) => candidate.id === predictedLineupMatchId);
      incompleteBenchMatch = body.find((candidate) => candidate.id === incompleteBenchMatchId);

      expect(match, 'draftable scraper match').to.exist;
      expect(noLineupMatch, 'no-lineup scraper match').to.exist;
      expect(predictedLineupMatch, 'predicted-lineup scraper match').to.exist;
      expect(incompleteBenchMatch, 'incomplete-bench scraper match').to.exist;

      matchLabel = `${match.homeTeam} vs ${match.awayTeam}`;
    });
  };

  const loadConfirmedLineups = () => {
    cy.getDraftLineups(draftableMatchId, alicePasskey).then((draft) => {
      expect(draft.lineups, 'draft page lineups').to.have.length(2);
      expect(draft.lineups.every((lineup) => lineup.starters.length === 11)).to.equal(true);

      homeStarters = draft.homeStarters;
      awayStarters = draft.awayStarters;
    });
  };

  const arrangeOpenDraft = () => cy.arrangeOpenDraft(draftableMatchId, { joinedUsers: ['Alice', 'Bob'] });
  const arrangeStartedDraftOnePickRemaining = () => cy.arrangeStartedDraft(draftableMatchId, {
    draftOrder: ['Alice', 'Bob'],
    picks: completedPicks().slice(0, 5)
  });
  const arrangeNoLineupOpenDraft = () => cy.arrangeOpenDraft(noLineupMatchId, { joinedUsers: ['Alice', 'Bob'] });
  const arrangePredictedLineupOpenDraft = () => cy.arrangeOpenDraft(predictedLineupMatchId, { joinedUsers: ['Alice', 'Bob'] });
  const arrangeIncompleteBenchOpenDraft = () => cy.arrangeOpenDraft(incompleteBenchMatchId, { joinedUsers: ['Alice', 'Bob'] });

  const completedPicks = () => [
    { userName: 'Alice', playerName: homeStarters[0] },
    { userName: 'Bob', playerName: awayStarters[0] },
    { userName: 'Alice', playerName: homeStarters[1] },
    { userName: 'Bob', playerName: awayStarters[1] },
    { userName: 'Alice', playerName: homeStarters[2] },
    { userName: 'Bob', playerName: awayStarters[2] }
  ];

  const matchCard = () => {
    return cy.findMatchCard(matchLabel);
  };
  const draftPath = (passkey) => `/${passkey}/matches/${draftableMatchId}/draft`;
  const clickDraft = (playerName) => cy.contains('[data-test="draft-player"]', playerName).within(() => cy.contains('button', 'Draft').click());
  const startRoundRobinDraft = () => {
    cy.testGet('start-draft-button').click();
    cy.testGet('draft-order-mode-dialog').should('be.visible');
    cy.testGet('start-round-robin-draft-button').click();
  };

  beforeEach(() => {
    cy.resetTestState();
    cy.arrangeNoDraft(draftableMatchId);
    cy.arrangeNoDraft(noLineupMatchId);
    cy.arrangeNoDraft(predictedLineupMatchId);
    cy.arrangeNoDraft(incompleteBenchMatchId);
    loadMatches();
    loadConfirmedLineups();
    cy.arrangeNoDraft(draftableMatchId);
  });

  it('shows a create draft action for an unstarted match', () => {
    cy.visit(`/${alicePasskey}`);

    matchCard().within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'No draft yet');
      cy.testGet('create-draft-button').should('be.visible').and('contain.text', 'Create draft');
    });
  });

  it('starts a joined draft before the scraper says the match has started', () => {
    arrangeOpenDraft();

    cy.visit(draftPath(alicePasskey));
    startRoundRobinDraft();

    cy.testGet('draft-status').should('contain.text', 'Draft in progress');
    cy.testGet('draft-turn-queue-item').should('have.length', 6);
  });

  it('opens the live match when the final pick completes before match start', () => {
    arrangeStartedDraftOnePickRemaining();

    cy.visit(draftPath(bobPasskey));
    clickDraft(awayStarters[2]);

    cy.location('pathname').should('equal', `/${bobPasskey}/matches/${draftableMatchId}/live`);
    cy.testGet('live-match-page').should('be.visible');
  });

  it('hides draft creation and marks a started match as ongoing on the home page', () => {
    cy.arrangeOngoingMatch(draftableMatchId);
    loadMatches();

    cy.visit(`/${alicePasskey}`);

    matchCard().within(() => {
      cy.testGet('create-draft-button').should('not.exist');
      cy.testGet('match-draft-status').should('contain.text', 'Match ongoing');
    });
  });

  it('hides draft creation and marks a finished match as ended on the home page', () => {
    cy.arrangeFinishedMatch(draftableMatchId);
    loadMatches();

    cy.visit(`/${alicePasskey}`);

    matchCard().within(() => {
      cy.testGet('create-draft-button').should('not.exist');
      cy.testGet('match-draft-status').should('contain.text', 'Match ended');
    });
  });

  it('rejects starting a draft before the Preview tab lineup is available', () => {
    arrangeNoLineupOpenDraft();

    cy.visit(`/${alicePasskey}/matches/${noLineupMatchId}/draft`);

    cy.testGet('lineup-unavailable-banner').should('be.visible').and('contain.text', 'No lineup available yet');
    cy.testGet('start-draft-button').should('be.disabled');
  });

  it('rejects starting a draft while the Preview tab lineup is predicted', () => {
    arrangePredictedLineupOpenDraft();

    cy.visit(`/${alicePasskey}/matches/${predictedLineupMatchId}/draft`);

    cy.testGet('lineup-unavailable-banner').should('be.visible').and('contain.text', 'No lineup available yet');
    cy.testGet('start-draft-button').should('be.disabled');
  });

  it('starts a draft when confirmed starters are available without full benches', () => {
    arrangeIncompleteBenchOpenDraft();

    cy.getDraftForSetup(incompleteBenchMatchId, alicePasskey).then((draft) => {
      expect(draft.match.lineups, 'draft page lineups').to.have.length(2);
      expect(draft.match.lineups.every((lineup) => lineup.starters.length === 11)).to.equal(true);
      expect(draft.match.lineups.every((lineup) => lineup.bench.length === 5)).to.equal(true);
    });

    cy.visit(`/${alicePasskey}/matches/${incompleteBenchMatchId}/draft`);
    startRoundRobinDraft();

    cy.testGet('draft-status').should('contain.text', 'Draft in progress');
  });

  it('rejects starting an open draft after the scraper says the match has started', () => {
    arrangeOpenDraft();
    cy.arrangeOngoingMatch(draftableMatchId);

    cy.visit(draftPath(alicePasskey));

    cy.testGet('start-draft-button').should('be.disabled');
  });

  it('abandons the draft and routes home when the final pick happens after match start', () => {
    arrangeStartedDraftOnePickRemaining();
    cy.arrangeOngoingMatch(draftableMatchId);

    cy.visit(draftPath(bobPasskey));
    clickDraft(awayStarters[2]);

    cy.location('pathname').should('equal', `/${bobPasskey}`);
    cy.testGet('home-error').should('be.visible').and('contain.text', 'Live match cannot be created since the actual match has started');

    cy.assertLiveMatchUnavailable(draftableMatchId, bobPasskey);
  });
});
