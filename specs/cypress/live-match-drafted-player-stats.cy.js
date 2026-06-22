/**
 * As a drafted league user, I want a completed draft to automatically open a live match page showing every user's drafted
 * players and all available scraper stats, then have a background job finalize completed real matches with squad totals,
 * winner details, and a cached final stats snapshot, so that I can follow each squad's performance and preserve complete
 * match data for later analysis.
 */
describe('Live match drafted player stats', () => {
  const alicePasskey = 'alice-1111-1111-1111';
  const bobPasskey = 'bob-2222-2222-2222';

  let match;
  let matchLabel;
  let homeStarters;
  let homeBench;
  let awayStarters;

  const loadDraftableMatch = () => {
    cy.request('/api/matches').then(({ body }) => {
      match = body.find((candidate) => (
        new Date(candidate.date).getTime() > Date.now()
      ));

      expect(match, 'upcoming scraper match').to.exist;
      matchLabel = `${match.homeTeam} vs ${match.awayTeam}`;

      cy.request(`/api/drafts/${match.id}?passkey=${alicePasskey}`).then(({ body: draft }) => {
        expect(draft.match.lineups, 'draft page lineups').to.have.length(2);
        expect(draft.match.lineups.every((lineup) => lineup.starters.length === 11)).to.equal(true);

        homeStarters = draft.match.lineups[0].starters.map((player) => player.name);
        homeBench = draft.match.lineups[0].bench.map((player) => player.name);
        awayStarters = draft.match.lineups[1].starters.map((player) => player.name);
      });
    });
  };

  const setDraft = (draftState) => {
    cy.request('PUT', `/api/testing/drafts/${match.id}`, draftState)
      .its('status')
      .should('equal', 204);
  };

  const draftAs = (passkey, playerName) => {
    cy.request('POST', `/api/drafts/${match.id}/picks`, { passkey, playerName })
      .its('status')
      .should('equal', 200);
  };

  const clickDraft = (playerName) => {
    cy.contains('[data-test="draft-player"]', playerName).within(() => cy.contains('button', 'Draft').click());
  };

  const livePath = (passkey) => `/${passkey}/matches/${match.id}/live`;
  const draftPath = (passkey) => `/${passkey}/matches/${match.id}/draft`;
  const liveApiPath = (passkey) => `/api/matches/${match.id}/live?passkey=${passkey}`;
  const liveUpdatesPath = () => `/api/matches/${match.id}/live/updates`;
  const matchCard = () => cy.contains('[data-test="match-card"]', matchLabel);

  const completedPicks = () => [
    { userName: 'Alice', playerName: homeStarters[0] },
    { userName: 'Bob', playerName: awayStarters[0] },
    { userName: 'Alice', playerName: homeStarters[1] },
    { userName: 'Bob', playerName: awayStarters[1] },
    { userName: 'Alice', playerName: homeStarters[2] },
    { userName: 'Bob', playerName: awayStarters[2] }
  ];

  const completeDraft = () => {
    setDraft({
      status: 'completed',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: completedPicks()
    });
  };

  const watchWebSocketUrls = (win) => {
    const OriginalWebSocket = win.WebSocket;
    win.__webSocketUrls = [];

    function RecordingWebSocket(url, protocols) {
      win.__webSocketUrls.push(String(url));

      if (protocols === undefined) {
        return new OriginalWebSocket(url);
      }

      return new OriginalWebSocket(url, protocols);
    }

    RecordingWebSocket.prototype = OriginalWebSocket.prototype;
    RecordingWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
    RecordingWebSocket.OPEN = OriginalWebSocket.OPEN;
    RecordingWebSocket.CLOSING = OriginalWebSocket.CLOSING;
    RecordingWebSocket.CLOSED = OriginalWebSocket.CLOSED;
    win.WebSocket = RecordingWebSocket;
  };

  const startDraftWithOnePickRemaining = () => {
    setDraft({
      status: 'started',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: completedPicks().slice(0, 5)
    });
  };

  const setScraperMatchStatus = (status) => {
    cy.setScraperMatchStatus(match.id, status);
  };

  const setScraperLiveMatchStatus = (status) => {
    cy.setScraperLiveMatchStatus(match.id, status);
  };

  const clearCompletedLiveMatch = () => {
    cy.request('DELETE', `/api/testing/live-matches/${match.id}/completed`)
      .its('status')
      .should('equal', 204);
  };

  const cachedCompletedLiveMatch = () => cy.request(`/api/testing/live-matches/${match.id}/completed`);

  const runCompletedLiveMatchFinalizer = () => {
    cy.request('POST', '/api/testing/live-matches/finalize-completed')
      .its('status')
      .should('equal', 204);
  };

  beforeEach(() => {
    cy.resetScraperMatches();
    loadDraftableMatch();
    cy.then(() => cy.request('DELETE', `/api/testing/drafts/${match.id}`).its('status').should('equal', 204));
    cy.then(() => clearCompletedLiveMatch());
  });

  afterEach(() => {
    cy.resetScraperMatches();
  });

  // GIVEN a drafted player has scraper stats but none of those stats contribute points
  // WHEN Alice opens that player's live stats popup
  // THEN she sees a no-contributing-stats message instead of empty stat categories
  it('shows a no scoring stats message when scraper stats do not contribute points', () => {
    setDraft({
      status: 'completed',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: [
        { userName: 'Alice', playerName: homeBench[4] },
        { userName: 'Bob', playerName: awayStarters[0] },
        { userName: 'Alice', playerName: homeStarters[0] },
        { userName: 'Bob', playerName: awayStarters[1] },
        { userName: 'Alice', playerName: homeStarters[1] },
        { userName: 'Bob', playerName: awayStarters[2] }
      ]
    });

    cy.visit(livePath(alicePasskey));

    cy.contains('[data-test="live-tracker-player-card"]', homeBench[4]).click();
    cy.testGet('live-player-dialog').within(() => {
      cy.testGet('live-player-no-scoring-stats').should('be.visible').and('contain.text', 'No scoring stats yet');
      cy.testGet('live-player-stats').should('not.exist');
    });
  });

  // GIVEN Alice and Bob have an in-progress draft with one pick remaining and Bob has the draft page open
  // WHEN Bob makes the final pick
  // THEN Bob is automatically navigated to that match's live page
  it('automatically navigates the user who makes the final pick to the live page', () => {
    startDraftWithOnePickRemaining();

    cy.visit(draftPath(bobPasskey));
    clickDraft(awayStarters[2]);

    cy.location('pathname').should('equal', livePath(bobPasskey));
    cy.testGet('live-match-page').should('be.visible');
    cy.testGet('live-match-title').should('contain.text', matchLabel);
  });

  // GIVEN Alice has an in-progress draft page open and Bob has one pick remaining
  // WHEN Bob's final pick completes the draft from another session
  // THEN Alice is also automatically navigated to that match's live page
  it('automatically navigates other users watching the draft when the final pick completes it', () => {
    startDraftWithOnePickRemaining();

    cy.visit(draftPath(alicePasskey));
    cy.testGet('draft-page').should('be.visible');

    draftAs(bobPasskey, awayStarters[2]);

    cy.location('pathname').should('equal', livePath(alicePasskey));
    cy.testGet('live-match-page').should('be.visible');
    cy.testGet('live-match-title').should('contain.text', matchLabel);
  });

  // GIVEN a match has a completed draft and the scraper says the match has started but not finished
  // WHEN a logged-in user clicks that match card on the home page
  // THEN they are navigated directly to that match's live page and see the live match content
  it('opens the live match page when a user clicks an ongoing match from the home page', () => {
    completeDraft();
    setScraperMatchStatus({ started: true, finished: false });

    cy.visit(`/${alicePasskey}`);
    matchCard().click();

    cy.location('pathname').should('equal', livePath(alicePasskey));
    cy.testGet('live-match-page').should('be.visible');
    cy.testGet('live-match-title').should('contain.text', matchLabel);
  });

  // GIVEN a user opens a live match page by clicking an ongoing match from the home page
  // WHEN the live page loads
  // THEN the page connects to the live updates WebSocket for that match
  it('connects to the live match WebSocket after opening an ongoing match from the home page', () => {
    completeDraft();
    setScraperMatchStatus({ started: true, finished: false });

    cy.visit(`/${alicePasskey}`, { onBeforeLoad: watchWebSocketUrls });
    matchCard().click();

    cy.location('pathname').should('equal', livePath(alicePasskey));
    cy.window().its('__webSocketUrls').should((urls) => {
      expect(urls.some((url) => url.includes(liveUpdatesPath())), 'live match websocket url').to.equal(true);
    });
  });

  // GIVEN a draft is complete and Alice opens the live match page
  // WHEN the page loads
  // THEN all drafted squads are tracked by user, Alice's squad is first, and the lineup cards mark ownership
  it('shows every drafted squad with the current user first and drafted lineup cards highlighted', () => {
    setDraft({
      status: 'completed',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Bob', 'Alice'],
      picks: completedPicks()
    });

    cy.visit(livePath(alicePasskey));

    cy.testGet('live-squad').should('have.length', 2);
    cy.testGet('live-squad').first().should('contain.text', 'Alice').and('have.attr', 'data-current-user', 'true');
    cy.testGet('current-user-live-squad').should('contain.text', 'Alice');
    cy.testGet('live-tracker').should('contain.text', homeStarters[0]).and('contain.text', awayStarters[0]);
    cy.testGet('live-squad-points').should('have.length', 2).and('contain.text', 'pts');
    cy.contains('[data-test="live-player-card"]', homeStarters[0])
      .should('have.attr', 'data-current-user-player', 'true')
      .and('contain.text', 'Alice')
      .and('contain.text', 'pts');
    cy.contains('[data-test="live-player-card"]', awayStarters[0])
      .should('have.attr', 'data-opponent-player', 'true')
      .and('contain.text', 'Bob')
      .and('contain.text', 'pts');
  });

  // GIVEN a draft is complete and scraper stats are available for drafted players
  // WHEN Alice opens the live match page
  // THEN each drafted player shows scoring stat categories and stat fields that contribute points
  it('loads the first scraper stats state and shows scoring stat fields for drafted players', () => {
    completeDraft();

    cy.visit(livePath(alicePasskey));

    cy.testGet('live-player-card').should('have.length', 6);
    cy.contains('[data-test="live-player-card"]', homeStarters[1]).click();
    cy.testGet('live-player-dialog').within(() => {
      cy.testGet('live-player-team').should('contain.text', match.homeTeam);
      cy.testGet('live-player-stats').should('contain.text', 'Attack');
      cy.testGet('live-player-stats').should('contain.text', 'Touches in opposition box');
      cy.testGet('live-player-stats').should('contain.text', 'Defense');
      cy.testGet('live-player-stats').should('contain.text', 'Clearances');
    });
  });

  // GIVEN a draft is complete and Alice has the live match page open
  // WHEN she opens a player's live stats popup
  // THEN the popup shows each contributing stat row's value and points used by the live tracker
  it('shows contributing live stat rows and points in the player popup', () => {
    completeDraft();

    cy.visit(livePath(alicePasskey));

    cy.contains('[data-test="live-player-card"]', homeStarters[1]).click();
    cy.testGet('live-player-dialog').within(() => {
      cy.testGet('live-player-dialog-points').should('contain.text', 'pts');
      cy.contains('[data-test="live-stat-row"]', 'Touches in opposition box').within(() => {
        cy.testGet('live-stat-value').should('not.be.empty');
        cy.testGet('live-stat-points').should('contain.text', 'pts');
      });
    });
  });

  // GIVEN a drafted player has live stats with both scoring and non-scoring stat rows
  // WHEN Alice opens that player's live stats popup
  // THEN only stat rows with a non-zero point contribution are shown
  it('hides stat rows that do not contribute points', () => {
    completeDraft();

    cy.visit(livePath(alicePasskey));

    cy.contains('[data-test="live-player-card"]', homeStarters[1]).click();
    cy.testGet('live-player-dialog').within(() => {
      cy.contains('[data-test="live-stat-row"]', 'Touches in opposition box').scrollIntoView().should('be.visible');
      cy.contains('[data-test="live-stat-row"]', 'Clearances').scrollIntoView().should('be.visible');
      cy.contains('[data-test="live-stat-row"]', 'Accurate passes').should('not.exist');
      cy.contains('[data-test="live-stat-row"]', 'Expected goals').should('not.exist');
      cy.contains('[data-test="live-stat-row"]', 'Expected goals on target faced').should('not.exist');
      cy.testGet('live-stat-points').each(($points) => {
        expect($points.text().trim()).not.to.equal('0 pts');
      });
    });
  });

  // GIVEN a draft is not complete
  // WHEN Alice opens that match's live page directly
  // THEN she is not shown the live match stats page and sees a message that the match has not started yet
  it('does not show live match stats before the draft is complete', () => {
    setDraft({
      status: 'started',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: completedPicks().slice(0, 2)
    });

    cy.visit(livePath(alicePasskey));

    cy.testGet('live-match-unavailable').should('be.visible').and('contain.text', 'Match has not started yet');
    cy.testGet('live-match-page').should('not.exist');
    cy.testGet('live-player-card').should('not.exist');
  });

  // GIVEN a match is ongoing but its draft is not complete
  // WHEN a logged-in user clicks that match card on the home page
  // THEN they open the existing draft instead of the live match page
  it('opens the draft when an ongoing match is clicked before its draft is complete', () => {
    setDraft({
      status: 'started',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: completedPicks().slice(0, 2)
    });
    setScraperMatchStatus({ started: true, finished: false });

    cy.visit(`/${alicePasskey}`);
    matchCard().click();

    cy.location('pathname').should('equal', draftPath(alicePasskey));
    cy.testGet('draft-page').should('be.visible');
    cy.testGet('draft-status').should('contain.text', 'Draft in progress');
    cy.testGet('live-player-card').should('not.exist');
  });

  // GIVEN a draft is complete but a drafted player has no returned scraper stats yet
  // WHEN Alice opens the live match page
  // THEN that drafted player is still shown with a no-stats state instead of breaking the page
  it('shows drafted players without scraper stats using a no-stats state', () => {
    setDraft({
      status: 'completed',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: [
        { userName: 'Alice', playerName: 'Unknown Academy Player' },
        { userName: 'Bob', playerName: awayStarters[0] },
        { userName: 'Alice', playerName: homeStarters[1] },
        { userName: 'Bob', playerName: awayStarters[1] },
        { userName: 'Alice', playerName: homeStarters[2] },
        { userName: 'Bob', playerName: awayStarters[2] }
      ]
    });

    cy.visit(livePath(alicePasskey));

    cy.contains('[data-test="live-tracker-player-card"]', 'Unknown Academy Player').click();
    cy.testGet('live-player-dialog').within(() => {
      cy.testGet('live-player-no-stats').should('be.visible').and('contain.text', 'No stats available yet');
      cy.testGet('live-player-stats').should('not.exist');
    });
    cy.testGet('live-player-dialog-close').click();
    cy.contains('[data-test="live-player-card"]', awayStarters[0]).click();
    cy.testGet('live-player-dialog').within(() => {
      cy.testGet('live-player-stats').should('exist');
    });
  });

  // GIVEN a visitor does not have a valid passkey
  // WHEN they open a match live page directly
  // THEN they see the existing no-access page instead of live match content
  it('does not show live match content to visitors without a valid passkey', () => {
    setDraft({
      status: 'completed',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: completedPicks()
    });

    cy.visit(`/mallory-9999-9999-9999/matches/${match.id}/live`);

    cy.testGet('no-access').should('be.visible').and('contain.text', 'No access');
    cy.testGet('live-match-page').should('not.exist');
    cy.testGet('live-player-card').should('not.exist');
  });

  // GIVEN a draft is complete, the scraper says the match has finished, and final player stats are available
  // WHEN Alice opens that match's live page
  // THEN the page shows the completed match result, each drafted squad's final total, and the winning user based on drafted players' points
  it('shows the completed match winner and final squad totals after the scraper marks the match finished', () => {
    completeDraft();
    setScraperMatchStatus({ started: true, finished: true });

    cy.visit(livePath(alicePasskey), {
      onBeforeLoad(win) {
        win.__copiedLiveMatchShareText = '';
        Object.defineProperty(win.navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText(text) {
              win.__copiedLiveMatchShareText = text;
              return Promise.resolve();
            }
          }
        });
      }
    });

    cy.testGet('live-match-result').should('be.visible').and('contain.text', 'Final result');
    cy.testGet('live-match-winner').should('be.visible').and('contain.text', 'Winner');
    cy.testGet('live-match-share-button').should('be.visible').and('contain.text', 'Copy final scores').click();
    cy.testGet('live-match-share-status').should('be.visible').and('contain.text', 'Copied brag to clipboard');
    cy.testGet('live-squad').each(($squad) => {
      cy.wrap($squad).find('[data-test="live-squad-final-points"]').should('contain.text', 'pts');
    });
    cy.testGet('live-match-page').invoke('text').then((pageText) => {
      cachedCompletedLiveMatch().then(({ body }) => {
        expect(body.winners, 'cached winners').to.have.length.greaterThan(0);
        body.winners.forEach((winner) => expect(pageText).to.contain(winner));
        body.squads.forEach((squad) => {
          expect(pageText).to.contain(squad.userName);
          expect(pageText).to.contain(`${squad.totalPoints} pts`);
        });
        cy.window().its('__copiedLiveMatchShareText').then((shareText) => {
          expect(shareText).to.contain(`Farmers League final: ${match.homeTeam} vs ${match.awayTeam}`);
          body.winners.forEach((winner) => expect(shareText).to.contain(winner));
          body.squads.forEach((squad) => {
            expect(shareText).to.contain(`${squad.userName}: ${squad.totalPoints} pts`);
          });
          completedPicks().forEach((pick) => {
            expect(shareText).to.contain(`- ${pick.playerName}:`);
            expect(shareText).to.contain(' pts');
          });
        });
      });
    });
  });

  // GIVEN a draft is complete and the live match has started
  // WHEN the scraper marks the match finished and the background finalization job runs
  // THEN Redis stores a completed match result containing match teams, final score, winners, squad totals, drafted ownership indicators, all player stats, every player's calculated points, and the scoring config snapshot
  it('archives a finished drafted live match from the background job with all player stats and ownership indicators', () => {
    completeDraft();
    setScraperMatchStatus({ started: true, finished: true, score: '2 - 1' });

    runCompletedLiveMatchFinalizer();

    cachedCompletedLiveMatch().then(({ body }) => {
      expect(body.match.id).to.equal(match.id);
      expect(body.match.homeTeam).to.equal(match.homeTeam);
      expect(body.match.awayTeam).to.equal(match.awayTeam);
      expect(body.match.score).to.equal('2 - 1');
      expect(body.winners, 'winners').to.have.length.greaterThan(0);
      expect(body.squads.map((squad) => squad.userName)).to.have.members(['Alice', 'Bob']);
      expect(body.draftedPlayerStats, 'drafted player stats').to.have.length(6);
      expect(body.allPlayerStats, 'all player stats').to.have.length.greaterThan(body.draftedPlayerStats.length);
      expect(body.allPlayerStats.map((player) => player.name), 'undrafted bench stats').to.include(homeBench[0]);
      expect(body.allPlayerStats.find((player) => player.name === homeStarters[0])).to.include({ draftedBy: 'Alice' });
      expect(body.allPlayerStats.find((player) => player.name === awayStarters[0])).to.include({ draftedBy: 'Bob' });
      expect(body.allPlayerStats.find((player) => player.name === homeBench[0])).to.include({ draftedBy: null });
      expect(body.allPlayerStats.every((player) => typeof player.totalPoints === 'number'), 'all archived player point totals').to.equal(true);
      expect(body.allPlayerStats.find((player) => player.name === homeBench[0]).totalPoints, 'undrafted player point total').to.be.at.least(0);
      expect(body.allPlayerStats.every((player) => player.team), 'all archived player teams').to.equal(true);
      expect(body.allPlayerStats.every((player) => player.stats), 'all archived player stats').to.equal(true);
      expect(body.pointsConfig, 'points config snapshot').to.include({ goals: 10, goals_prevented: 10 });
    });
  });

  // GIVEN the completed match archive includes drafted and undrafted player stats
  // WHEN the background finalization job stores the completed result in Redis
  // THEN each archived all-player total is calculated with the same scoring config used for the final squad totals
  it('stores calculated point totals for every archived player using the scoring config snapshot', () => {
    completeDraft();
    setScraperMatchStatus({ started: true, finished: true });

    runCompletedLiveMatchFinalizer();

    cachedCompletedLiveMatch().then(({ body }) => {
      const calculatePoints = (player) => Object.values(player.stats.reduce((statsByKey, stat) => {
        if (statsByKey[stat.key] === undefined) {
          statsByKey[stat.key] = stat;
        }

        return statsByKey;
      }, {})).reduce((total, stat) => {
        const multiplier = body.pointsConfig[stat.key] ?? 0;
        const value = Number.isFinite(Number(stat.value)) ? Math.round(Number(stat.value)) : 0;

        return total + value * multiplier;
      }, 0);

      body.allPlayerStats.forEach((player) => {
        expect(player.totalPoints, `${player.name} total points`).to.equal(calculatePoints(player));
      });
    });
  });

  // GIVEN a completed match result has been finalized with drafted and undrafted player stats
  // WHEN the frontend requests the live match page data
  // THEN the API response includes only drafted players' stats and does not include the all-player archive or undrafted player totals
  it('does not send undrafted player stats to the frontend live match response', () => {
    completeDraft();
    setScraperMatchStatus({ started: true, finished: true });
    runCompletedLiveMatchFinalizer();

    cy.request(liveApiPath(alicePasskey)).then(({ body }) => {
      const frontendPlayerNames = body.squads.flatMap((squad) => squad.players.map((player) => player.name));

      expect(frontendPlayerNames).to.have.members(completedPicks().map((pick) => pick.playerName));
      expect(frontendPlayerNames).not.to.include(homeBench[0]);
      expect(body.allPlayerStats, 'analysis-only all player stats').to.equal(undefined);
      expect(body.draftedPlayerStats, 'analysis-only drafted stats snapshot').to.equal(undefined);
      expect(body.squads.flatMap((squad) => squad.players).some((player) => player.totalPoints !== undefined), 'analysis-only player total points').to.equal(false);
      expect(body.finalResult.winners, 'frontend winner summary').to.have.length.greaterThan(0);
    });
  });

  // GIVEN a completed drafted live match has already been archived in Redis
  // WHEN the background finalization job runs again for the same finished match
  // THEN the existing archived result is reused and not overwritten
  it('does not overwrite an existing archived result when the background job runs again', () => {
    completeDraft();
    setScraperMatchStatus({ started: true, finished: true });

    runCompletedLiveMatchFinalizer();
    cachedCompletedLiveMatch().then(({ body: firstCachedResult }) => {
      runCompletedLiveMatchFinalizer();
      runCompletedLiveMatchFinalizer();

      cachedCompletedLiveMatch().then(({ body: laterCachedResult }) => {
        expect(laterCachedResult.finalizedAt).to.equal(firstCachedResult.finalizedAt);
        expect(laterCachedResult.winners).to.deep.equal(firstCachedResult.winners);
        expect(laterCachedResult.squads).to.deep.equal(firstCachedResult.squads);
        expect(laterCachedResult.pointsConfig).to.deep.equal(firstCachedResult.pointsConfig);
      });
    });
  });

  // GIVEN Alice has a completed draft's live match page open while the real match is ongoing
  // WHEN the live scraper poll receives a Full-Time match status from the match stats page
  // THEN Alice's open page receives a WebSocket update, shows the final winner, and archives the full completed match for stats exploration
  it('finalizes and archives an open live match from the live stats full-time update', () => {
    completeDraft();
    setScraperMatchStatus({ started: true, finished: false });

    cy.visit(livePath(alicePasskey));
    cy.testGet('live-match-page').should('be.visible');
    cy.testGet('live-match-result').should('not.exist');

    setScraperLiveMatchStatus({ started: true, finished: true, score: '2 - 1' });

    cy.testGet('live-match-result', { timeout: 35000 }).should('be.visible').and('contain.text', 'Final result');
    cy.testGet('live-match-winner').should('be.visible').and('contain.text', 'Winner');
    cy.testGet('live-match-page').invoke('text').then((pageText) => {
      cachedCompletedLiveMatch().then(({ body }) => {
        expect(body.match.id).to.equal(match.id);
        expect(body.match.hasStarted).to.equal(true);
        expect(body.match.hasFinished).to.equal(true);
        expect(body.match.score).to.equal('2 - 1');
        expect(body.winners, 'archived winners').to.have.length.greaterThan(0);
        expect(body.squads.map((squad) => squad.userName)).to.have.members(['Alice', 'Bob']);
        expect(body.draftedPlayerStats, 'archived drafted player stats').to.have.length(6);
        expect(body.allPlayerStats, 'archived all player stats').to.have.length.greaterThan(body.draftedPlayerStats.length);
        expect(body.allPlayerStats.map((player) => player.name), 'archived bench stats').to.include(homeBench[0]);
        expect(body.pointsConfig, 'archived scoring config snapshot').to.include({ goals: 10, goals_prevented: 10 });
        body.winners.forEach((winner) => expect(pageText).to.contain(winner));
      });
    });
  });

  // GIVEN a match has a draft that is open or in progress but not completed
  // WHEN the scraper marks the match finished and the background finalization job runs
  // THEN Redis does not store a completed match result
  it('does not archive a finished match when its draft is not completed', () => {
    setDraft({
      status: 'started',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: completedPicks().slice(0, 2)
    });
    setScraperMatchStatus({ started: true, finished: true });

    runCompletedLiveMatchFinalizer();

    cy.request({
      url: `/api/testing/live-matches/${match.id}/completed`,
      failOnStatusCode: false
    }).its('status').should('equal', 404);
  });

  // GIVEN a match has no draft
  // WHEN the scraper marks the match finished and the background finalization job runs
  // THEN Redis does not store a completed match result
  it('does not archive a finished match that has no draft', () => {
    setScraperMatchStatus({ started: true, finished: true });

    runCompletedLiveMatchFinalizer();

    cy.request({
      url: `/api/testing/live-matches/${match.id}/completed`,
      failOnStatusCode: false
    }).its('status').should('equal', 404);
  });

  // GIVEN a draft is complete, the scraper says the match has finished, and two or more users have the same highest final score
  // WHEN Alice opens that match's live page
  // THEN the page shows the match ended in a tie and lists all tied users as winners
  it('shows a tied final result when multiple users share the highest final score', () => {
    completeDraft();
    cy.request('PUT', `/api/testing/live-matches/${match.id}/completed`, {
      match,
      winners: ['Alice', 'Bob'],
      squads: [
        { userName: 'Alice', totalPoints: 12 },
        { userName: 'Bob', totalPoints: 12 }
      ],
      draftedPlayerStats: [],
      allPlayerStats: [],
      pointsConfig: { goals: 10 },
      finalizedAt: new Date().toISOString()
    }).its('status').should('equal', 204);
    setScraperMatchStatus({ started: true, finished: true });

    cy.visit(livePath(alicePasskey));

    cy.testGet('live-match-result').should('be.visible').and('contain.text', 'Tie');
    cy.testGet('live-match-tie-winners').should('contain.text', 'Alice').and('contain.text', 'Bob');
    cy.testGet('live-squad-final-points').should('contain.text', '12 pts');
  });

  // GIVEN a draft is complete and the scraper says the match has started but has not finished
  // WHEN the background finalization job runs and Alice opens the live match page
  // THEN Redis does not store a completed match result and the page continues to show live squad totals without a final winner banner
  it('does not archive or show a final winner while the match is still ongoing', () => {
    completeDraft();
    setScraperMatchStatus({ started: true, finished: false });

    runCompletedLiveMatchFinalizer();
    cy.visit(livePath(alicePasskey));

    cy.testGet('live-match-page').should('be.visible');
    cy.testGet('live-squad-points').should('have.length', 2).and('contain.text', 'pts');
    cy.testGet('live-match-result').should('not.exist');
    cy.testGet('live-match-share-button').should('not.exist');
    cy.request({
      url: `/api/testing/live-matches/${match.id}/completed`,
      failOnStatusCode: false
    }).its('status').should('equal', 404);
  });
});
