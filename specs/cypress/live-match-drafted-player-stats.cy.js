/**
 * As a drafted league user, I want a completed draft to automatically open a live match page showing every user's drafted
 * players and all available scraper stats, then have a background job finalize completed real matches with squad totals,
 * winner details, and a cached final stats snapshot, so that I can follow each squad's performance and preserve complete
 * match data for later analysis.
 */
describe('Live match drafted player stats', () => {
  const alicePasskey = 'alice-1111-1111-1111';
  const bobPasskey = 'bob-2222-2222-2222';
  const matchId = Cypress.env('mockMatches').confirmedLineups;

  let match;
  let matchLabel;
  let homeStarters;
  let homeBench;
  let awayStarters;

  const loadDraftableMatch = () => {
    cy.getMockMatch(matchId).then((mockMatch) => {
      match = mockMatch;
      matchLabel = `${match.homeTeam} vs ${match.awayTeam}`;

      cy.getDraftLineups(matchId, alicePasskey).then((draft) => {
        expect(draft.lineups, 'draft page lineups').to.have.length(2);
        expect(draft.lineups.every((lineup) => lineup.starters.length === 11)).to.equal(true);

        homeStarters = draft.homeStarters;
        homeBench = draft.homeBench;
        awayStarters = draft.awayStarters;
      });
    });
  };

  const draftAs = (passkey, playerName) => {
    cy.arrangeDraftPick(match.id, passkey, playerName);
  };

  const clickDraft = (playerName) => {
    cy.contains('[data-test="draft-player"]', playerName).within(() => cy.contains('button', 'Draft').click());
  };

  const livePath = (passkey) => `/${passkey}/matches/${match.id}/live`;
  const draftPath = (passkey) => `/${passkey}/matches/${match.id}/draft`;

  const matchCard = () => {
    return cy.findMatchCard(matchLabel);
  };

  const completedPicks = () => [
    { userName: 'Alice', playerName: homeStarters[0] },
    { userName: 'Bob', playerName: awayStarters[0] },
    { userName: 'Alice', playerName: homeStarters[1] },
    { userName: 'Bob', playerName: awayStarters[1] },
    { userName: 'Alice', playerName: homeStarters[2] },
    { userName: 'Bob', playerName: awayStarters[2] }
  ];

  const completeDraft = () => {
    cy.arrangeCompletedDraft(match.id, { draftOrder: ['Alice', 'Bob'], picks: completedPicks() });
  };

  const startDraftWithOnePickRemaining = () => {
    cy.arrangeStartedDraft(match.id, { draftOrder: ['Alice', 'Bob'], picks: completedPicks().slice(0, 5) });
  };

  const arrangeOngoingMatch = () => cy.arrangeOngoingMatch(match.id);
  const arrangeFinishedMatch = (options = {}) => cy.arrangeFinishedMatch(match.id, options);

  const setScraperLiveMatchStatus = (status) => {
    cy.setScraperLiveMatchStatus(match.id, status);
  };

  const clearCompletedLiveMatch = () => {
    cy.clearCompletedLiveMatch(match.id);
  };

  const cachedCompletedLiveMatch = () => cy.getCompletedLiveMatch(match.id);

  const openLiveMatchAndFinalize = () => {
    cy.visitWithWorkingClipboard(livePath(alicePasskey));
    cy.testGet('live-match-result').should('be.visible').and('contain.text', 'Final result');
  };

  const archiveFinishedMatch = (status = { started: true, finished: true }) => {
    completeDraft();
    arrangeFinishedMatch({ score: status.score ?? null });
    openLiveMatchAndFinalize();
    return cachedCompletedLiveMatch();
  };

  beforeEach(() => {
    cy.resetTestState();
    loadDraftableMatch();
    cy.then(() => cy.arrangeNoDraft(match.id));
  });

  it('shows a no scoring stats message when scraper stats do not contribute points', () => {
    cy.arrangeCompletedDraft(match.id, {
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

  it('automatically navigates the user who makes the final pick to the live page', () => {
    startDraftWithOnePickRemaining();

    cy.visit(draftPath(bobPasskey));
    clickDraft(awayStarters[2]);

    cy.location('pathname').should('equal', livePath(bobPasskey));
    cy.testGet('live-match-page').should('be.visible');
    cy.testGet('live-match-title').should('contain.text', matchLabel);
  });

  it('automatically navigates other users watching the draft when the final pick completes it', () => {
    startDraftWithOnePickRemaining();

    cy.visit(draftPath(alicePasskey));
    cy.testGet('draft-page').should('be.visible');

    draftAs(bobPasskey, awayStarters[2]);

    cy.location('pathname').should('equal', livePath(alicePasskey));
    cy.testGet('live-match-page').should('be.visible');
    cy.testGet('live-match-title').should('contain.text', matchLabel);
  });

  it('opens the live match page when a user clicks an ongoing match from the home page', () => {
    completeDraft();
    arrangeOngoingMatch();

    cy.visit(`/${alicePasskey}`);
    matchCard().click();

    cy.location('pathname').should('equal', livePath(alicePasskey));
    cy.testGet('live-match-page').should('be.visible');
    cy.testGet('live-match-title').should('contain.text', matchLabel);
  });

  it('shows every drafted squad with the current user first and drafted lineup cards highlighted', () => {
    cy.arrangeCompletedDraft(match.id, {
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

  it('shows subbed off indicators for drafted squad players', () => {
    completeDraft();

    cy.visit(livePath(alicePasskey));

    cy.contains('[data-test="live-tracker-player-card"]', homeStarters[1]).within(() => {
      cy.testGet('live-player-subbed-off')
        .should('contain.text', '↔')
        .and('have.attr', 'title', 'Subbed off 64\' for Canada Substitute 1');
    });
    cy.contains('[data-test="live-player-card"]', homeStarters[1]).within(() => {
      cy.testGet('live-lineup-player-subbed-off')
        .should('contain.text', '↔')
        .and('have.attr', 'title', 'Subbed off 64\' for Canada Substitute 1');
    });
  });

  it('shows subbed off indicators for all live lineup players', () => {
    completeDraft();

    cy.visit(livePath(alicePasskey));

    cy.contains('[data-test="live-lineup-player"]', 'Jonathan David').within(() => {
      cy.testGet('live-lineup-player-subbed-off')
        .should('contain.text', '↔')
        .and('have.attr', 'title', 'Subbed off 79\' for Canada Substitute 2');
    });
  });

  it('shows substitution details in drafted player popups', () => {
    completeDraft();

    cy.visit(livePath(alicePasskey));

    cy.contains('[data-test="live-tracker-player-card"]', homeStarters[1]).click();
    cy.testGet('live-player-dialog').within(() => {
      cy.testGet('live-player-dialog-subbed-off')
        .should('contain.text', 'Subbed off 64\'')
        .and('contain.text', 'Canada Substitute 1');
    });
    cy.testGet('live-player-dialog-close').click();
  });

  it('shows substitution details in live lineup player popups', () => {
    completeDraft();

    cy.visit(livePath(alicePasskey));

    cy.contains('[data-test="live-lineup-player"]', 'Jonathan David').find('button').click();
    cy.testGet('live-player-dialog').within(() => {
      cy.testGet('live-player-dialog-subbed-off')
        .should('contain.text', 'Subbed off 79\'')
        .and('contain.text', 'Canada Substitute 2');
    });
  });

  it('shows a disabled substitution action for undrafted starters before kickoff', () => {
    completeDraft();
    cy.arrangeUpcomingMatch(match.id);

    cy.visit(livePath(alicePasskey));

    cy.contains('[data-test="live-lineup-player"]', homeStarters[3]).find('button').click();
    cy.testGet('live-player-dialog').within(() => {
      cy.testGet('live-substitution-button')
        .should('be.visible')
        .and('be.disabled')
        .and('contain.text', 'Substitute into my squad');
      cy.testGet('live-substitution-unavailable-reason')
        .should('contain.text', 'Available when the match starts');
    });
  });

  it('shows an enabled substitution action for undrafted starters after kickoff', () => {
    completeDraft();
    arrangeOngoingMatch();

    cy.visit(livePath(alicePasskey));

    cy.contains('[data-test="live-lineup-player"]', homeStarters[3]).find('button').click();
    cy.testGet('live-player-dialog').within(() => {
      cy.testGet('live-substitution-button')
        .should('be.visible')
        .and('be.enabled')
        .and('contain.text', 'Substitute into my squad');
      cy.testGet('live-substitution-unavailable-reason').should('not.exist');
    });
  });

  it('enables substitution actions from a live tracker started update', () => {
    completeDraft();
    cy.arrangeUpcomingMatch(match.id);

    cy.visit(livePath(alicePasskey));
    cy.testGet('live-match-page').should('be.visible');

    setScraperLiveMatchStatus({ started: true, finished: false });

    cy.contains('[data-test="live-lineup-player"]', homeStarters[3]).find('button').click();
    cy.testGet('live-player-dialog').within(() => {
      cy.testGet('live-substitution-button', { timeout: 35000 })
        .should('be.visible')
        .and('be.enabled')
        .and('contain.text', 'Substitute into my squad');
      cy.testGet('live-substitution-unavailable-reason').should('not.exist');
    });
  });

  it('does not show a substitution action for already drafted players', () => {
    completeDraft();
    arrangeOngoingMatch();

    cy.visit(livePath(alicePasskey));

    cy.contains('[data-test="live-lineup-player"]', homeStarters[0]).find('button').click();
    cy.testGet('live-player-dialog').within(() => {
      cy.testGet('live-substitution-button').should('not.exist');
      cy.testGet('live-substitution-unavailable-reason').should('not.exist');
    });
  });

  it('does not show a substitution action for players drafted by opponents', () => {
    completeDraft();
    arrangeOngoingMatch();

    cy.visit(livePath(alicePasskey));

    cy.contains('[data-test="live-lineup-player"]', awayStarters[0]).find('button').click();
    cy.testGet('live-player-dialog').within(() => {
      cy.testGet('live-substitution-button').should('not.exist');
      cy.testGet('live-substitution-unavailable-reason').should('not.exist');
    });
  });

  it('does not show a substitution action for undrafted players who have been subbed off', () => {
    completeDraft();
    arrangeOngoingMatch();

    cy.visit(livePath(alicePasskey));

    cy.contains('[data-test="live-lineup-player"]', 'Jonathan David').find('button').click();
    cy.testGet('live-player-dialog').within(() => {
      cy.testGet('live-player-dialog-subbed-off').should('contain.text', 'Subbed off 79\'');
      cy.testGet('live-substitution-button').should('not.exist');
      cy.testGet('live-substitution-unavailable-reason').should('not.exist');
    });
  });

  it('does not show a substitution action after the match is finished', () => {
    completeDraft();
    arrangeFinishedMatch();

    cy.visit(livePath(alicePasskey));

    cy.contains('[data-test="live-lineup-player"]', homeStarters[3]).find('button').click();
    cy.testGet('live-player-dialog').within(() => {
      cy.testGet('live-substitution-button').should('not.exist');
      cy.testGet('live-substitution-unavailable-reason').should('not.exist');
    });
  });

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

  it('does not show live match stats before the draft is complete', () => {
    cy.arrangeStartedDraft(match.id, {
      draftOrder: ['Alice', 'Bob'],
      picks: completedPicks().slice(0, 2)
    });

    cy.visit(livePath(alicePasskey));

    cy.testGet('live-match-unavailable').should('be.visible').and('contain.text', 'Match has not started yet');
    cy.testGet('live-match-page').should('not.exist');
    cy.testGet('live-player-card').should('not.exist');
  });

  it('opens the draft when an ongoing match is clicked before its draft is complete', () => {
    cy.arrangeStartedDraft(match.id, {
      draftOrder: ['Alice', 'Bob'],
      picks: completedPicks().slice(0, 2)
    });
    arrangeOngoingMatch();

    cy.visit(`/${alicePasskey}`);
    cy.findMatchCard(matchLabel).click();

    cy.location('pathname').should('equal', draftPath(alicePasskey));
    cy.testGet('draft-page').should('be.visible');
    cy.testGet('draft-status').should('contain.text', 'Draft in progress');
    cy.testGet('live-player-card').should('not.exist');
  });

  it('shows drafted players without scraper stats using a no-stats state', () => {
    cy.arrangeCompletedDraft(match.id, {
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
  });

  it('does not show live match content to visitors without a valid passkey', () => {
    completeDraft();

    cy.visit(`/mallory-9999-9999-9999/matches/${match.id}/live`);

    cy.testGet('no-access').should('be.visible').and('contain.text', 'No access');
    cy.testGet('live-match-page').should('not.exist');
    cy.testGet('live-player-card').should('not.exist');
  });

  it('shows the completed match winner and final squad totals after the scraper marks the match finished', () => {
    completeDraft();
    arrangeFinishedMatch();

    cy.visit(livePath(alicePasskey));

    cy.testGet('live-match-result').should('be.visible').and('contain.text', 'Final result');
    cy.testGet('live-match-winner').should('be.visible').and('contain.text', 'Winner');
    cy.testGet('live-match-share-button').should('be.visible').and('contain.text', 'Copy final scores').click();
    cy.testGet('live-match-share-status').should('be.visible').and('contain.text', 'Copied brag to clipboard');
    cy.testGet('live-squad').each(($squad) => {
      cy.wrap($squad).find('[data-test="live-squad-final-points"]').should('contain.text', 'pts');
    });
  });

  it('archives the finished match summary after live page finalization', () => {
    archiveFinishedMatch({ started: true, finished: true, score: '2 - 1' }).then((body) => {
      expect(body.match.id).to.equal(match.id);
      expect(body.match.homeTeam).to.equal(match.homeTeam);
      expect(body.match.awayTeam).to.equal(match.awayTeam);
      expect(body.match.score).to.equal('2 - 1');
      expect(body.winners, 'winners').to.have.length.greaterThan(0);
      expect(body.squads.map((squad) => squad.userName)).to.have.members(['Alice', 'Bob']);
    });
  });

  it('archives all scraper player stats after live page finalization', () => {
    archiveFinishedMatch().then((body) => {
      expect(body.draftedPlayerStats, 'drafted player stats').to.have.length(6);
      expect(body.allPlayerStats, 'all player stats').to.have.length.greaterThan(body.draftedPlayerStats.length);
      expect(body.allPlayerStats.map((player) => player.name), 'undrafted bench stats').to.include(homeBench[0]);
      expect(body.allPlayerStats.every((player) => typeof player.totalPoints === 'number'), 'all archived player point totals').to.equal(true);
      expect(body.allPlayerStats.find((player) => player.name === homeBench[0]).totalPoints, 'undrafted player point total').to.be.at.least(0);
      expect(body.allPlayerStats.every((player) => player.team), 'all archived player teams').to.equal(true);
      expect(body.allPlayerStats.every((player) => player.stats), 'all archived player stats').to.equal(true);
    });
  });

  it('archives drafted ownership for every archived player', () => {
    archiveFinishedMatch().then((body) => {
      expect(body.allPlayerStats.find((player) => player.name === homeStarters[0])).to.include({ draftedBy: 'Alice' });
      expect(body.allPlayerStats.find((player) => player.name === awayStarters[0])).to.include({ draftedBy: 'Bob' });
      expect(body.allPlayerStats.find((player) => player.name === homeBench[0])).to.include({ draftedBy: null });
    });
  });

  it('archives the scoring config snapshot with the completed result', () => {
    archiveFinishedMatch().then((body) => {
      expect(body.pointsConfig, 'points config snapshot').to.include({ goals: 6, goals_prevented: 6 });
    });
  });

  it('stores calculated point totals for every archived player using the scoring config snapshot', () => {
    completeDraft();
    arrangeFinishedMatch();

    openLiveMatchAndFinalize();

    cachedCompletedLiveMatch().then((body) => {
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

  it('does not overwrite an existing archived result when the live page opens again', () => {
    completeDraft();
    arrangeFinishedMatch();

    openLiveMatchAndFinalize();
    cachedCompletedLiveMatch().then((firstCachedResult) => {
      cy.visit(livePath(alicePasskey));
      cy.testGet('live-match-result').should('be.visible');
      cy.visit(livePath(bobPasskey));
      cy.testGet('live-match-result').should('be.visible');

      cachedCompletedLiveMatch().then((laterCachedResult) => {
        expect(laterCachedResult.finalizedAt).to.equal(firstCachedResult.finalizedAt);
        expect(laterCachedResult.winners).to.deep.equal(firstCachedResult.winners);
        expect(laterCachedResult.squads).to.deep.equal(firstCachedResult.squads);
        expect(laterCachedResult.pointsConfig).to.deep.equal(firstCachedResult.pointsConfig);
      });
    });
  });

  it('finalizes and archives an open live match from the live stats full-time update', () => {
    completeDraft();
    arrangeOngoingMatch();

    cy.visit(livePath(alicePasskey));
    cy.testGet('live-match-page').should('be.visible');
    cy.testGet('live-match-result').should('not.exist');

    setScraperLiveMatchStatus({ started: true, finished: true, score: '2 - 1' });

    cy.testGet('live-match-result', { timeout: 35000 }).should('be.visible').and('contain.text', 'Final result');
    cy.testGet('live-match-winner').should('be.visible').and('contain.text', 'Winner');
    cy.testGet('live-match-page').invoke('text').then((pageText) => {
      cachedCompletedLiveMatch().then((body) => {
        expect(body.match.id).to.equal(match.id);
        expect(body.match.hasStarted).to.equal(true);
        expect(body.match.hasFinished).to.equal(true);
        expect(body.match.score).to.equal('2 - 1');
        expect(body.winners, 'archived winners').to.have.length.greaterThan(0);
        expect(body.squads.map((squad) => squad.userName)).to.have.members(['Alice', 'Bob']);
        expect(body.draftedPlayerStats, 'archived drafted player stats').to.have.length(6);
        expect(body.allPlayerStats, 'archived all player stats').to.have.length.greaterThan(body.draftedPlayerStats.length);
        expect(body.allPlayerStats.map((player) => player.name), 'archived bench stats').to.include(homeBench[0]);
        expect(body.pointsConfig, 'archived scoring config snapshot').to.include({ goals: 6, goals_prevented: 6 });
        body.winners.forEach((winner) => expect(pageText).to.contain(winner));
      });
    });
  });

  it('does not archive a finished match when its draft is not completed', () => {
    cy.arrangeStartedDraft(match.id, {
      draftOrder: ['Alice', 'Bob'],
      picks: completedPicks().slice(0, 2)
    });
    arrangeFinishedMatch();

    cy.assertLiveMatchUnavailable(match.id, alicePasskey);
    cy.getCompletedLiveMatchOrNull(match.id).should('equal', null);
  });

  it('does not archive a finished match that has no draft', () => {
    arrangeFinishedMatch();

    cy.assertLiveMatchUnavailable(match.id, alicePasskey);
    cy.getCompletedLiveMatchOrNull(match.id).should('equal', null);
  });

  it('shows a tied final result when multiple users share the highest final score', () => {
    completeDraft();
    cy.setCompletedLiveMatch(match.id, {
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
    });
    arrangeFinishedMatch();

    cy.visit(livePath(alicePasskey));

    cy.testGet('live-match-result').should('be.visible').and('contain.text', 'Tie');
    cy.testGet('live-match-tie-winners').should('contain.text', 'Alice').and('contain.text', 'Bob');
    cy.testGet('live-squad-final-points').should('contain.text', '12 pts');
  });

  it('does not archive or show a final winner while the match is still ongoing', () => {
    completeDraft();
    arrangeOngoingMatch();

    cy.visit(livePath(alicePasskey));

    cy.testGet('live-match-page').should('be.visible');
    cy.testGet('live-squad-points').should('have.length', 2).and('contain.text', 'pts');
    cy.testGet('live-match-result').should('not.exist');
    cy.testGet('live-match-share-button').should('not.exist');
    cy.getCompletedLiveMatchOrNull(match.id).should('equal', null);
  });
});
