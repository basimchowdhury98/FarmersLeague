/**
 * As a logged-in league user, I want past and ongoing matches on the home page to show any score available from the
 * matches list, so that I can see match results and live scorelines without triggering slow per-match scraping.
 */
describe('Match list scores', () => {
  const alicePasskey = 'alice-1111-1111-1111';
  const draftableMatchId = 1001;

  const matchCard = (matchLabel) => cy.contains('[data-test="match-card"]', matchLabel);

  const todayIso = (hourOffset = 0) => new Date(Date.now() + hourOffset * 60 * 60 * 1000).toISOString();
  const yesterdayIso = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const tomorrowIso = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const matchResponse = (overrides) => ({
    id: 200,
    homeTeam: 'Canada',
    awayTeam: 'Mexico',
    league: 'FIFA World Cup',
    date: todayIso(),
    lineups: [],
    draft: null,
    hasStarted: false,
    hasFinished: false,
    ...overrides
  });

  const stubMatches = (matches) => {
    cy.intercept('GET', '/api/matches', matches).as('matchesApi');
    cy.intercept('GET', /\/api\/matches\/\d+(\/.*)?/, {
      statusCode: 500,
      body: { message: 'Per-match scraping should not be used for list scores' }
    }).as('perMatchDetails');
  };

  beforeEach(() => {
    cy.resetScraperMatches();
    cy.request('DELETE', `/api/testing/drafts/${draftableMatchId}`).its('status').should('equal', 204);
  });

  afterEach(() => {
    cy.resetScraperMatches();
    cy.request('DELETE', `/api/testing/drafts/${draftableMatchId}`).its('status').should('equal', 204);
  });

  // GIVEN the scraper matches-list response has an ongoing match with a score string
  // WHEN the matches API returns that match
  // THEN the API includes the matches-list score without requiring lineup or per-match scraping
  it('returns the score from the scraper matches list for an ongoing match', () => {
    cy.setScraperMatchStatus(draftableMatchId, { started: true, finished: false, score: '2 - 1' });

    cy.request('/api/matches').then(({ body }) => {
      const match = body.find((candidate) => candidate.id === draftableMatchId);

      expect(match, 'ongoing scraper match').to.exist;
      expect(match.score).to.equal('2 - 1');
      expect(match.hasStarted).to.equal(true);
      expect(match.hasFinished).to.equal(false);
      expect(match.lineups, 'home match list lineups').to.have.length(0);
    });
  });

  // GIVEN the matches API returns an ongoing match with home and away scores from the scraper matches list
  // WHEN a logged-in user opens the home page
  // THEN that match card shows the current score with the team names
  it('shows an ongoing match score with the team names on the Today page', () => {
    const ongoingMatch = matchResponse({
      id: 201,
      hasStarted: true,
      score: '2 - 1'
    });
    stubMatches([ongoingMatch]);

    cy.visit(`/${alicePasskey}`);
    cy.wait('@matchesApi');

    matchCard('Canada 2 - 1 Mexico').within(() => {
      cy.testGet('match-teams').should('contain.text', 'Canada 2 - 1 Mexico');
      cy.testGet('match-score').should('be.visible').and('contain.text', '2 - 1');
      cy.testGet('match-draft-status').should('contain.text', 'Match ongoing');
    });
  });

  // GIVEN the matches API returns a finished match with home and away scores from the scraper matches list
  // WHEN a logged-in user opens the home page and selects Past
  // THEN that match card shows the final score with the team names
  it('shows a finished past match score with the team names on the Past page', () => {
    const finishedMatch = matchResponse({
      id: 202,
      homeTeam: 'Brazil',
      awayTeam: 'Japan',
      date: yesterdayIso(),
      hasStarted: true,
      hasFinished: true,
      score: '3 - 0'
    });
    stubMatches([finishedMatch]);

    cy.visit(`/${alicePasskey}`);
    cy.wait('@matchesApi');
    cy.testGet('past-matches-tab').click();

    matchCard('Brazil 3 - 0 Japan').within(() => {
      cy.testGet('match-teams').should('contain.text', 'Brazil 3 - 0 Japan');
      cy.testGet('match-score').should('be.visible').and('contain.text', '3 - 0');
      cy.testGet('match-draft-status').should('contain.text', 'Match ended');
    });
  });

  // GIVEN the matches API lists past, ongoing, and upcoming matches
  // WHEN a logged-in user opens the home page
  // THEN past and ongoing matches are visible in their feed tabs when returned by /api/matches
  it('keeps past and ongoing matches visible in the match feed when returned by the matches list', () => {
    stubMatches([
      matchResponse({
        id: 203,
        homeTeam: 'Brazil',
        awayTeam: 'Japan',
        date: yesterdayIso(),
        hasStarted: true,
        hasFinished: true,
        score: '3 - 0'
      }),
      matchResponse({
        id: 204,
        hasStarted: true,
        score: '2 - 1'
      }),
      matchResponse({
        id: 205,
        homeTeam: 'USA',
        awayTeam: 'Germany',
        date: tomorrowIso()
      })
    ]);

    cy.visit(`/${alicePasskey}`);
    cy.wait('@matchesApi');

    cy.testGet('today-matches-tab').should('have.class', 'active-tab');
    matchCard('Canada 2 - 1 Mexico').should('be.visible');
    cy.testGet('past-matches-tab').click();
    matchCard('Brazil 3 - 0 Japan').should('be.visible');
  });

  // GIVEN the matches API returns an upcoming match without scores
  // WHEN a logged-in user opens the home page and selects Upcoming
  // THEN the match card continues to show kickoff information and does not show a score
  it('continues to show kickoff information without a score for an unscored upcoming match', () => {
    const upcomingMatch = matchResponse({
      id: 206,
      homeTeam: 'USA',
      awayTeam: 'Germany',
      date: tomorrowIso()
    });
    stubMatches([upcomingMatch]);

    cy.visit(`/${alicePasskey}`);
    cy.wait('@matchesApi');
    cy.testGet('upcoming-matches-tab').click();

    matchCard('USA vs Germany').within(() => {
      cy.testGet('match-teams').should('contain.text', 'USA vs Germany');
      cy.testGet('match-kickoff').should('be.visible').and('contain.text', 'Kickoff');
      cy.testGet('match-score').should('not.exist');
    });
  });

  // GIVEN a match has no score values in the /api/matches response
  // WHEN the home page renders that match
  // THEN the UI does not attempt to fetch per-match details for a score
  it('does not fetch per-match details when the matches list has no score for a match', () => {
    stubMatches([
      matchResponse({
        id: 207,
        homeTeam: 'USA',
        awayTeam: 'Germany'
      })
    ]);

    cy.visit(`/${alicePasskey}`);
    cy.wait('@matchesApi');

    matchCard('USA vs Germany').within(() => {
      cy.testGet('match-score').should('not.exist');
      cy.testGet('match-kickoff').should('be.visible');
    });
    cy.get('@perMatchDetails.all').should('have.length', 0);
  });
});
