/**
 * As an admin drafting World Cup matches, I want drafts to be creatable, startable, and completable only before the real
 * match starts and only when confirmed lineups exist, so that users cannot create invalid live matches or draft after kickoff.
 */
describe('Draft match start cutoff', () => {
  const alicePasskey = 'alice-1111-1111-1111';
  const bobPasskey = 'bob-2222-2222-2222';
  const draftableMatchId = 1001;
  const noLineupMatchId = 1002;
  const fullBenchPlayerCount = 15;
  const scraperBaseUrl = '';

  let match;
  let noLineupMatch;
  let matchLabel;
  let noLineupMatchLabel;
  let homeStarters;
  let awayStarters;

  const resetScraperMatches = () => {
    cy.request('POST', `${scraperBaseUrl}/api/testing/world-cup-2026/games/reset`)
      .its('status')
      .should('equal', 204);
  };

  const setScraperMatchStatus = (matchId, status) => {
    cy.request('PUT', `${scraperBaseUrl}/api/testing/world-cup-2026/games/${matchId}/status`, status)
      .its('status')
      .should('equal', 204);
  };

  const loadMatches = () => {
    cy.request('/api/matches').then(({ body }) => {
      match = body.find((candidate) => candidate.id === draftableMatchId);
      noLineupMatch = body.find((candidate) => candidate.id === noLineupMatchId);

      expect(match, 'draftable scraper match').to.exist;
      expect(noLineupMatch, 'no-lineup scraper match').to.exist;

      matchLabel = `${match.homeTeam} vs ${match.awayTeam}`;
      noLineupMatchLabel = `${noLineupMatch.homeTeam} vs ${noLineupMatch.awayTeam}`;
    });
  };

  const loadConfirmedLineups = () => {
    cy.request(`/api/drafts/${draftableMatchId}?passkey=${alicePasskey}`).then(({ body: draft }) => {
      expect(draft.match.lineups, 'draft page lineups').to.have.length(2);
      expect(draft.match.lineups.every((lineup) => lineup.starters.length === 11 && lineup.bench.length === fullBenchPlayerCount)).to.equal(true);

      homeStarters = draft.match.lineups[0].starters.map((player) => player.name);
      awayStarters = draft.match.lineups[1].starters.map((player) => player.name);
    });
  };

  const setDraft = (draftState) => {
    cy.request('PUT', `/api/testing/drafts/${draftableMatchId}`, draftState)
      .its('status')
      .should('equal', 204);
  };

  const setNoLineupDraft = (draftState) => {
    cy.request('PUT', `/api/testing/drafts/${noLineupMatchId}`, draftState)
      .its('status')
      .should('equal', 204);
  };

  const completedPicks = () => [
    { userName: 'Alice', playerName: homeStarters[0] },
    { userName: 'Bob', playerName: awayStarters[0] },
    { userName: 'Alice', playerName: homeStarters[1] },
    { userName: 'Bob', playerName: awayStarters[1] },
    { userName: 'Alice', playerName: homeStarters[2] },
    { userName: 'Bob', playerName: awayStarters[2] }
  ];

  const matchCard = () => cy.contains('[data-test="match-card"]', matchLabel);
  const noLineupMatchCard = () => cy.contains('[data-test="match-card"]', noLineupMatchLabel);
  const draftPath = (passkey) => `/${passkey}/matches/${draftableMatchId}/draft`;
  const clickDraft = (playerName) => cy.contains('[data-test="draft-player"]', playerName).within(() => cy.contains('button', 'Draft').click());

  beforeEach(() => {
    resetScraperMatches();
    cy.request('DELETE', `/api/testing/drafts/${draftableMatchId}`).its('status').should('equal', 204);
    cy.request('DELETE', `/api/testing/drafts/${noLineupMatchId}`).its('status').should('equal', 204);
    loadMatches();
    loadConfirmedLineups();
    cy.request('DELETE', `/api/testing/drafts/${draftableMatchId}`).its('status').should('equal', 204);
  });

  afterEach(() => {
    resetScraperMatches();
    cy.request('DELETE', `/api/testing/drafts/${draftableMatchId}`).its('status').should('equal', 204);
    cy.request('DELETE', `/api/testing/drafts/${noLineupMatchId}`).its('status').should('equal', 204);
  });

  // GIVEN an upcoming match from the scraper has not started or finished and no draft exists
  // WHEN an admin views the home page
  // THEN the match shows a Create draft action
  it('shows a create draft action for an unstarted match', () => {
    cy.visit(`/${alicePasskey}`);

    matchCard().within(() => {
      cy.testGet('match-draft-status').should('contain.text', 'No draft yet');
      cy.testGet('create-draft-button').should('be.visible').and('contain.text', 'Create draft');
    });
  });

  // GIVEN an upcoming match has confirmed starting 11s and full benches for both teams, an open draft exists, and at least two users have joined
  // WHEN an admin starts the draft before the scraper says the match has started
  // THEN the draft starts successfully
  it('starts a joined draft before the scraper says the match has started', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice', 'Bob'], draftOrder: [], picks: [] });

    cy.request('POST', `/api/drafts/${draftableMatchId}/start`, { passkey: alicePasskey, draftOrderMode: 'roundRobin' }).then(({ body }) => {
      expect(body.status).to.equal('started');
      expect(body.draftTurnOrder).to.have.length(6);
    });
  });

  // GIVEN a draft is in progress before the scraper says the match has started
  // WHEN the final pick completes the draft
  // THEN the draft is completed and the user is taken to the live match
  it('opens the live match when the final pick completes before match start', () => {
    setDraft({
      status: 'started',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: completedPicks().slice(0, 5)
    });

    cy.visit(draftPath(bobPasskey));
    clickDraft(awayStarters[2]);

    cy.location('pathname').should('equal', `/${bobPasskey}/matches/${draftableMatchId}/live`);
    cy.testGet('live-match-page').should('be.visible');
  });

  // GIVEN the scraper all-matches response says a match has started
  // WHEN an admin views the home page
  // THEN the match does not show a Create draft action and indicates that the match is ongoing
  it('hides draft creation and marks a started match as ongoing on the home page', () => {
    setScraperMatchStatus(draftableMatchId, { started: true, finished: false });
    loadMatches();

    cy.visit(`/${alicePasskey}`);

    matchCard().within(() => {
      cy.testGet('create-draft-button').should('not.exist');
      cy.testGet('match-draft-status').should('contain.text', 'Match ongoing');
    });
  });

  // GIVEN the scraper all-matches response says a match has finished
  // WHEN an admin views the home page
  // THEN the match does not show a Create draft action and indicates that the match has ended
  it('hides draft creation and marks a finished match as ended on the home page', () => {
    setScraperMatchStatus(draftableMatchId, { started: true, finished: true });
    loadMatches();

    cy.visit(`/${alicePasskey}`);

    matchCard().within(() => {
      cy.testGet('create-draft-button').should('not.exist');
      cy.testGet('match-draft-status').should('contain.text', 'Match ended');
    });
  });

  // GIVEN a match has not started but confirmed starting lineups and full benches are unavailable
  // WHEN an admin attempts to start its draft
  // THEN the draft is not started and an error explains that starting lineups and full benches are not confirmed
  it('rejects starting a draft before confirmed lineups and full benches are available', () => {
    setNoLineupDraft({ status: 'open', joinedUsers: ['Alice', 'Bob'], draftOrder: [], picks: [] });

    cy.request({
      method: 'POST',
      url: `/api/drafts/${noLineupMatchId}/start`,
      body: { passkey: alicePasskey, draftOrderMode: 'roundRobin' },
      failOnStatusCode: false
    }).then((response) => {
      expect(response.status).to.equal(400);
      expect(response.body.message).to.equal('Starting lineups and full benches are not confirmed');
    });
  });

  // GIVEN an open draft exists and the scraper now says the match has started
  // WHEN an admin attempts to start the draft
  // THEN the draft is not started and an error says “Draft can’t be started since match has started.”
  it('rejects starting an open draft after the scraper says the match has started', () => {
    setDraft({ status: 'open', joinedUsers: ['Alice', 'Bob'], draftOrder: [], picks: [] });
    setScraperMatchStatus(draftableMatchId, { started: true, finished: false });

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

  // GIVEN a draft is in progress and the scraper now says the match has started
  // WHEN a user makes the final pick that would complete the draft
  // THEN the live match is not created, the draft is deleted, an error says the live match cannot be created since the actual match has started, and the user is routed home
  it('abandons the draft and routes home when the final pick happens after match start', () => {
    setDraft({
      status: 'started',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: completedPicks().slice(0, 5)
    });
    setScraperMatchStatus(draftableMatchId, { started: true, finished: false });

    cy.visit(draftPath(bobPasskey));
    clickDraft(awayStarters[2]);

    cy.location('pathname').should('equal', `/${bobPasskey}`);
    cy.testGet('home-error').should('be.visible').and('contain.text', 'Live match cannot be created since the actual match has started');

    cy.request({
      url: `/api/matches/${draftableMatchId}/live?passkey=${bobPasskey}`,
      failOnStatusCode: false
    }).its('status').should('equal', 400);
  });

  // GIVEN the scraper now says a match has started or finished
  // WHEN an admin attempts to create a draft for that match through the API
  // THEN the API rejects the request and no draft is created
  it('rejects creating a draft through the API after the match has started or finished', () => {
    setScraperMatchStatus(draftableMatchId, { started: true, finished: true });

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
