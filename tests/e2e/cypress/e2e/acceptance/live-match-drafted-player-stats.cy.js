/**
 * As a drafted league user, I want a completed draft to automatically open a live match page showing every user's drafted
 * players and all available scraper stats, so that I can follow each squad's performance with my own squad emphasized.
 */
describe('Live match drafted player stats', () => {
  const alicePasskey = 'alice-1111-1111-1111';
  const bobPasskey = 'bob-2222-2222-2222';
  const fullBenchPlayerCount = 15;

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
        expect(draft.match.lineups.every((lineup) => lineup.starters.length === 11 && lineup.bench.length === fullBenchPlayerCount)).to.equal(true);

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

  beforeEach(() => {
    loadDraftableMatch();
    cy.then(() => cy.request('DELETE', `/api/testing/drafts/${match.id}`).its('status').should('equal', 204));
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
    setDraft({
      status: 'started',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: completedPicks().slice(0, 5)
    });

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
    setDraft({
      status: 'started',
      joinedUsers: ['Alice', 'Bob'],
      draftOrder: ['Alice', 'Bob'],
      picks: completedPicks().slice(0, 5)
    });

    cy.visit(draftPath(alicePasskey));
    cy.testGet('draft-page').should('be.visible');

    draftAs(bobPasskey, awayStarters[2]);

    cy.location('pathname').should('equal', livePath(alicePasskey));
    cy.testGet('live-match-page').should('be.visible');
    cy.testGet('live-match-title').should('contain.text', matchLabel);
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
      cy.contains('[data-test="live-stat-row"]', 'Touches in opposition box').should('be.visible');
      cy.contains('[data-test="live-stat-row"]', 'Clearances').should('be.visible');
      cy.contains('[data-test="live-stat-row"]', 'Accurate passes').should('not.exist');
      cy.contains('[data-test="live-stat-row"]', 'Expected goals').should('not.exist');
      cy.contains('[data-test="live-stat-row"]', 'Goals prevented').should('not.exist');
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
});
