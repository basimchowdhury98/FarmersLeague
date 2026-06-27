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
  let noLineupMatchLabel;
  let homeStarters;
  let awayStarters;

  const loadMatches = () => {
    cy.request('/api/matches').then(({ body }) => {
      match = body.find((candidate) => candidate.id === draftableMatchId);
      noLineupMatch = body.find((candidate) => candidate.id === noLineupMatchId);
      predictedLineupMatch = body.find((candidate) => candidate.id === predictedLineupMatchId);
      incompleteBenchMatch = body.find((candidate) => candidate.id === incompleteBenchMatchId);

      expect(match, 'draftable scraper match').to.exist;
      expect(noLineupMatch, 'no-lineup scraper match').to.exist;
      expect(predictedLineupMatch, 'predicted-lineup scraper match').to.exist;
      expect(incompleteBenchMatch, 'incomplete-bench scraper match').to.exist;

      matchLabel = `${match.homeTeam} vs ${match.awayTeam}`;
      noLineupMatchLabel = `${noLineupMatch.homeTeam} vs ${noLineupMatch.awayTeam}`;
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
  const noLineupMatchCard = () => {
    return cy.findMatchCard(noLineupMatchLabel);
  };
  const draftPath = (passkey) => `/${passkey}/matches/${draftableMatchId}/draft`;
  const clickDraft = (playerName) => cy.contains('[data-test="draft-player"]', playerName).within(() => cy.contains('button', 'Draft').click());

  beforeEach(() => {
    cy.resetScraperMatches();
    cy.arrangeNoDraft(draftableMatchId);
    cy.arrangeNoDraft(noLineupMatchId);
    cy.arrangeNoDraft(predictedLineupMatchId);
    cy.arrangeNoDraft(incompleteBenchMatchId);
    loadMatches();
    loadConfirmedLineups();
    cy.arrangeNoDraft(draftableMatchId);
  });

  afterEach(() => {
    cy.resetScraperMatches();
    cy.arrangeNoDraft(draftableMatchId);
    cy.arrangeNoDraft(noLineupMatchId);
    cy.arrangeNoDraft(predictedLineupMatchId);
    cy.arrangeNoDraft(incompleteBenchMatchId);
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

    cy.request('POST', `/api/drafts/${draftableMatchId}/start`, { passkey: alicePasskey, draftOrderMode: 'roundRobin' }).then(({ body }) => {
      expect(body.status).to.equal('started');
      expect(body.draftTurnOrder).to.have.length(6);
    });
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

    cy.request({
      method: 'POST',
      url: `/api/drafts/${noLineupMatchId}/start`,
      body: { passkey: alicePasskey, draftOrderMode: 'roundRobin' },
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.equal(400);
      expect(response.body.message).to.equal('Starting lineups are not confirmed');
    });
  });

  it('rejects starting a draft while the Preview tab lineup is predicted', () => {
    arrangePredictedLineupOpenDraft();

    cy.request({
      method: 'POST',
      url: `/api/drafts/${predictedLineupMatchId}/start`,
      body: { passkey: alicePasskey, draftOrderMode: 'roundRobin' },
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.equal(400);
      expect(response.body.message).to.equal('Starting lineups are not confirmed');
    });
  });

  it('starts a draft when confirmed starters are available without full benches', () => {
    arrangeIncompleteBenchOpenDraft();

    cy.request(`/api/drafts/${incompleteBenchMatchId}?passkey=${alicePasskey}`).then(({ body: draft }) => {
      expect(draft.match.lineups, 'draft page lineups').to.have.length(2);
      expect(draft.match.lineups.every((lineup) => lineup.starters.length === 11)).to.equal(true);
      expect(draft.match.lineups.every((lineup) => lineup.bench.length === 5)).to.equal(true);
    });

    cy.request('POST', `/api/drafts/${incompleteBenchMatchId}/start`, { passkey: alicePasskey, draftOrderMode: 'roundRobin' }).then(({ body }) => {
      expect(body.status).to.equal('started');
      expect(body.match.lineups.every((lineup) => lineup.bench.length === 5)).to.equal(true);
    });
  });

  it('rejects starting an open draft after the scraper says the match has started', () => {
    arrangeOpenDraft();
    cy.arrangeOngoingMatch(draftableMatchId);

    cy.request({
      method: 'POST',
      url: `/api/drafts/${draftableMatchId}/start`,
      body: { passkey: alicePasskey, draftOrderMode: 'roundRobin' },
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.equal(400);
      expect(response.body.message).to.equal('Draft can\'t be started since match has started');
    });
  });

  it('abandons the draft and routes home when the final pick happens after match start', () => {
    arrangeStartedDraftOnePickRemaining();
    cy.arrangeOngoingMatch(draftableMatchId);

    cy.visit(draftPath(bobPasskey));
    clickDraft(awayStarters[2]);

    cy.location('pathname').should('equal', `/${bobPasskey}`);
    cy.testGet('home-error').should('be.visible').and('contain.text', 'Live match cannot be created since the actual match has started');

    cy.request({
      url: `/api/matches/${draftableMatchId}/live?passkey=${bobPasskey}`,
      failOnStatusCode: false
    }).its('status').should('equal', 400);
  });

  it('rejects creating a draft through the API after the match has started or finished', () => {
    cy.arrangeFinishedMatch(draftableMatchId);

    cy.request({
      method: 'POST',
      url: `/api/drafts/${draftableMatchId}`,
      body: { passkey: alicePasskey },
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.equal(400);
      expect(response.body.message).to.equal('Draft can\'t be created since match has started or ended');
    });
  });
});
